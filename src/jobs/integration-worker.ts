import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import type { IntegrationJob, ProcessIntegrationBatchInput } from '../types';
import { processIntegrationBatch } from '../pipelines/integration-sync';
import { getConnector } from '../connectors/connector';
import { parseArchiveImport } from '../connectors/archive-import';
import { registerContinuousIntegrationConnectors } from '../connectors/registry';
import { captureException } from '../services/telemetry';
import { runIntegrationTests } from '../pipelines/integration-tests';
import {
  completeIntegrationJob,
  failIntegrationJob,
  heartbeatIntegrationJob,
  leaseIntegrationJobs,
  newWorkerId,
} from '../services/integration-queue';

export interface IntegrationWorkerHandle {
  workerId: string;
  stop: () => void;
  done: Promise<void>;
}

export interface StartIntegrationWorkerOptions {
  workerId?: string;
  concurrency?: number;
  pollMs?: number;
  leaseSeconds?: number;
}

let connectorsRegistered = false;

function ensureConnectorsRegistered(): void {
  if (connectorsRegistered) return;
  registerContinuousIntegrationConnectors();
  connectorsRegistered = true;
}

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadConnection(connectionId: string) {
  const { data, error } = await supabase
    .from(Tables.INTEGRATION_CONNECTIONS)
    .select('id,user_id,provider_id,collection_mode,status')
    .eq('id', connectionId)
    .single();
  if (error || !data) throw new Error(`Connection not found: ${error?.message ?? connectionId}`);
  return data;
}

async function markProviderDeletions(connectionId: string, providerObjectIds: string[] | undefined): Promise<void> {
  if (!providerObjectIds?.length) return;
  const { error } = await supabase.from(Tables.SOURCE_ITEMS)
    .update({ deleted_at: new Date().toISOString() })
    .eq('connection_id', connectionId)
    .in('provider_object_id', providerObjectIds);
  if (error) throw new Error(`Mark provider deletions failed: ${error.message}`);
}

async function executeJob(job: IntegrationJob): Promise<void> {
  const connection = await loadConnection(job.connection_id);
  if (connection.status === 'disconnected') throw new Error('Connection is disconnected');

  if (job.job_type === 'device_batch') {
    await processIntegrationBatch(job.payload as unknown as ProcessIntegrationBatchInput);
    return;
  }
  if (job.job_type === 'delete_connection_data') {
    const [{ data: imports }, { data: assets }] = await Promise.all([
      supabase.from(Tables.INTEGRATION_IMPORTS).select('storage_path').eq('connection_id', job.connection_id),
      supabase.from(Tables.SOURCE_ASSETS).select('storage_bucket,storage_path').eq('connection_id', job.connection_id),
    ]);
    const importPaths = (imports ?? []).map((row) => row.storage_path);
    if (importPaths.length > 0) await supabase.storage.from('integration-imports').remove(importPaths);
    const byBucket = new Map<string, string[]>();
    for (const asset of assets ?? []) {
      byBucket.set(asset.storage_bucket, [...(byBucket.get(asset.storage_bucket) ?? []), asset.storage_path]);
    }
    for (const [bucket, paths] of byBucket) {
      if (paths.length > 0) await supabase.storage.from(bucket).remove(paths);
    }
    const { error } = await supabase.rpc('delete_integration_connection_data', {
      p_user_id: job.user_id,
      p_connection_id: job.connection_id,
    });
    if (error) throw new Error(`Delete integration data failed: ${error.message}`);
    return;
  }
  if (job.job_type === 'reconcile') {
    await runIntegrationTests(job.connection_id);
    return;
  }
  if (job.job_type === 'archive_parse' || job.job_type === 'export_import') {
    const importId = String(job.payload.importId ?? '');
    if (!importId) throw new Error('Archive job is missing importId');
    await supabase.from(Tables.INTEGRATION_IMPORTS).update({ status: 'processing' }).eq('id', importId);
    const parsed = await parseArchiveImport(importId);
    const batchSize = 100;
    for (let start = 0; start < parsed.items.length; start += batchSize) {
      await processIntegrationBatch({
        userId: connection.user_id,
        providerId: connection.provider_id,
        collectionMode: 'data_export',
        runType: 'export_import',
        cursorBefore: { offset: start },
        cursorAfter: { offset: Math.min(start + batchSize, parsed.items.length) },
        items: parsed.items.slice(start, start + batchSize),
      });
    }
    await supabase.from(Tables.INTEGRATION_IMPORTS).update({
      status: 'completed',
      items_imported: parsed.items.length,
      completed_at: new Date().toISOString(),
    }).eq('id', importId);
    return;
  }
  if (job.job_type === 'oauth_sync' || job.job_type === 'initial_backfill' || job.job_type === 'incremental_sync') {
    const { data: state } = await supabase
      .from(Tables.INTEGRATION_SYNC_STATES)
      .select('cursor')
      .eq('connection_id', connection.id)
      .maybeSingle();
    const connector = getConnector(connection.provider_id);
    const result = await connector.sync({
      userId: connection.user_id,
      connectionId: connection.id,
      providerId: connection.provider_id,
      cursor: state?.cursor ?? {},
      payload: job.payload,
    });
    await processIntegrationBatch({
      userId: connection.user_id,
      providerId: connection.provider_id,
      collectionMode: connection.collection_mode,
      runType: job.job_type === 'initial_backfill' ? 'initial_backfill' : 'incremental_sync',
      cursorBefore: state?.cursor ?? {},
      cursorAfter: result.cursorAfter,
      items: result.items,
    });
    await markProviderDeletions(connection.id, result.deletedProviderObjectIds);
    return;
  }
  throw new Error(`Unsupported integration job type: ${job.job_type}`);
}

async function runOne(job: IntegrationJob, runtime: {
  workerId: string;
  leaseSeconds: number;
  heartbeatMs: number;
}): Promise<void> {
  const { workerId, leaseSeconds, heartbeatMs } = runtime;
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    heartbeatIntegrationJob(job.id, workerId, leaseSeconds).catch((error) => {
      leaseLost = true;
      captureException(error, { jobId: job.id, jobType: job.job_type, phase: 'lease_heartbeat' });
    });
  }, heartbeatMs);
  try {
    await executeJob(job);
    if (leaseLost) {
      throw new Error(`Integration job lease was lost before completion: ${job.id}`);
    }
    await completeIntegrationJob(job.id, workerId);
    console.log(JSON.stringify({ event: 'integration_job_completed', workerId, jobId: job.id, type: job.job_type }));
  } catch (error) {
    if (job.job_type === 'archive_parse' || job.job_type === 'export_import') {
      const importId = String(job.payload.importId ?? '');
      if (importId) {
        await supabase.from(Tables.INTEGRATION_IMPORTS).update({
          status: 'failed',
          error_message: error instanceof Error ? error.message.slice(0, 4000) : String(error).slice(0, 4000),
        }).eq('id', importId);
      }
    }
    captureException(error, { jobId: job.id, jobType: job.job_type, connectionId: job.connection_id });
    console.error(JSON.stringify({
      event: 'integration_job_failed',
      workerId,
      jobId: job.id,
      type: job.job_type,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (leaseLost) {
      console.warn(JSON.stringify({
        event: 'integration_job_lease_lost_skip_fail',
        workerId,
        jobId: job.id,
        type: job.job_type,
      }));
    } else {
      await failIntegrationJob(job, workerId, error);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

export function startIntegrationWorkerLoop(options: StartIntegrationWorkerOptions = {}): IntegrationWorkerHandle {
  ensureConnectorsRegistered();
  const workerId = options.workerId ?? newWorkerId();
  const concurrency = options.concurrency ?? readPositiveInt('INTEGRATION_WORKER_CONCURRENCY', 3);
  const pollMs = options.pollMs ?? readPositiveInt('INTEGRATION_WORKER_POLL_MS', 3000);
  const leaseSeconds = options.leaseSeconds ?? readPositiveInt('INTEGRATION_WORKER_LEASE_SECONDS', 15 * 60);
  const heartbeatMs = Math.max(30_000, Math.floor(leaseSeconds * 1000 / 3));
  let stopping = false;

  const done = (async () => {
    console.log(JSON.stringify({ event: 'integration_worker_started', workerId, concurrency }));
    while (!stopping) {
      try {
        const jobs = await leaseIntegrationJobs(workerId, concurrency, leaseSeconds);
        if (jobs.length === 0) {
          await sleep(pollMs);
          continue;
        }
        await Promise.all(jobs.map((job) => runOne(job, { workerId, leaseSeconds, heartbeatMs })));
      } catch (error) {
        captureException(error, { workerId, phase: 'integration_worker_loop' });
        console.error(JSON.stringify({
          event: 'integration_worker_loop_error',
          workerId,
          error: error instanceof Error ? error.message : String(error),
        }));
        await sleep(pollMs);
      }
    }
    console.log(JSON.stringify({ event: 'integration_worker_stopped', workerId }));
  })();

  return {
    workerId,
    stop: () => {
      stopping = true;
    },
    done,
  };
}

if (require.main === module) {
  const worker = startIntegrationWorkerLoop();
  process.on('SIGTERM', () => { worker.stop(); });
  process.on('SIGINT', () => { worker.stop(); });
  worker.done.catch((error) => {
    console.error('[integration-worker] fatal', error);
    process.exitCode = 1;
  });
}
