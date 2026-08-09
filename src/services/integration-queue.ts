import { randomUUID } from 'crypto';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import type { IntegrationJob, IntegrationJobType } from '../types';

export interface EnqueueIntegrationJobInput {
  userId: string;
  connectionId: string;
  jobType: IntegrationJobType;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  priority?: number;
  availableAt?: string;
  maxAttempts?: number;
}

export async function enqueueIntegrationJob(input: EnqueueIntegrationJobInput): Promise<IntegrationJob> {
  const row = {
    user_id: input.userId,
    connection_id: input.connectionId,
    job_type: input.jobType,
    status: 'queued',
    payload: input.payload,
    idempotency_key: input.idempotencyKey ?? null,
    priority: input.priority ?? 100,
    available_at: input.availableAt ?? new Date().toISOString(),
    max_attempts: input.maxAttempts ?? 5,
  };
  const { data, error } = await supabase
    .from(Tables.INTEGRATION_JOBS)
    .upsert(row, { onConflict: 'connection_id,idempotency_key', ignoreDuplicates: true })
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Enqueue integration job failed: ${error.message}`);
  if (data) return data as IntegrationJob;

  const { data: existing, error: existingError } = await supabase
    .from(Tables.INTEGRATION_JOBS)
    .select('*')
    .eq('connection_id', input.connectionId)
    .eq('idempotency_key', input.idempotencyKey)
    .single();
  if (existingError || !existing) {
    throw new Error(`Load idempotent integration job failed: ${existingError?.message ?? 'no row'}`);
  }
  return existing as IntegrationJob;
}

export async function leaseIntegrationJobs(
  workerId: string,
  limit: number,
  leaseSeconds: number
): Promise<IntegrationJob[]> {
  const { data, error } = await supabase.rpc('lease_integration_jobs', {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`Lease integration jobs failed: ${error.message}`);
  return (data ?? []) as IntegrationJob[];
}

export async function completeIntegrationJob(jobId: string, workerId: string): Promise<void> {
  const { data, error } = await supabase.rpc('complete_integration_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
  });
  if (error) throw new Error(`Complete integration job failed: ${error.message}`);
  if (!data) throw new Error(`Complete integration job failed: lease lost for ${jobId}`);
}

export async function heartbeatIntegrationJob(
  jobId: string,
  workerId: string,
  leaseSeconds: number
): Promise<void> {
  const { data, error } = await supabase.rpc('heartbeat_integration_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`Heartbeat integration job failed: ${error.message}`);
  if (!data) throw new Error(`Integration job lease was lost: ${jobId}`);
}

export async function failIntegrationJob(
  job: IntegrationJob,
  workerId: string,
  error: unknown
): Promise<void> {
  const retryDelay = Math.min(6 * 60 * 60, Math.max(30, 30 * 2 ** Math.max(0, job.attempt_count - 1)));
  const message = error instanceof Error ? error.message : String(error);
  const { data, error: rpcError } = await supabase.rpc('fail_integration_job', {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_error: message,
    p_retry_delay_seconds: retryDelay,
  });
  if (rpcError) throw new Error(`Fail integration job failed: ${rpcError.message}`);
  if (!data) throw new Error(`Fail integration job failed: lease lost for ${job.id}`);
}

export async function ensureConnection(options: {
  userId: string;
  providerId: string;
  collectionMode: 'native_ios' | 'oauth_api' | 'data_export';
  status?: string;
}): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from(Tables.INTEGRATION_CONNECTIONS)
    .select('id')
    .eq('user_id', options.userId)
    .eq('provider_id', options.providerId)
    .maybeSingle();
  if (existingError) throw new Error(`Load integration connection failed: ${existingError.message}`);
  if (existing) {
    const { data, error } = await supabase.from(Tables.INTEGRATION_CONNECTIONS).update({
      collection_mode: options.collectionMode,
      disconnected_at: null,
    }).eq('id', existing.id).select('id').single();
    if (error || !data) throw new Error(`Update integration connection failed: ${error?.message ?? 'no row'}`);
    return data;
  }
  const { data, error } = await supabase
    .from(Tables.INTEGRATION_CONNECTIONS)
    .insert({
      user_id: options.userId,
      provider_id: options.providerId,
      collection_mode: options.collectionMode,
      status: options.status ?? 'action_required',
      connected_at: now,
      last_verified_at: options.status === 'connected' ? now : null,
      disconnected_at: null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Ensure integration connection failed: ${error?.message ?? 'no row'}`);
  return data;
}

export function newWorkerId(prefix = 'integration-worker'): string {
  return `${prefix}:${process.env.RENDER_INSTANCE_ID ?? process.env.HOSTNAME ?? 'local'}:${randomUUID()}`;
}
