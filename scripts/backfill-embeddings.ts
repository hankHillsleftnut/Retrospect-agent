#!/usr/bin/env tsx
/**
 * Backfill embeddings for tables/rows where the agent's search tools
 * expect embeddings but pre-existing data has NULL.
 *
 * Targets:
 *   - raw_content (new column added by migration 100)
 *   - podcast_episodes.summary_embedding (new column added by migration 100;
 *     only meaningful if the row already has a summary text)
 *
 * Usage:
 *   npm run backfill -- --user <id>                # backfill one user
 *   npm run backfill -- --user <id> --table raw_content
 *   npm run backfill -- --user <id> --dry-run
 *   npm run backfill                                # ALL users (be careful — cost)
 */
import { parseArgs, optBool, optStr } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { generateEmbeddings } from '../src/services/embeddings';

const BATCH = 32;

async function backfillRawContent(userId: string | null, dryRun: boolean) {
  let q = supabase
    .from(Tables.RAW_CONTENT)
    .select('id, content')
    .is('embedding', null);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw new Error(`raw_content fetch failed: ${error.message}`);
  const rows = data ?? [];
  console.log(`[raw_content] ${rows.length} rows missing embedding`);
  if (dryRun || rows.length === 0) return;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const texts = batch.map((r) => (r.content ?? '').slice(0, 2000));
    const embs = await generateEmbeddings(texts);
    for (let j = 0; j < batch.length; j++) {
      await supabase
        .from(Tables.RAW_CONTENT)
        .update({ embedding: embs[j] })
        .eq('id', batch[j]!.id);
    }
    console.log(`  embedded ${Math.min(i + BATCH, rows.length)} / ${rows.length}`);
  }
}

async function backfillPodcastSummaries(userId: string | null, dryRun: boolean) {
  let q = supabase
    .from(Tables.PODCAST_EPISODES)
    .select('id, summary')
    .not('summary', 'is', null)
    .is('summary_embedding', null);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw new Error(`podcast_episodes fetch failed: ${error.message}`);
  const rows = data ?? [];
  console.log(`[podcast_episodes] ${rows.length} rows with summary missing summary_embedding`);
  if (dryRun || rows.length === 0) return;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const texts = batch.map((r) => r.summary as string);
    const embs = await generateEmbeddings(texts);
    for (let j = 0; j < batch.length; j++) {
      await supabase
        .from(Tables.PODCAST_EPISODES)
        .update({ summary_embedding: embs[j] })
        .eq('id', batch[j]!.id);
    }
    console.log(`  embedded ${Math.min(i + BATCH, rows.length)} / ${rows.length}`);
  }
}

async function main() {
  const args = parseArgs();
  const userId = optStr(args, 'user') ?? null;
  const table = optStr(args, 'table');
  const dryRun = optBool(args, 'dry-run');

  if (!userId) {
    console.warn('⚠  No --user passed; this will scan ALL users. Cost can add up.');
  }

  if (!table || table === 'raw_content') {
    await backfillRawContent(userId, dryRun);
  }
  if (!table || table === 'podcast_episodes') {
    await backfillPodcastSummaries(userId, dryRun);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
