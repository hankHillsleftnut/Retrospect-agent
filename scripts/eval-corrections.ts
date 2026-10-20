/**
 * `npm run eval:corrections`: gate F-C3 (goal 20). Twenty things a person might
 * say, over a small fixture brain, in dry-run mode. Right = applied to the
 * right claim, or asked with the right claim first. Wrong applications and
 * applied non-corrections must both be 0.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { freshDatabase, insertUser } from '../tests/support/fresh-database';
import { supabaseOnPglite } from '../tests/support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { handleCorrection } from '../src/corrections/target';

type Claim = { i: number; kind: 'fact' | 'answer' | 'pattern'; a: string | number; b: string };
(async () => {
  const gate = JSON.parse(readFileSync('tests/fixtures/gates/f-c-targeting.json', 'utf8')) as { claims: Claim[]; cases: Array<{ id: string; text: string; expect: number | null }> };
  const { db } = await freshDatabase();
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const user = await insertUser(db);
  const one = async (sql: string, p: unknown[]) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;
  const self = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`, [user]);
  const ids = new Map<number, string>();
  for (const c of gate.claims) {
    const item = await one(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', $2) RETURNING id`, [user, c.b]);
    if (c.kind === 'fact') ids.set(c.i, await one(`SELECT write_fact($1::jsonb) AS id`, [JSON.stringify({ user_id: user, subject_entity_id: self, predicate: c.a, object_value: { normalized: c.b, raw: c.b }, origin_key: `k${c.i}`, evidence: [{ raw_content_id: item, excerpt: c.b }] })]));
    else if (c.kind === 'answer') ids.set(c.i, await one(`SELECT record_answer($1::jsonb) AS id`, [JSON.stringify({ user_id: user, question_id: c.a, answer: c.b, derived_by: 'first_pass', derivation_key: `d${c.i}`, evidence: [{ raw_content_id: item, excerpt: c.b }] })]));
    else ids.set(c.i, await one(`INSERT INTO behavior_patterns (user_id, slug, label, grouping_key, status) VALUES ($1, $2, $3, $2, 'live') RETURNING id`, [user, c.a, c.b]));
  }

  let right = 0, wrongApplied = 0, nonApplied = 0, cost = 0;
  for (const c of gate.cases) {
    const r = await handleCorrection(user, c.text, { dryRun: true });
    cost += (r.usage.inputTokens * 3 + r.usage.outputTokens * 15) / 1e6;
    const want = c.expect === null ? null : ids.get(c.expect)!;
    let ok = false, note = '';
    if (want === null) { ok = r.outcome !== 'applied'; if (!ok) { nonApplied++; note = `applied to "${r.outcome === 'applied' ? r.target.text : ''}"`; } }
    else if (r.outcome === 'applied') { ok = r.target.id === want; if (!ok) { wrongApplied++; note = `applied to the WRONG claim: "${r.target.text}"`; } }
    else if (r.outcome === 'confirm') { ok = r.candidates[0]?.id === want; note = ok ? '(asked, right claim first)' : `asked; right claim ${r.candidates.some((x) => x.id === want) ? 'not first' : 'not among candidates'}`; }
    else note = 'missed: not seen as a correction';
    if (ok) right++;
    console.log(`  ${ok ? '✓' : '✗'} ${c.id} "${c.text}" ${note}`);
  }
  const rate = right / gate.cases.length;
  console.log(`\nright ${right}/${gate.cases.length} (${Math.round(rate * 100)}%) · wrong claim applied ${wrongApplied} · non-corrections applied ${nonApplied} · $${cost.toFixed(3)}`);
  console.log(`gate F-C3 ${rate >= 0.9 && wrongApplied === 0 && nonApplied === 0 ? 'PASSED' : 'FAILED'}`);
})();
