/** R1: YouTube watch history from Google Takeout, both formats, dated, idempotent. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { parseTakeout, parseTakeoutHtml, parseTakeoutJson, importWatches } from '../src/imports/youtube-takeout';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

const JSON_EXPORT = JSON.stringify([
  { header: 'YouTube', title: 'Watched Japanese joinery basics', titleUrl: 'https://www.youtube.com/watch?v=abc123XYZ_-', subtitles: [{ name: 'Wood by Wright', url: 'https://www.youtube.com/channel/UC1' }], time: '2026-10-01T21:14:05.123Z', products: ['YouTube'] },
  { header: 'YouTube', title: 'Watched Buy this mattress', titleUrl: 'https://www.youtube.com/watch?v=ad0000000', time: '2026-10-01T21:10:00Z', details: [{ name: 'From Google Ads' }] },
  { header: 'YouTube', title: 'Watched a video that has been removed', time: '2026-09-30T08:00:00Z' },
  { header: 'YouTube', title: 'Watched Pricing handmade furniture &amp; profit', titleUrl: 'https://www.youtube.com/watch?v=def456', subtitles: [{ name: 'Maker Biz', url: 'https://www.youtube.com/@makerbiz' }], time: '2026-09-29T07:00:00Z' },
]);

const HTML_EXPORT = `<html><body><div class="mdl-grid">
<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid"><div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">YouTube<br></p></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Watched&nbsp;<a href="https://www.youtube.com/watch?v=abc123XYZ_-">Japanese joinery basics</a><br><a href="https://www.youtube.com/channel/UC1">Wood by Wright</a><br>Oct 1, 2026, 2:14:05 PM PDT<br></div></div></div>
<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid"><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Watched&nbsp;<a href="https://www.youtube.com/watch?v=ad0000000">Buy this mattress</a><br>Oct 1, 2026, 2:10:00 PM PDT<br></div><div class="content-cell">Details:<br>&emsp;From Google Ads<br></div></div></div>
<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid"><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Watched a video that has been removed<br>Sep 30, 2026, 1:00:00 AM PDT<br></div></div></div>
</div></body></html>`;

test('JSON export: watches kept with title, channel and time; ads and removed videos dropped', () => {
  const w = parseTakeoutJson(JSON_EXPORT);
  assert.deepEqual(w.map((x) => [x.videoId, x.title, x.channel]), [['abc123XYZ_-', 'Japanese joinery basics', 'Wood by Wright'], ['def456', 'Pricing handmade furniture & profit', 'Maker Biz']]);
  assert.equal(w[0]!.watchedAt, '2026-10-01T21:14:05.123Z');
});

test('HTML export (the default): the same, with the date read from the cell', () => {
  const w = parseTakeoutHtml(HTML_EXPORT);
  assert.deepEqual(w.map((x) => [x.videoId, x.title, x.channel]), [['abc123XYZ_-', 'Japanese joinery basics', 'Wood by Wright']]);
  assert.match(w[0]!.watchedAt, /^2026-10-01T/);
});

test('the format is detected', () => {
  assert.equal(parseTakeout(JSON_EXPORT).length, 2);
  assert.equal(parseTakeout(HTML_EXPORT).length, 1);
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('stored as dated records, never sent to extraction, and importing twice adds nothing', async () => {
  const user = await insertUser(db);
  const w = parseTakeout(JSON_EXPORT);
  assert.deepEqual(await importWatches(user, w), { added: 2, skipped: 0 });
  assert.deepEqual(await importWatches(user, w), { added: 0, skipped: 2 });
  const rows = (await db.query<{ trust_class: string; processing_status: string; created_at: Date; rel: string }>(`SELECT trust_class, processing_status, created_at, metadata->>'relationship' AS rel FROM raw_content WHERE user_id = $1 ORDER BY created_at DESC`, [user])).rows;
  assert.deepEqual(rows.map((r) => [r.trust_class, r.processing_status, r.rel]), [['record', 'completed', 'watched'], ['record', 'completed', 'watched']]);
  assert.equal(rows[0]!.created_at.toISOString(), '2026-10-01T21:14:05.123Z');
});
