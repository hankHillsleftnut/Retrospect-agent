#!/usr/bin/env tsx
/**
 * Re-run a past pipeline_run_traces row with current prompts.
 *
 * For 'podcast' runs: reuses the same user + daysBack from inputs_snapshot.
 * For 'ingest' runs: reuses the same raw_content_ids from inputs_snapshot.
 *
 * Usage:
 *   npm run replay -- --run <trace-id> [--skip-tts] [--dry-run] [--notes "trying tone v3"]
 */
import { parseArgs, requireArg, optBool, optStr } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { runPodcast } from '../src/pipelines/podcast';
import { runIngest } from '../src/pipelines/ingest';

async function main() {
  const args = parseArgs();
  const runId = requireArg(args, 'run');
  const skipTTS = optBool(args, 'skip-tts');
  const dryRun = optBool(args, 'dry-run');
  const notes = optStr(args, 'notes') ?? `replay of ${runId}`;

  const { data, error } = await supabase
    .from(Tables.PIPELINE_RUN_TRACES)
    .select('*')
    .eq('id', runId)
    .single();
  if (error || !data) {
    console.error(`Run ${runId} not found`);
    process.exit(1);
  }

  const snap = (data.inputs_snapshot ?? {}) as Record<string, unknown>;
  const userId = data.user_id as string;

  if (data.kind === 'podcast') {
    const result = await runPodcast({
      userId,
      daysBack: (snap.daysBack as number) ?? 14,
      skipTTS,
      dryRun,
      persona: snap.persona as any,
      triggeredBy: 'replay',
      parentRunId: runId,
      notes,
    });
    console.log(`Replayed → episode=${result.episodeId} trace=${result.traceId}`);
    if (result.traceId) {
      console.log(`Compare: http://localhost:3001/runs/${runId}/compare/${result.traceId}`);
    }
  } else if (data.kind === 'ingest') {
    const result = await runIngest({
      userId,
      rawContentIds: (snap.raw_content_ids as string[]) ?? [],
      daysBack: (snap.daysBack as number) ?? 7,
      dryRun,
      triggeredBy: 'replay',
      notes,
    });
    console.log(
      `Replayed ingest → obs=${result.observations_created} ins=${result.insights_created} trace=${result.traceId}`
    );
  } else {
    console.error(`Replay not implemented for kind=${data.kind}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
