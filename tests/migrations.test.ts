import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { freshDatabase, insertUser, type MigrationResult, type PGlite } from './support/fresh-database';

/**
 * The migrations, run against real Postgres.
 *
 * Until 18 October 2026 no migration in this project had been executed before it
 * was applied to production by hand -- and the history turned out not to replay
 * at all. These tests make that impossible to regress, and prove that the
 * guarantees each recent migration promises are actually enforced by the
 * database, not merely described in a comment.
 */

let db: PGlite;
let results: MigrationResult[];

before(async () => {
  ({ db, results } = await freshDatabase());
});

/** Run a statement expected to fail; return the Postgres error code. */
async function failureCode(sql: string, params: unknown[] = []): Promise<string | undefined> {
  try {
    await db.query(sql, params);
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

test('the whole migration history replays from scratch', () => {
  // The single most important property: a new environment, a new engineer, or a
  // disaster recovery can rebuild the database from this repository.
  const failed = results.filter((r) => !r.ok);
  assert.deepEqual(
    failed,
    [],
    `migrations that do not apply:\n${failed.map((f) => `  ${f.file}: ${f.error}`).join('\n')}`,
  );
});

// ── Migration 116 ───────────────────────────────────────────────────────────

test('116: a failure can be recorded as "not a failure at all"', async () => {
  const user = await insertUser(db);
  // The retry policy classifies the pipeline's own deliberate skips as
  // not_applicable. Before 116, the database rejected that value.
  await db.query(
    `INSERT INTO raw_content (user_id, content_type, content, failure_kind) VALUES ($1, 'journal_entry', 'x', 'not_applicable')`,
    [user],
  );
  assert.equal(
    await failureCode(
      `INSERT INTO raw_content (user_id, content_type, content, failure_kind) VALUES ($1, 'journal_entry', 'x', 'banana')`,
      [user],
    ),
    CHECK_VIOLATION,
    'and anything else is still refused',
  );
});

test('116: a run can record what extraction discarded', async () => {
  const user = await insertUser(db);
  const { rows } = await db.query<{ extraction_stats: { dropped: number } }>(
    `INSERT INTO pipeline_run_traces (user_id, kind, status, extraction_stats)
     VALUES ($1, 'ingest', 'completed', '{"candidates": 5, "dropped": 2}') RETURNING extraction_stats`,
    [user],
  );
  assert.equal(rows[0]!.extraction_stats.dropped, 2);
});

// ── Migration 117 ───────────────────────────────────────────────────────────

const insertKeyed = (user: string, key: string | null) =>
  `INSERT INTO raw_content (user_id, content_type, content, dedup_key, dedup_strategy)
   VALUES ('${user}', 'healthkit', 'Steps: 1', ${key === null ? 'NULL' : `'${key}'`}, ${key === null ? 'NULL' : `'content_hash'`})`;

test('117: the database refuses a second copy of the same upload', async () => {
  const user = await insertUser(db);
  await db.query(insertKeyed(user, 'k1'));
  assert.equal(await failureCode(insertKeyed(user, 'k1')), UNIQUE_VIOLATION);
});

test('117: rows from before the migration are never blocked', async () => {
  // Every existing row has a null key. The index is partial so it builds
  // against the duplicates already in production and never touches them.
  const user = await insertUser(db);
  await db.query(insertKeyed(user, null));
  await db.query(insertKeyed(user, null));
  await db.query(insertKeyed(user, null));
});

test('117: two people can upload identical content', async () => {
  const a = await insertUser(db);
  const b = await insertUser(db);
  await db.query(insertKeyed(a, 'shared'));
  await db.query(insertKeyed(b, 'shared'));
});

test('117: only a known dedup rule can be recorded', async () => {
  const user = await insertUser(db);
  assert.equal(
    await failureCode(
      `INSERT INTO raw_content (user_id, content_type, content, dedup_key, dedup_strategy)
       VALUES ($1, 'healthkit', 'x', 'k-rule', 'made_up_rule')`,
      [user],
    ),
    CHECK_VIOLATION,
  );
});

// ── Migration 118 ───────────────────────────────────────────────────────────

async function insertPattern(user: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO behavior_patterns (user_id, slug, label, grouping_key)
     VALUES ($1, 'skips', 'Skips standup', $2) RETURNING id`,
    [user, `key-${Math.random().toString(36).slice(2)}`],
  );
  return rows[0]!.id;
}

const insertWhy = (pattern: string, user: string, mechanism: string, retired = false) =>
  `INSERT INTO behavior_pattern_whys (pattern_id, user_id, mechanism${retired ? ', retired_at' : ''})
   VALUES ('${pattern}', '${user}', '${mechanism}'${retired ? ', now()' : ''})`;

test('118: two runs cannot write the same explanation twice', async () => {
  const user = await insertUser(db);
  const pattern = await insertPattern(user);
  await db.query(insertWhy(pattern, user, 'avoidance'));
  assert.equal(await failureCode(insertWhy(pattern, user, 'avoidance')), UNIQUE_VIOLATION);
});

test('118: a pattern can still carry competing explanations', async () => {
  // The constraint is on pattern AND mechanism, deliberately. One explanation
  // per pattern would also stop the race, and would quietly forbid the
  // hypothesis engine from holding "avoidance, or capacity?" side by side.
  const user = await insertUser(db);
  const pattern = await insertPattern(user);
  await db.query(insertWhy(pattern, user, 'avoidance'));
  await db.query(insertWhy(pattern, user, 'capacity'));
});

test('118: a retired explanation does not block a fresh one', async () => {
  const user = await insertUser(db);
  const pattern = await insertPattern(user);
  await db.query(insertWhy(pattern, user, 'avoidance', true));
  await db.query(insertWhy(pattern, user, 'avoidance'));
});

// ── Migration 119 ───────────────────────────────────────────────────────────

/** A user with a "self" entity and one journal entry to cite. */
async function factSetup() {
  const user = await insertUser(db);
  const { rows: [self] } = await db.query<{ id: string }>(
    `INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`,
    [user],
  );
  const { rows: [entry] } = await db.query<{ id: string }>(
    `INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'I skipped standup') RETURNING id`,
    [user],
  );
  return { user, self: self!.id, entry: entry!.id };
}

const fact = (s: { user: string; self: string }, evidence: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> & { origin_key: string } => ({
  user_id: s.user, subject_entity_id: s.self, predicate: 'skipped_or_avoided',
  object_value: { normalized: 'standup' }, origin_key: `k-${Math.random().toString(36).slice(2)}`,
  evidence, ...extra,
});

async function writeFact(p: unknown): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`SELECT write_fact($1::jsonb) AS id`, [JSON.stringify(p)]);
  return rows[0]!.id;
}

const countWhere = async (sql: string, params: unknown[]) =>
  Number((await db.query<{ n: string }>(sql, params)).rows[0]!.n);

test('119: a fact and its evidence are saved together', async () => {
  const s = await factSetup();
  const id = await writeFact(fact(s, [{ raw_content_id: s.entry, excerpt: 'I skipped standup' }]));
  assert.equal(await countWhere(`SELECT count(*) AS n FROM assertion_evidence WHERE assertion_id = $1`, [id]), 1);
});

test('119: if the evidence cannot be saved, neither is the fact', async () => {
  // The whole point. The evidence cites a row that does not exist, so its
  // insert fails -- after the fact's insert has already run. The old two-call
  // path left that fact behind, unsupported. Here it must vanish with the error.
  const s = await factSetup();
  const p = fact(s, [{ raw_content_id: s.entry }, { analysis_unit_id: '00000000-0000-0000-0000-000000000001' }]);
  await assert.rejects(() => writeFact(p));
  assert.equal(await countWhere(`SELECT count(*) AS n FROM assertions WHERE origin_key = $1`, [p.origin_key]), 0);
});

test('119: a fact with no evidence is refused', async () => {
  const s = await factSetup();
  const p = fact(s, []);
  assert.equal(await failureCode(`SELECT write_fact($1::jsonb)`, [JSON.stringify(p)]), CHECK_VIOLATION);
  assert.equal(await countWhere(`SELECT count(*) AS n FROM assertions WHERE origin_key = $1`, [p.origin_key]), 0);
});

test("119: evidence from someone else's data is refused", async () => {
  const s = await factSetup();
  const other = await factSetup();
  const p = fact(s, [{ raw_content_id: other.entry }]);
  assert.equal(await failureCode(`SELECT write_fact($1::jsonb)`, [JSON.stringify(p)]), '42501');
});

test('119: saving the same fact again changes nothing it should not', async () => {
  const s = await factSetup();
  const p = fact(s, [{ raw_content_id: s.entry, excerpt: 'I skipped standup' }], { model_version: 'm1' });
  const id = await writeFact(p);
  const before = (await db.query<{ observed_at: string }>(`SELECT observed_at FROM assertions WHERE id = $1`, [id])).rows[0]!;
  await db.query(`UPDATE assertions SET status = 'superseded' WHERE id = $1`, [id]);

  // Replay, without model_version this time.
  const { model_version: _omit, ...replay } = p;
  const again = await writeFact(replay);

  assert.equal(again, id, 'same fact, not a new one');
  const after = (await db.query<{ observed_at: string; status: string; model_version: string }>(
    `SELECT observed_at, status, model_version FROM assertions WHERE id = $1`, [id])).rows[0]!;
  assert.deepEqual(after.observed_at, before.observed_at, 'when it was first seen does not move');
  assert.equal(after.status, 'superseded', 'a replay does not resurrect a retired fact');
  assert.equal(after.model_version, 'm1', 'a writer that omits model_version does not erase it');
  assert.equal(
    await countWhere(`SELECT count(*) AS n FROM assertion_evidence WHERE assertion_id = $1`, [id]),
    1,
    'journal evidence has no source item; a replay must still not duplicate it',
  );
});

test('119: the app cannot call it, only the backend services can', async () => {
  const { rows } = await db.query<{ anon: boolean; authed: boolean; service: boolean }>(
    `SELECT has_function_privilege('anon', 'write_fact(jsonb)', 'EXECUTE') AS anon,
            has_function_privilege('authenticated', 'write_fact(jsonb)', 'EXECUTE') AS authed,
            has_function_privilege('service_role', 'write_fact(jsonb)', 'EXECUTE') AS service`,
  );
  assert.deepEqual(rows[0], { anon: false, authed: false, service: true });
});

// ── Migration 120 ───────────────────────────────────────────────────────────

test('120: all 36 questions are there, numbered 1 to 36, each in a domain', async () => {
  const { rows } = await db.query<{ id: number; domain_id: string }>(`SELECT id, domain_id FROM canonical_questions ORDER BY id`);
  assert.deepEqual(rows.map((r) => r.id), Array.from({ length: 36 }, (_, i) => i + 1));
  const { rows: empty } = await db.query(
    `SELECT d.id FROM question_domains d LEFT JOIN canonical_questions q ON q.domain_id = d.id GROUP BY d.id HAVING count(q.id) = 0`,
  );
  assert.deepEqual(empty, [], 'no domain without questions');
});

test('120: feelings and wants can only be answered from their own words', async () => {
  // The canonical-questions doc marks these answerable from W (their words)
  // and nothing else. A calendar cannot say how someone is doing.
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM canonical_questions WHERE requires_own_words ORDER BY id`);
  assert.deepEqual(rows.map((r) => r.id), [6, 9, 11, 23, 24, 27, 28, 29, 32, 33]);
});

test('120: the bar to speak rises with the cost of being wrong', async () => {
  const { rows } = await db.query<{ id: string; speak_coverage: string; always_active: boolean }>(
    `SELECT id, speak_coverage, always_active FROM question_domains ORDER BY position`,
  );
  const bar = Object.fromEntries(rows.map((r) => [r.id, Number(r.speak_coverage)]));
  assert.equal(bar.who, 0.5);
  assert.ok(bar.how! > bar.want! && bar.want! > bar.do!, 'feelings > wants > habits');
  assert.equal(rows.find((r) => r.id === 'speak')!.always_active, true, 'how to speak to them is never silent');
});

test("120: one quote from your own words outweighs a day of health data", async () => {
  const { rows } = await db.query<{ id: string; weight: string }>(`SELECT id, weight FROM evidence_kinds`);
  const w = Object.fromEntries(rows.map((r) => [r.id, Number(r.weight)]));
  assert.deepEqual([w.journal, w.sent_mail, w.calendar, w.health], [1, 0.6, 0.4, 0.15], 'the weights in the brief');
});

// ── Migration 121 ───────────────────────────────────────────────────────────

async function person() {
  const user = await insertUser(db);
  const item = async (content_type: string, content: string, daysAgo = 0) =>
    (await db.query<{ id: string }>(
      `INSERT INTO raw_content (user_id, content_type, content, content_date)
       VALUES ($1, $2, $3, now() - make_interval(days => $4)) RETURNING id`,
      [user, content_type, content, daysAgo],
    )).rows[0]!.id;
  return { user, item };
}

const answer = (user: string, question: number, evidence: unknown[], extra: Record<string, unknown> = {}) => ({
  user_id: user, question_id: question, answer: 'an answer', derived_by: 'first_pass',
  derivation_key: `d-${Math.random().toString(36).slice(2)}`, evidence, ...extra,
});

async function record(p: unknown): Promise<string> {
  return (await db.query<{ id: string }>(`SELECT record_answer($1::jsonb) AS id`, [JSON.stringify(p)])).rows[0]!.id;
}
const refusal = (p: unknown) => failureCode(`SELECT record_answer($1::jsonb)`, [JSON.stringify(p)]);
const confidenceOf = async (id: string) =>
  Number((await db.query<{ c: string }>(`SELECT confidence AS c FROM answer_confidence WHERE answer_id = $1`, [id])).rows[0]!.c);

test('121: one quote gives 0.33, two independent quotes 0.50', async () => {
  const p = await person();
  const one = await record(answer(p.user, 6, [{ raw_content_id: await p.item('journal_entry', 'I want to build something') }]));
  assert.equal((await confidenceOf(one)).toFixed(2), '0.33');
  const two = await record(answer(p.user, 6, [
    { raw_content_id: await p.item('journal_entry', 'I want to build something of my own') },
    { raw_content_id: await p.item('journal_entry', 'Still thinking about starting a company') },
  ]));
  assert.equal((await confidenceOf(two)).toFixed(2), '0.50');
});

test('121: the same entry uploaded twice still counts once', async () => {
  // About 90% of production rows were copies. Counting rows would let one
  // journal entry, sent five times, look like five independent sources.
  const p = await person();
  const a = await p.item('journal_entry', 'I want to build something');
  const b = await p.item('journal_entry', 'I want to build something');
  const id = await record(answer(p.user, 6, [{ raw_content_id: a }, { raw_content_id: b }]));
  assert.equal((await confidenceOf(id)).toFixed(2), '0.33');
});

test('121: an answer with no supporting evidence is refused', async () => {
  const p = await person();
  assert.equal(await refusal(answer(p.user, 6, [])), CHECK_VIOLATION);
  const only = await p.item('journal_entry', 'x');
  assert.equal(await refusal(answer(p.user, 6, [{ raw_content_id: only, stance: 'contradicts' }])), CHECK_VIOLATION);
});

test('121: "how are you doing" cannot be answered from health data', async () => {
  const p = await person();
  const steps = await p.item('healthkit', 'Steps: 480');
  assert.equal(await refusal(answer(p.user, 27, [{ raw_content_id: steps }])), CHECK_VIOLATION);
});

test('121: health data cannot be passed off as their own words', async () => {
  const p = await person();
  const steps = await p.item('healthkit', 'Sleep: 0');
  assert.equal(await refusal(answer(p.user, 27, [{ raw_content_id: steps, kind: 'journal' }])), CHECK_VIOLATION);
});

test("121: someone else's journal is refused", async () => {
  const p = await person();
  const other = await person();
  const theirs = await other.item('journal_entry', 'I feel great');
  assert.equal(await refusal(answer(p.user, 27, [{ raw_content_id: theirs }])), '42501');
});

test('121: "what do they want but never named" is only ever a hypothesis', async () => {
  const p = await person();
  const words = await p.item('journal_entry', 'x');
  assert.equal(await refusal(answer(p.user, 10, [{ raw_content_id: words }])), CHECK_VIOLATION);
  await record(answer(p.user, 10, [{ raw_content_id: words }], { derived_by: 'hypothesis' }));
});

test("121: not even the backend's own key can write answers directly", async () => {
  const p = await person();
  const entry = await p.item('journal_entry', 'y');
  await db.exec('SET ROLE service_role');
  try {
    assert.equal(
      await failureCode(
        `INSERT INTO question_answers (user_id, question_id, answer, derived_by, derivation_key) VALUES ($1, 1, 'x', 'first_pass', 'k')`,
        [p.user],
      ),
      '42501',
    );
    // ...but it can use the one way in.
    await record(answer(p.user, 6, [{ raw_content_id: entry }]));
  } finally {
    await db.exec('RESET ROLE');
  }
});

test('121: deleting the entry an answer rests on retires the answer', async () => {
  const p = await person();
  const entry = await p.item('journal_entry', 'I feel stretched thin');
  const id = await record(answer(p.user, 27, [{ raw_content_id: entry }]));
  await db.query(`DELETE FROM raw_content WHERE id = $1`, [entry]);
  const { rows } = await db.query<{ status: string; retirement_reason: string }>(
    `SELECT status, retirement_reason FROM question_answers WHERE id = $1`, [id]);
  assert.equal(rows[0]!.status, 'retired');
  assert.match(rows[0]!.retirement_reason, /deleted/);
});

test('121: deriving the same answer twice changes nothing', async () => {
  const p = await person();
  const entry = await p.item('journal_entry', 'I want to build something');
  const a = answer(p.user, 6, [{ raw_content_id: entry }]);
  const first = await record(a);
  const moved = (await db.query<{ t: string }>(`SELECT last_moved_at::text AS t FROM question_answers WHERE id = $1`, [first])).rows[0]!.t;
  const second = await record(a);
  assert.equal(second, first);
  assert.equal(Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM answer_evidence WHERE answer_id = $1`, [first])).rows[0]!.n), 1);
  const after = (await db.query<{ t: string }>(`SELECT last_moved_at::text AS t FROM question_answers WHERE id = $1`, [first])).rows[0]!.t;
  assert.equal(after, moved, 'nothing new, so it did not "move"');
});

test('121: "how are you doing" fades in weeks', async () => {
  const p = await person();
  const fresh = await record(answer(p.user, 27, [{ raw_content_id: await p.item('journal_entry', 'good today') }]));
  const old = await record(answer(p.user, 27, [{ raw_content_id: await p.item('journal_entry', 'good back then', 14) }]));
  // 14 days is one half-life: the old quote counts half.
  assert.equal((await confidenceOf(fresh)).toFixed(2), '0.33');
  assert.equal((await confidenceOf(old)).toFixed(2), '0.20');
});

test('121: a domain is silent until enough of it is confidently answered', async () => {
  const p = await person();
  const speak = async (domain: string) => (await db.query<{ may_speak: boolean; coverage: string }>(
    `SELECT may_speak, coverage FROM domain_coverage WHERE user_id = $1 AND domain_id = $2`, [p.user, domain])).rows[0]!;

  assert.equal((await speak('who')).may_speak, false, 'nothing known yet');
  assert.equal((await speak('speak')).may_speak, true, 'how to speak to them is always active');

  // Three of the five "who they are" questions, each from one quote (0.33).
  for (const q of [1, 2, 3]) await record(answer(p.user, q, [{ raw_content_id: await p.item('journal_entry', `fact ${q}`) }]));
  assert.deepEqual(await speak('who'), { may_speak: true, coverage: '0.60' });
  assert.equal((await speak('how')).may_speak, false, 'and that unlocks nothing else');
});

test('121: a rejected answer stops being used, and accuracy is its own number', async () => {
  const p = await person();
  const id = await record(answer(p.user, 1, [{ raw_content_id: await p.item('journal_entry', 'I am a designer') }]));
  await db.query(`SELECT record_answer_verdict($1, $2, 'rejected')`, [p.user, id]);
  const { rows } = await db.query(`SELECT 1 FROM current_answers WHERE answer_id = $1`, [id]);
  assert.equal(rows.length, 0);
  const acc = (await db.query<{ accuracy: string }>(`SELECT accuracy FROM answer_accuracy WHERE user_id = $1`, [p.user])).rows[0]!;
  assert.equal(acc.accuracy, '0.00');
});

// ── Migration 122 ───────────────────────────────────────────────────────────

test('122: the researcher can log what it read, and only known outcomes', async () => {
  const user = await insertUser(db);
  await db.query(
    `INSERT INTO question_research_log (user_id, question_id, material_until, items_read, outcome) VALUES ($1, 27, now(), 4, 'strengthened')`,
    [user],
  );
  assert.equal(
    await failureCode(
      `INSERT INTO question_research_log (user_id, question_id, material_until, items_read, outcome) VALUES ($1, 27, now(), 4, 'guessed_wildly')`,
      [user],
    ),
    CHECK_VIOLATION,
  );
});

// ── Migration 123 ───────────────────────────────────────────────────────────

test('123: restores the voice choice on a database that lost it, and changes nothing where it exists', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '123_users_voice_persona.sql'), 'utf8');

  // Where the column exists (here, from the base schema), running it again is harmless.
  await db.exec(sql);

  // Recreate production's state: no column at all. Then apply.
  await db.exec(`ALTER TABLE users DROP COLUMN voice_persona`);
  await db.exec(sql);
  const user = await insertUser(db);
  const { rows } = await db.query<{ voice_persona: string }>(`SELECT voice_persona FROM users WHERE id = $1`, [user]);
  assert.equal(rows[0]!.voice_persona, 'thoughtful_friend', 'existing and new users get the default voice');
  await db.query(`UPDATE users SET voice_persona = 'wise_mentor' WHERE id = $1`, [user]);
  assert.equal(
    await failureCode(`UPDATE users SET voice_persona = 'robot' WHERE id = $1`, [user]),
    CHECK_VIOLATION,
    'only the three real voices',
  );
});

// ── Migration 124 ───────────────────────────────────────────────────────────

async function doc(user: string, authorship: string | null, content: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO raw_content (user_id, content_type, content, authorship) VALUES ($1, 'google_docs', $2, $3) RETURNING id`,
    [user, content, authorship],
  )).rows[0]!.id;
}

test("124: someone else's document cannot speak for them", async () => {
  // "My name is Farza..." sat in the founder's Drive. It is evidence of what is
  // in their life, never of what they want.
  const user = await insertUser(db);
  const brief = await doc(user, 'unknown', 'My name is Farza. I am going all-in on a new interface.');
  assert.equal(await refusal(answer(user, 6, [{ raw_content_id: brief }])), CHECK_VIOLATION);
  const ok = await record(answer(user, 1, [{ raw_content_id: brief }]));
  const { rows } = await db.query<{ kind_id: string }>(`SELECT kind_id FROM answer_evidence WHERE answer_id = $1`, [ok]);
  assert.equal(rows[0]!.kind_id, 'collected_document', 'still evidence, just not their voice');
});

test('124: a document they wrote still counts as their words', async () => {
  const user = await insertUser(db);
  const essay = await doc(user, 'self', 'I want to build something of my own.');
  await record(answer(user, 6, [{ raw_content_id: essay }]));
});

test('124 + 126: an entry typed in the app is theirs, though the app never says so', async () => {
  const user = await insertUser(db);
  const typed = (await db.query<{ id: string; authorship: string }>(
    `INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'text_entry', 'I want to build something of my own.') RETURNING id, authorship`,
    [user],
  )).rows[0]!;
  assert.equal(typed.authorship, 'self');
  await record(answer(user, 6, [{ raw_content_id: typed.id }]));
});

test('126: a Google Doc stays unknown, a step count is no one\'s words, and an explicit label wins', async () => {
  const user = await insertUser(db);
  const labelled = async (type: string, authorship: string | null) => (await db.query<{ authorship: string }>(
    `INSERT INTO raw_content (user_id, content_type, content, authorship) VALUES ($1, $2, 'x', $3) RETURNING authorship`,
    [user, type, authorship],
  )).rows[0]!.authorship;
  assert.equal(await labelled('google_docs', null), 'unknown');
  assert.equal(await labelled('healthkit', null), 'other');
  assert.equal(await labelled('google_docs', 'self'), 'self');
});

test('127: re-reading an entry keeps the note you left when correcting a fact', async () => {
  const s = await factSetup();
  const p = fact(s, [{ raw_content_id: s.entry, excerpt: 'I skipped standup' }], { metadata: { model: 'a' } });
  const id = await writeFact(p);
  // What the backend does when you retire a fact (routes/graph.ts).
  await db.query(
    `UPDATE assertions SET status = 'retired', metadata = metadata || '{"user_feedback_note":"not true any more"}' WHERE id = $1`,
    [id],
  );

  await writeFact({ ...p, metadata: { model: 'b' } }); // the forced re-read

  const { rows: [row] } = await db.query<{ status: string; metadata: Record<string, unknown> }>(
    `SELECT status, metadata FROM assertions WHERE id = $1`, [id]);
  assert.equal(row!.status, 'retired');
  assert.deepEqual(row!.metadata, { model: 'b', user_feedback_note: 'not true any more' });
});

test('127: a fact with no note is re-saved exactly as before', async () => {
  const s = await factSetup();
  const p = fact(s, [{ raw_content_id: s.entry, excerpt: 'I skipped standup' }], { metadata: { model: 'a' } });
  const id = await writeFact(p);
  await writeFact({ ...p, metadata: { model: 'b' } });
  const { rows: [row] } = await db.query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM assertions WHERE id = $1`, [id]);
  assert.deepEqual(row!.metadata, { model: 'b' });
});

// ── 130: evidence weighs its trust class (W1.4) ──────────────────────────────
async function mail(user: string, trustClass: string | null, content: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO raw_content (user_id, content_type, content, authorship, trust_class) VALUES ($1, 'gmail', $2, 'other', $3) RETURNING id`,
    [user, content, trustClass],
  )).rows[0]!.id;
}
const kindsOf = async (answerId: string) =>
  (await db.query<{ kind_id: string }>(`SELECT kind_id FROM answer_evidence WHERE answer_id = $1`, [answerId])).rows.map((r) => r.kind_id);

test("130: another assistant's mail counts as 'automated', not as mail from a person", async () => {
  const user = await insertUser(db);
  const id = await record(answer(user, 1, [{ raw_content_id: await mail(user, 'automated', 'Your morning brief: finish the deck') }]));
  assert.deepEqual(await kindsOf(id), ['automated']);
});

test("130: an assistant's mail can never be someone's own words", async () => {
  const user = await insertUser(db);
  // Question 6 ("what have they said they want") needs their own words.
  assert.equal(await refusal(answer(user, 6, [{ raw_content_id: await mail(user, 'automated', 'You want to raise money') }])), CHECK_VIOLATION);
});

test('130: mail they sent counts as their own words', async () => {
  const user = await insertUser(db);
  const id = await record(answer(user, 6, [{ raw_content_id: await mail(user, 'own_words', 'I want to go all in on this') }]));
  assert.deepEqual(await kindsOf(id), ['sent_mail']);
});

test('130: an item with no trust class yet behaves exactly as before', async () => {
  const user = await insertUser(db);
  const id = await record(answer(user, 1, [{ raw_content_id: await mail(user, null, 'Meeting notes from Priya') }]));
  assert.deepEqual(await kindsOf(id), ['mail']);
});

test('130: automated evidence alone weighs far less than a person\'s message', async () => {
  const user = await insertUser(db);
  const auto = await record(answer(user, 1, [{ raw_content_id: await mail(user, 'automated', 'Daily brief: product designer') }]));
  const human = await record(answer(user, 1, [{ raw_content_id: await mail(user, 'third_party', 'Great working with you on the design') }]));
  assert.ok((await confidenceOf(auto)) < (await confidenceOf(human)));
});

// ── 131: one lineage graph over every claim (F1.2) ───────────────────────────
test('131: answer -> pattern -> fact -> source, and why -> pattern/fact, all appear once in claim_edges', async () => {
  const s = await factSetup();
  const factId = await writeFact(fact(s, [{ raw_content_id: s.entry, excerpt: 'I skipped standup' }]));
  const { rows: [pat] } = await db.query<{ id: string }>(
    `INSERT INTO behavior_patterns (user_id, slug, label, grouping_key, status) VALUES ($1, 'skips-standup', 'Skips standup', 'skipped_or_avoided:standup', 'live') RETURNING id`, [s.user]);
  await db.query(`INSERT INTO behavior_pattern_facts (pattern_id, assertion_id, user_id) VALUES ($1, $2, $3)`, [pat!.id, factId, s.user]);
  const { rows: [why] } = await db.query<{ id: string }>(
    `INSERT INTO behavior_pattern_whys (pattern_id, user_id, mechanism, evidence_assertion_ids) VALUES ($1, $2, 'avoidance', ARRAY[$3::uuid]) RETURNING id`,
    [pat!.id, s.user, factId]);
  const answerId = await record(answer(s.user, 13, [{ pattern_id: pat!.id }]));

  const { rows } = await db.query<{ claim_kind: string; claim_id: string; evidence_kind: string; evidence_id: string }>(
    `SELECT claim_kind, claim_id, evidence_kind, evidence_id FROM claim_edges WHERE user_id = $1 ORDER BY claim_kind, evidence_kind`, [s.user]);
  assert.deepEqual(rows.map((r) => [r.claim_kind, r.evidence_kind, r.evidence_id]), [
    ['answer', 'pattern', pat!.id],
    ['fact', 'raw_content', s.entry],
    ['pattern', 'fact', factId],
    ['why', 'fact', factId],
    ['why', 'pattern', pat!.id],
  ]);
  assert.ok(rows.some((r) => r.claim_kind === 'answer' && r.claim_id === answerId));
  assert.ok(rows.some((r) => r.claim_kind === 'why' && r.claim_id === why!.id));
});

test('131: the app roles cannot read lineage', async () => {
  const { rows } = await db.query<{ anon: boolean; authed: boolean }>(
    `SELECT has_table_privilege('anon', 'claim_edges', 'SELECT') AS anon, has_table_privilege('authenticated', 'claim_edges', 'SELECT') AS authed`);
  assert.deepEqual(rows[0], { anon: false, authed: false });
});

// ── 132: material arrived — the event that starts reading (F3.1) ────────────
const arrivalOf = async (user: string) =>
  (await db.query<{ arrivals: number; claimed_at: string | null }>(`SELECT arrivals, claimed_at FROM material_arrivals WHERE user_id = $1`, [user])).rows[0];
const claimAll = async (quiet = '0 seconds', maxWait = '1 hour') =>
  (await db.query<{ user_id: string; claimed_at: string }>(`SELECT * FROM claim_material_arrivals($1::interval, $2::interval, '15 minutes'::interval, 1000)`, [quiet, maxWait])).rows;
const finish = async (user: string, claimedAt: unknown, ok: boolean) =>
  (await db.query<{ r: string }>(`SELECT finish_material_arrival($1, $2, $3) AS r`, [user, claimedAt, ok])).rows[0]!.r;

test('132: a batch upload is one arrival for that person, counting every item', async () => {
  const user = await insertUser(db);
  await db.query(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'calendar', 'a'), ($1, 'calendar', 'b'), ($1, 'calendar', 'c')`, [user]);
  await db.query(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'd')`, [user]);
  assert.deepEqual(await arrivalOf(user), { arrivals: 4, claimed_at: null });
});

test('132: someone still sending is not claimed until quiet; a long wait is claimed anyway', async () => {
  const user = await insertUser(db);
  await db.query(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'x')`, [user]);
  assert.ok(!(await claimAll('1 hour', '1 hour')).some((r) => r.user_id === user), 'not quiet yet');
  await db.query(`UPDATE material_arrivals SET first_pending_at = now() - interval '11 minutes' WHERE user_id = $1`, [user]);
  assert.ok((await claimAll('1 hour', '10 minutes')).some((r) => r.user_id === user), 'waited too long');
});

test('132: a claim is taken once; finishing spends it, or keeps it if more arrived meanwhile', async () => {
  const user = await insertUser(db);
  await db.query(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'one')`, [user]);
  await db.query(`UPDATE material_arrivals SET last_arrival_at = now() - interval '1 minute' WHERE user_id = $1`, [user]);
  const [c] = (await claimAll()).filter((r) => r.user_id === user);
  assert.ok(c);
  assert.ok(!(await claimAll()).some((r) => r.user_id === user), 'not claimed twice');
  assert.equal(await finish(user, c!.claimed_at, true), 'done');
  assert.equal(await arrivalOf(user), undefined);

  await db.query(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'two')`, [user]);
  await db.query(`UPDATE material_arrivals SET last_arrival_at = now() - interval '1 minute' WHERE user_id = $1`, [user]);
  const [c2] = (await claimAll()).filter((r) => r.user_id === user);
  await db.query(`UPDATE material_arrivals SET last_arrival_at = now() + interval '1 second' WHERE user_id = $1`, [user]);
  assert.equal(await finish(user, c2!.claimed_at, true), 'more_arrived');
  assert.equal((await arrivalOf(user))!.claimed_at, null, 'released, still pending');
});

test('132: a failed run releases the claim so it is tried again', async () => {
  const user = await insertUser(db);
  await db.query(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'x')`, [user]);
  await db.query(`UPDATE material_arrivals SET last_arrival_at = now() - interval '1 minute' WHERE user_id = $1`, [user]);
  const [c] = (await claimAll()).filter((r) => r.user_id === user);
  assert.equal(await finish(user, c!.claimed_at, false), 'released');
  assert.ok((await claimAll()).some((r) => r.user_id === user));
});

test('132: if the arrival record cannot be written, the upload still lands', async () => {
  const user = await insertUser(db);
  await db.query(`ALTER TABLE material_arrivals RENAME TO material_arrivals_away`);
  try {
    await db.query(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'kept')`, [user]);
    assert.equal(await countWhere(`SELECT count(*) AS n FROM raw_content WHERE user_id = $1`, [user]), 1);
  } finally {
    await db.query(`ALTER TABLE material_arrivals_away RENAME TO material_arrivals`);
  }
});

test('132: the app roles cannot see or touch the arrival queue', async () => {
  const { rows } = await db.query<{ anon: boolean; authed: boolean }>(
    `SELECT has_table_privilege('anon', 'material_arrivals', 'SELECT') AS anon, has_table_privilege('authenticated', 'material_arrivals', 'SELECT') AS authed`);
  assert.deepEqual(rows[0], { anon: false, authed: false });
});

// ── 134: daily summaries (W3.1) ──────────────────────────────────────────────
test('134: one summary per person, day and domain; the app roles cannot read it', async () => {
  const user = await insertUser(db);
  await db.query(`INSERT INTO daily_summaries (user_id, day, domain, metrics, items) VALUES ($1, '2026-10-14', 'calendar', '{"events":3}', 3)`, [user]);
  assert.equal(await failureCode(`INSERT INTO daily_summaries (user_id, day, domain) VALUES ($1, '2026-10-14', 'calendar')`, [user]), UNIQUE_VIOLATION);
  assert.equal(await failureCode(`INSERT INTO daily_summaries (user_id, day, domain) VALUES ($1, '2026-10-14', 'vibes')`, [user]), CHECK_VIOLATION);
  const { rows } = await db.query<{ anon: boolean; authed: boolean }>(
    `SELECT has_table_privilege('anon', 'daily_summaries', 'SELECT') AS anon, has_table_privilege('authenticated', 'daily_summaries', 'SELECT') AS authed`);
  assert.deepEqual(rows[0], { anon: false, authed: false });
});

// ── 135: pattern trajectory (W3.3b) ──────────────────────────────────────────
test('135: a pattern can only carry a known trajectory', async () => {
  const user = await insertUser(db);
  const { rows: [p] } = await db.query<{ id: string }>(
    `INSERT INTO behavior_patterns (user_id, slug, label, grouping_key, status, trajectory) VALUES ($1, 'x', 'x', 'k:x', 'live', 'holding') RETURNING id`, [user]);
  assert.ok(p);
  assert.equal(await failureCode(`UPDATE behavior_patterns SET trajectory = 'vibes' WHERE id = $1`, [p!.id]), CHECK_VIOLATION);
});

// ── 136: event categories (W3.5b) ────────────────────────────────────────────
test('136: one decision per title; only known categories; app roles shut out', async () => {
  const user = await insertUser(db);
  await db.query(`INSERT INTO event_categories (user_id, title_key, category, decided_by) VALUES ($1, 'atelier', 'learning', 'model')`, [user]);
  assert.equal(await failureCode(`INSERT INTO event_categories (user_id, title_key, category, decided_by) VALUES ($1, 'atelier', 'social', 'model')`, [user]), UNIQUE_VIOLATION);
  assert.equal(await failureCode(`INSERT INTO event_categories (user_id, title_key, category, decided_by) VALUES ($1, 'x', 'vibes', 'model')`, [user]), CHECK_VIOLATION);
  const { rows } = await db.query<{ anon: boolean }>(`SELECT has_table_privilege('anon', 'event_categories', 'SELECT') AS anon`);
  assert.equal(rows[0]!.anon, false);
});

// ── 137: existing evidence takes its trust-based kind (W1.5) ─────────────────
test('137: evidence recorded before 130 is reclassified by trust; untouched rows keep their kind', async () => {
  const user = await insertUser(db);
  const mail = (await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content, authorship, trust_class) VALUES ($1, 'gmail', 'Your brief', 'other', 'automated') RETURNING id`, [user])).rows[0]!.id;
  const journal = (await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'I want to build') RETURNING id`, [user])).rows[0]!.id;
  const a = await record(answer(user, 6, [{ raw_content_id: mail }, { raw_content_id: journal }]));
  // As if recorded before 130: the mail counted as ordinary mail.
  await db.query(`UPDATE answer_evidence SET kind_id = 'mail' WHERE answer_id = $1 AND raw_content_id = $2`, [a, mail]);
  const before = await countWhere(`SELECT count(*) AS n FROM answer_evidence WHERE answer_id = $1 AND kind_id = 'mail'`, [a]);
  const sql = readFileSync('supabase/migrations/137_reclassify_answer_evidence.sql', 'utf8');
  await db.exec(sql);
  const { rows } = await db.query<{ raw_content_id: string; kind_id: string }>(`SELECT raw_content_id, kind_id FROM answer_evidence WHERE answer_id = $1 ORDER BY kind_id`, [a]);
  assert.equal(before, 1);
  assert.equal(rows.find((r) => r.raw_content_id === mail)!.kind_id, 'automated');
  assert.equal(rows.find((r) => r.raw_content_id === journal)!.kind_id, 'journal', 'an item without a trust class keeps its kind');
});

// ── 138: evidence is retired, never deleted (F1.4b) ──────────────────────────
test('138: a re-derivation retires what it no longer cites; current support ignores it; citing it again revives it', async () => {
  const p = await person();
  const e1 = await p.item('journal_entry', 'I want to build something');
  const e2 = await p.item('journal_entry', 'Still thinking about starting a company');
  const key = `d-${Math.random()}`;
  const a = await record(answer(p.user, 6, [{ raw_content_id: e1 }, { raw_content_id: e2 }], { derivation_key: key }));
  const both = (await confidenceOf(a));
  await record(answer(p.user, 6, [{ raw_content_id: e1 }], { derivation_key: key }));
  const rows = (await db.query<{ raw_content_id: string; retired: boolean }>(`SELECT raw_content_id, retired_at IS NOT NULL AS retired FROM answer_evidence WHERE answer_id = $1`, [a])).rows;
  assert.equal(rows.length, 2, 'nothing deleted');
  assert.equal(rows.find((r) => r.raw_content_id === e2)!.retired, true);
  assert.ok((await confidenceOf(a)) < both, 'confidence counts only current support');
  assert.equal(await countWhere(`SELECT count(*) AS n FROM claim_edges WHERE claim_id = $1`, [a]), 1, 'lineage shows current support only');
  await record(answer(p.user, 6, [{ raw_content_id: e1 }, { raw_content_id: e2 }], { derivation_key: key }));
  assert.equal(await countWhere(`SELECT count(*) AS n FROM answer_evidence WHERE answer_id = $1 AND retired_at IS NULL`, [a]), 2, 'cited again: counts again');
  assert.equal((await confidenceOf(a)).toFixed(3), both.toFixed(3));
});
