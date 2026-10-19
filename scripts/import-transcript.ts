#!/usr/bin/env tsx
/**
 * `npm run import:transcript` -- add a conversation the person took part in.
 *
 *   npm run import:transcript -- --user <id> --file notes.md --date 2026-09-27 --with Francis           preview
 *   npm run import:transcript -- --user <id> --file notes.md --date 2026-09-27 --with Francis --apply   save
 *
 * Keeps only the person's own turns ("Me:"), drops filler, and saves one
 * 'conversation' item that counts as their own words (migration 125). The
 * other speaker's words are never stored. Importing the same conversation
 * twice is refused by the duplicate rule (migration 117).
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs, requireArg } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { ownTurns, parseTranscript } from '../src/questions/transcript';

async function main() {
  const args = parseArgs();
  const userId = requireArg(args, 'user');
  const file = requireArg(args, 'file');
  const date = requireArg(args, 'date');
  const other = typeof args.with === 'string' ? args.with : 'the other speaker';

  const parsed = parseTranscript(readFileSync(file, 'utf8'));
  const mine = ownTurns(parsed.turns);
  const theirs = parsed.turns.filter((t) => t.speaker === 'them').length;
  const content = mine.join('\n\n');
  const dedupKey = createHash('sha256').update(`${userId}\nconversation\n${content}`).digest('hex');

  console.log(`"${parsed.title ?? 'Untitled conversation'}" with ${other}, ${date}`);
  console.log(`Keeping ${mine.length} of your turns (${content.length.toLocaleString()} characters). Leaving out ${theirs} of ${other}'s turns and ${parsed.turns.filter((t) => t.speaker === 'me').length - mine.length} filler turns of yours.`);
  console.log(`\nFirst of your turns kept:\n  "${mine[0]?.slice(0, 160)}"`);

  if (args.apply !== true) {
    console.log('\nPreview only. Re-run with --apply to save.');
    return;
  }
  const { data, error } = await supabase.from(Tables.RAW_CONTENT).insert({
    user_id: userId,
    content_type: 'conversation',
    content,
    content_date: `${date}T12:00:00Z`,
    authorship: 'self',
    dedup_key: dedupKey,
    dedup_strategy: 'content_hash',
    metadata: {
      source: 'transcript',
      title: parsed.title,
      other_speakers: [other],
      own_turns_kept: mine.length,
      other_turns_left_out: theirs,
      note: "Only the person's own turns are stored; the other speaker's words were not imported.",
    },
  }).select('id').single();
  if (error) {
    console.error(error.code === '23505' ? 'Already imported (same conversation).' : `Save failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`\nSaved as ${data!.id}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
