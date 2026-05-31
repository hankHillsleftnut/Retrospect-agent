#!/usr/bin/env tsx
/**
 * Backfill the User Understanding Document for existing users.
 *
 * For every user who has observations but no user_understanding row yet,
 * run a cold-start Cook 0 that synthesizes their first ever document
 * from full history (observations + insights + active goals + recent
 * identity inferences if any). Idempotent — skips users who already
 * have a document.
 *
 * Usage:
 *   tsx scripts/backfill-understanding.ts                 # all users
 *   tsx scripts/backfill-understanding.ts --user <uuid>   # one user
 *   tsx scripts/backfill-understanding.ts --force         # also rewrite users who already have docs
 *   tsx scripts/backfill-understanding.ts --dry-run       # print plan, no LLM calls
 */
import { parseArgs, optBool, optStr } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { runCook0, applyCook0Decisions, writeNewDocumentVersion } from '../src/agents/cook0-agent';

async function main() {
  const args = parseArgs();
  const oneUser = optStr(args, 'user');
  const force = optBool(args, 'force');
  const dryRun = optBool(args, 'dry-run');

  // 1. Find target users.
  let userIds: string[];
  if (oneUser) {
    userIds = [oneUser];
  } else {
    const { data: obsRows, error } = await supabase
      .from(Tables.OBSERVATIONS)
      .select('user_id');
    if (error) throw new Error(`List observations failed: ${error.message}`);
    userIds = Array.from(new Set((obsRows ?? []).map((r) => r.user_id as string)));
  }

  console.log(`[backfill-understanding] ${userIds.length} candidate user(s)`);

  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const userId of userIds) {
    try {
      // 2. Skip if already has a document and not --force.
      if (!force) {
        const { data: existing } = await supabase
          .from(Tables.USER_UNDERSTANDING)
          .select('version')
          .eq('user_id', userId)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing) {
          console.log(`  [skip] user=${userId} already has v${existing.version}`);
          skipped++;
          continue;
        }
      }

      if (dryRun) {
        console.log(`  [dry-run] would generate v1 for user=${userId}`);
        done++;
        continue;
      }

      // 3. Gather all active inferences for this user (Cook 0 will read more).
      const { data: infRows } = await supabase
        .from(Tables.IDENTITY_INFERENCES)
        .select('id')
        .eq('user_id', userId)
        .is('superseded_by', null)
        .is('retired_at', null);
      const allActiveInferenceIds = (infRows ?? []).map((r) => r.id as string);

      // 4. Run Cook 0 in backfill mode.
      console.log(
        `  [run] user=${userId} active_inferences=${allActiveInferenceIds.length}`
      );
      const result = await runCook0({
        userId,
        currentDocument: null,
        newInferenceIds: allActiveInferenceIds, // treat them all as "new" for Cook 0's reading
        backfillMode: true,
      });

      await applyCook0Decisions(result);

      // 5. Snapshot active inference ids for this version
      const { data: activeRows } = await supabase
        .from(Tables.IDENTITY_INFERENCES)
        .select('id')
        .eq('user_id', userId)
        .is('superseded_by', null)
        .is('retired_at', null);
      const activeIds = (activeRows ?? []).map((r) => r.id as string);

      const version = await writeNewDocumentVersion({
        userId,
        document: result.document,
        generationNotes: `[backfill] ${result.generation_notes}`,
        inferenceIdsAtVersion: activeIds,
        sourceIngestionRunId: null,
      });

      console.log(`  [ok] user=${userId} → v${version}`);
      done++;
    } catch (err) {
      failed++;
      console.error(
        `  [fail] user=${userId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.log(
    `\n[backfill-understanding] done=${done} skipped=${skipped} failed=${failed} of ${userIds.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
