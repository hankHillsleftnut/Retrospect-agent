/** Gate F-V (goal 18): continuous across a day, quiet when it should be, bounded, honest. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { converse } from '../src/conversation/reply';
import type { UnderstandingContract } from '../src/understanding/read';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

const u = { inputTokens: 1, outputTokens: 1 };
const now = new Date('2026-10-20T18:00:00Z');
const contract = {
  userId: 'u', asOf: '2026-10-20', silent: [], goals: [], whys: [], shifts: [], time: { categories: [], otherShare: 0, weeksOfBaseline: 0 }, moves: { since: null, items: [] }, answers: [],
  patterns: [{ kind: 'pattern', id: 'p1', label: 'Skips the Saturday run after a late Friday', confidence: 0.8, instances: 3, firstSeenAt: null, lastSeenAt: null, trajectory: null, trajectoryDetail: null, register: 'stated' }],
} as unknown as UnderstandingContract;
const allSupported = async (_s: string, p: string) => ({ data: { sentences: p.split('SENTENCE ').slice(1).map((_c, i) => ({ i, claims: [], isQuestion: false })) }, usage: u });

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test("earlier today reaches the reply; yesterday's doesn't", async () => {
  const user = await insertUser(db);
  await db.query(`INSERT INTO conversation_turns (user_id, role, text, created_at) VALUES ($1, 'person', 'Dentist at 3 today, dreading it', $2), ($1, 'person', 'Old thing from yesterday', $3)`,
    [user, new Date(now.getTime() - 5 * 3600e3).toISOString(), new Date(now.getTime() - 26 * 3600e3).toISOString()]);
  let prompt = '';
  await converse(user, 'How did it go?', { now, contract, search: async () => [], guard: allSupported, model: async (_s, p) => { prompt = p; return { data: { intent: 'question', sentences: [] }, usage: u }; } });
  assert.match(prompt, /EARLIER TODAY\nTHEM: Dentist at 3 today/);
  assert.match(prompt, /THEIR NEW MESSAGE, THE ONE TO REPLY TO\nHow did it go\?/);
  assert.doesNotMatch(prompt, /Old thing from yesterday/);
});

test('fyi: it says nothing, and saves nothing of its own', async () => {
  const user = await insertUser(db);
  const r = await converse(user, 'sending you this article', { now, contract, search: async () => [], guard: allSupported, model: async () => ({ data: { intent: 'fyi', sentences: [] }, usage: u }) });
  assert.equal(r.reply, '');
  const n = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM conversation_turns WHERE user_id = $1 AND role = 'companion'`, [user])).rows[0]!.n;
  assert.equal(n, 0);
});

test('bounded, and restating or stock comfort is cut; its own words never become their material', async () => {
  const user = await insertUser(db);
  const r = await converse(user, 'I skipped my run again because I stayed up late Friday', { now, contract, search: async () => [], guard: allSupported, model: async () => ({ data: { intent: 'chat', sentences: [
    'It sounds like you skipped your run because you stayed up late Friday.',
    'Be kind to yourself.',
    'That makes three Saturdays after a late Friday [1].',
    'Want me to keep Sunday mornings open instead?',
    'Fifth sentence over budget.',
  ] }, usage: u }) });
  assert.equal(r.reply, 'That makes three Saturdays after a late Friday. Want me to keep Sunday mornings open instead?');
  assert.deepEqual(r.cut.map((c) => c.reason.slice(0, 20)), ['restates their own w', 'stock comfort, not a', 'over the 2-sentence ']);
  assert.deepEqual(r.used, [{ kind: 'pattern', id: 'p1' }]);
  const raw = await db.query<{ content: string }>(`SELECT content FROM raw_content WHERE user_id = $1`, [user]);
  assert.deepEqual(raw.rows.map((x) => x.content), ['I skipped my run again because I stayed up late Friday'], 'only their words are their material');
});

test('"that\'s wrong" goes to the corrections path', async () => {
  const user = await insertUser(db);
  let corrected = '';
  const r = await converse(user, "That's wrong, I don't skip runs after late Fridays", { now, contract, search: async () => [], guard: allSupported,
    model: async () => ({ data: { intent: 'correction', sentences: [] }, usage: u }),
    correct: async (_u, t) => { corrected = t; return { outcome: 'applied', target: { n: 1, kind: 'pattern', id: 'p1', text: 'Skips the Saturday run after a late Friday' }, retired: 1, echo: 'Got it. I\'ll stop saying "Skips the Saturday run after a late Friday".', usage: u }; } });
  assert.match(corrected, /don't skip runs/);
  assert.match(r.reply, /I'll stop saying/);
});
