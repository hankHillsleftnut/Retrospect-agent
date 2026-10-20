/** R1.2: enrichment, with a fetch that refuses private addresses. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, checkUrl, readPage, vetTopics, enrichPending } from '../src/reference/enrich';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

test('private, loopback, link-local and metadata addresses are refused', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.1.5', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('URLs are checked before any fetch: scheme, port, credentials, resolved address', async () => {
  const resolve = async (h: string) => (h === 'evil.example' ? ['10.1.2.3'] : ['93.184.216.34']);
  await assert.rejects(checkUrl('file:///etc/passwd', resolve), /only http/);
  await assert.rejects(checkUrl('http://ok.example:8080/', resolve), /port/);
  await assert.rejects(checkUrl('http://u:p@ok.example/', resolve), /credentials/);
  await assert.rejects(checkUrl('http://evil.example/', resolve), /private/);
  await assert.rejects(checkUrl('http://169.254.169.254/latest/meta-data', resolve), /private/);
  assert.equal((await checkUrl('https://ok.example/a', resolve)).hostname, 'ok.example');
});

test('page text and title come out clean; topics stay on the list', () => {
  assert.deepEqual(readPage('<html><head><title> Seed  Rounds </title><style>x{}</style></head><body><p>How &amp; why</p><script>bad()</script></body></html>'), { title: 'Seed Rounds', text: 'Seed Rounds How & why' });
  assert.deepEqual(vetTopics(['Fundraising', 'vibes', 'startups', 'ai', 'money']), ['fundraising', 'startups', 'ai']);
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('against the database: a good link is enriched; one pointing inside the network is marked unsafe and never fetched', async () => {
  const u = await insertUser(db);
  const rc = (await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'text_entry', 'x') RETURNING id`, [u])).rows[0]!.id;
  await db.query(`INSERT INTO reference_items (user_id, raw_content_id, url) VALUES ($1, $2, 'https://ok.example/seed'), ($1, $2, 'http://169.254.169.254/latest')`, [u, rc]);
  const fetched: string[] = [];
  const fetcher = (async (url: URL) => { fetched.push(String(url)); return new Response('<title>Seed rounds</title><p>A guide.</p>', { headers: { 'content-type': 'text/html' } }); }) as unknown as typeof fetch;
  const r = await enrichPending(u, { db: supabase, fetcher, resolve: async () => ['93.184.216.34'],
    model: async () => ({ data: { summary: 'A guide to seed rounds.', topics: ['fundraising', 'nonsense'] }, usage: { inputTokens: 1, outputTokens: 1 } }) });
  assert.deepEqual([r.enriched, r.unsafe], [1, 1]);
  assert.deepEqual(fetched, ['https://ok.example/seed'], 'the metadata address was never fetched');
  const { rows } = await db.query<{ url: string; status: string; title: string | null; topics: string[] }>(`SELECT url, status, title, topics FROM reference_items WHERE user_id = $1 ORDER BY url DESC`, [u]);
  assert.deepEqual(rows.map((x) => [x.status, x.title, x.topics]), [['enriched', 'Seed rounds', ['fundraising']], ['unsafe', null, []]]);
});

test('R1.2b: a long page is read in sections, then described as a whole', async () => {
  const u = await insertUser(db);
  const rc = (await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'text_entry', 'x') RETURNING id`, [u])).rows[0]!.id;
  await db.query(`INSERT INTO reference_items (user_id, raw_content_id, url) VALUES ($1, $2, 'https://ok.example/long')`, [u, rc]);
  const long = '<title>Long essay</title><p>' + 'word '.repeat(3000) + '</p>';
  const calls: string[] = [];
  const r = await enrichPending(u, { db: supabase, resolve: async () => ['93.184.216.34'],
    fetcher: (async () => new Response(long, { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch,
    model: async (system, prompt) => { calls.push(system.startsWith('You read one part') ? 'part' : 'whole'); return { data: { summary: prompt.startsWith('URL') ? 'An essay.' : 'a part', topics: ['writing'] }, usage: { inputTokens: 1, outputTokens: 1 } }; } });
  assert.equal(r.enriched, 1);
  assert.deepEqual([calls.filter((c) => c === 'part').length >= 2, calls[calls.length - 1]], [true, 'whole']);
});
