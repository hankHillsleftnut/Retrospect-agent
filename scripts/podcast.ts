#!/usr/bin/env tsx
import { parseArgs, requireArg, optBool, optNum, optStr } from './_args';
import { writeOutput } from './_io';
import { runPodcast } from '../src/pipelines/podcast';
import type { VoicePersona } from '../src/types';

async function main() {
  const args = parseArgs();
  const userId = requireArg(args, 'user');
  const daysBack = optNum(args, 'days') ?? 14;
  const skipTTS = optBool(args, 'skip-tts');
  const dryRun = optBool(args, 'dry-run');
  const persona = optStr(args, 'persona') as VoicePersona | undefined;
  const notes = optStr(args, 'notes');

  console.log(`[podcast] user=${userId} daysBack=${daysBack} skipTTS=${skipTTS} dryRun=${dryRun}`);

  const result = await runPodcast({
    userId,
    daysBack,
    skipTTS,
    dryRun,
    persona,
    triggeredBy: 'cli',
    notes,
  });

  const out = writeOutput('podcast.json', result);
  console.log(`\nresult:`);
  console.log(`  title:                   "${result.title}"`);
  console.log(`  description:             ${result.description}`);
  console.log(`  mood:                    ${result.mood}`);
  console.log(`  est duration:            ${result.durationSeconds}s`);
  console.log(`  audio:                   ${result.audioUrl ?? '(skipped)'}`);
  console.log(`  episode:                 ${result.episodeId ?? '(dry-run)'}`);
  console.log(`  trace:                   ${result.traceId ?? '(dry-run)'}`);
  console.log(`  output saved:            ${out}`);
  if (result.traceId) {
    console.log(`\n  dashboard: http://localhost:3001/runs/${result.traceId}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
