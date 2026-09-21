import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { captureException } from '../services/telemetry';
import { enqueueIntegrationJob } from '../services/integration-queue';

const intervalMinutes = Number(process.env.INTEGRATION_SYNC_INTERVAL_MINUTES ?? 360);

export interface IntegrationSchedulerHandle {
  stop: () => void;
}

export interface StartIntegrationSchedulerOptions {
  pollMinutes?: number;
  runImmediately?: boolean;
}

function readPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function scheduleDueConnections(): Promise<void> {
  const cutoff = new Date(Date.now() - intervalMinutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from(Tables.INTEGRATION_CONNECTIONS)
    .select('id,user_id,provider_id,collection_mode,integration_sync_states(last_success_at)')
    .eq('status', 'connected');
  if (error) throw new Error(`Load due integration connections failed: ${error.message}`);

  for (const connection of data ?? []) {
    const state = Array.isArray(connection.integration_sync_states)
      ? connection.integration_sync_states[0]
      : connection.integration_sync_states;
    if (connection.collection_mode === 'oauth_api' && (!state?.last_success_at || state.last_success_at <= cutoff)) {
      const bucket = Math.floor(Date.now() / (intervalMinutes * 60_000));
      await enqueueIntegrationJob({
        userId: connection.user_id,
        connectionId: connection.id,
        jobType: state?.last_success_at ? 'oauth_sync' : 'initial_backfill',
        idempotencyKey: `scheduled:${connection.provider_id}:${bucket}`,
        payload: { scheduledAt: new Date().toISOString() },
      });
    }
    const day = new Date().toISOString().slice(0, 10);
    await enqueueIntegrationJob({
      userId: connection.user_id,
      connectionId: connection.id,
      jobType: 'reconcile',
      idempotencyKey: `reconcile:${day}`,
      payload: { scheduledAt: new Date().toISOString() },
      priority: 200,
    });
  }

  await supabase.from(Tables.INTEGRATION_OAUTH_STATES)
    .delete()
    .lt('expires_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString());

  const { data: deadLetters } = await supabase.from(Tables.INTEGRATION_JOBS)
    .select('connection_id').eq('status', 'dead_letter');
  const deadConnections = [...new Set((deadLetters ?? []).map((job) => job.connection_id))];
  if (deadConnections.length > 0) {
    await supabase.from(Tables.INTEGRATION_CONNECTIONS)
      .update({ status: 'error' })
      .in('id', deadConnections);
  }
}

export async function runIntegrationSchedulerOnce(): Promise<void> {
  await scheduleDueConnections();
  console.log(JSON.stringify({ event: 'integration_scheduler_completed' }));
}

export function startIntegrationSchedulerLoop(
  options: StartIntegrationSchedulerOptions = {}
): IntegrationSchedulerHandle {
  const pollMinutes = options.pollMinutes ?? readPositiveNumber('INTEGRATION_SCHEDULER_POLL_MINUTES', 15);
  const pollMs = pollMinutes * 60_000;
  let stopped = false;
  let inFlight = false;

  const runTick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await runIntegrationSchedulerOnce();
    } catch (error) {
      captureException(error, { phase: 'integration_scheduler_loop' });
      console.error(JSON.stringify({
        event: 'integration_scheduler_error',
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      inFlight = false;
    }
  };

  const interval = setInterval(runTick, pollMs);
  interval.unref();
  let kickoff: NodeJS.Timeout | undefined;
  if (options.runImmediately ?? true) {
    kickoff = setTimeout(runTick, 0);
    kickoff.unref();
  }

  console.log(JSON.stringify({ event: 'integration_scheduler_started', pollMinutes, intervalMinutes }));
  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
      if (kickoff) clearTimeout(kickoff);
      console.log(JSON.stringify({ event: 'integration_scheduler_stopped' }));
    },
  };
}

if (require.main === module) {
  runIntegrationSchedulerOnce().catch((error) => {
    console.error('[integration-scheduler] fatal', error);
    process.exitCode = 1;
  });
}
