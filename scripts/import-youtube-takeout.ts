/**
 * `npm run import:youtube -- --email you@example.com --file <path to watch-history.html or .json>`
 * Reads a Google Takeout YouTube watch history and stores each watch for that
 * person. Prints counts only, never titles. Safe to run twice.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parseArgs } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { parseTakeout, importWatches } from '../src/imports/youtube-takeout';

(async () => {
  const args = parseArgs();
  const email = typeof args.email === 'string' ? args.email : null;
  const file = typeof args.file === 'string' ? args.file : null;
  if (!email || !file) { console.error('usage: npm run import:youtube -- --email <your account email> --file <watch-history.html|.json>'); process.exit(1); }
  const { data: user } = await supabase.from(Tables.USERS).select('id').eq('email', email).maybeSingle();
  if (!user) { console.error('No account with that email.'); process.exit(1); }
  const watches = parseTakeout(readFileSync(file, 'utf8'));
  const span = watches.length ? `${watches.map((w) => w.watchedAt).sort()[0]!.slice(0, 10)} to ${watches.map((w) => w.watchedAt).sort().at(-1)!.slice(0, 10)}` : 'none';
  console.log(`Read ${watches.length} watches (${span}).`);
  const r = await importWatches((user as { id: string }).id, watches);
  console.log(`Stored ${r.added} new; ${r.skipped} were already in.`);
})();
