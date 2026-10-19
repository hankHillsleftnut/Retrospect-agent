/**
 * F2.2: ask the brain the evaluation questions and score it by ability.
 *
 *   npm run eval:brain                 every persona in tests/fixtures/eval
 *   npm run eval:brain -- --persona maya
 *
 * Each persona is read by the real pipeline (extraction, verification, trust,
 * promoter) into a throwaway in-memory database, so nothing touches production.
 * A reader then answers every question from the stored claims alone. Spends
 * model money (about $0.50 a persona); prints the cost.
 */
import 'dotenv/config';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { freshDatabase, insertUser } from '../tests/support/fresh-database';
import { supabaseOnPglite } from '../tests/support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { config } from '../src/config';
import { runIngest } from '../src/pipelines/ingest';
import { runPromoter } from '../src/brain/run-promoter';
import { walkEvidence, type ClaimKind } from '../src/brain/lineage';
import { claudeJsonCompletion } from '../src/services/anthropic';
import { estimateCostUsd } from '../src/pipelines/trace';
import {
  READER_SYSTEM, readerPrompt, scoreOne, scoreByAbility, type EvalQuestion, type ReaderAnswer,
} from '../src/eval/brain-eval';

const DIR = 'tests/fixtures/eval';
const only = process.argv.includes('--persona') ? process.argv[process.argv.indexOf('--persona') + 1] : null;

interface Persona {
  persona: string; as_of: string;
  items: Array<{ id: string; date: string; content_type: string; trust: string; content: string; metadata?: object }>;
  questions: EvalQuestion[];
}

async function runPersona(p: Persona) {
  const { db } = await freshDatabase();
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const user = await insertUser(db);

  const itemByRow = new Map<string, string>();
  for (const i of p.items) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO raw_content (user_id, content_type, content, metadata, authorship, trust_class, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [user, i.content_type, i.content, JSON.stringify(i.metadata ?? {}), i.trust === 'own_words' ? 'self' : 'other', i.trust, `${i.date}T12:00:00Z`]);
    itemByRow.set(rows[0]!.id, i.id);
  }

  // Read everything, as many runs as the per-run limits need.
  const read: Array<Record<string, unknown>> = [];
  for (let run = 0; run < 6; run++) {
    const s = await runIngest({ userId: user, daysBack: 3650, triggeredBy: 'manual', notes: `eval:${p.persona}` });
    read.push({ processed: s.raw_content_processed, facts: s.facts_written, dropped: s.facts_dropped });
    if (!s.raw_content_processed) break;
  }
  await runPromoter({ userId: user, lookbackDays: 3650 });

  // What the brain kept, as the reader will see it.
  const records: Array<{ id: string; kind: ClaimKind; text: string }> = [];
  const facts = (await db.query<{ id: string; predicate: string; object_value: { normalized?: string; raw?: string }; event_time: string | null; observed_at: string; status: string; valid_to: string | null }>(
    `SELECT id, predicate, object_value, event_time, observed_at, status, valid_to FROM assertions WHERE user_id = $1 ORDER BY coalesce(event_time, observed_at)`, [user])).rows;
  for (const f of facts) {
    const when = new Date(f.event_time ?? f.observed_at).toISOString().slice(0, 10);
    const state = f.valid_to || f.status !== 'active' ? ` [no longer current: ${f.status}]` : '';
    records.push({ id: `f${records.length + 1}`, kind: 'fact', text: `${when}: ${f.predicate.replace(/_/g, ' ')}: ${f.object_value.raw ?? f.object_value.normalized ?? ''}${state}` });
    (records[records.length - 1] as { claimId?: string }).claimId = f.id;
  }
  const patterns = (await db.query<{ id: string; label: string; status: string; n: number; first: string; last: string }>(
    `SELECT p.id, p.label, p.status, count(pf.*)::int n, min(coalesce(a.event_time, a.observed_at))::text first, max(coalesce(a.event_time, a.observed_at))::text last
     FROM behavior_patterns p LEFT JOIN behavior_pattern_facts pf ON pf.pattern_id = p.id LEFT JOIN assertions a ON a.id = pf.assertion_id
     WHERE p.user_id = $1 GROUP BY p.id`, [user])).rows;
  for (const pt of patterns) {
    records.push({ id: `p${records.length + 1}`, kind: 'pattern', text: `pattern (${pt.status}): ${pt.label}; ${pt.n} instances, ${pt.first?.slice(0, 10)} to ${pt.last?.slice(0, 10)}` });
    (records[records.length - 1] as { claimId?: string }).claimId = pt.id;
  }

  // Ask.
  const { data, usage } = await claudeJsonCompletion<{ answers: ReaderAnswer[] }>(
    READER_SYSTEM, readerPrompt(records, p.questions, p.as_of),
    { model: config.anthropic.questionsModel, maxTokens: 6000 });
  const byId = new Map(data.answers.map((a) => [a.id, a]));

  // Score, following each citation down to the persona items it rests on.
  const claimOf = new Map(records.map((r) => [r.id, { kind: r.kind, id: (r as { claimId?: string }).claimId! }]));
  const verdicts = [];
  for (const q of p.questions) {
    const a = byId.get(q.id);
    const cited = new Set<string>();
    for (const c of a?.cites ?? []) {
      const claim = claimOf.get(c);
      if (!claim) continue;
      for (const s of (await walkEvidence(claim)).sources) { const item = itemByRow.get(s.id); if (item) cited.add(item); }
    }
    verdicts.push({ ...scoreOne(q, a, cited), question: q.question, expected: q.abstain ? '(abstain)' : q.answer, got: a ? (a.abstain ? `(abstain) ${a.answer}` : a.answer) : '(none)' });
  }

  const traces = (await db.query<{ cost_breakdown: Parameters<typeof estimateCostUsd>[0] }>(`SELECT cost_breakdown FROM pipeline_run_traces WHERE user_id = $1`, [user])).rows;
  const readingUsd = traces.reduce((n, t) => n + estimateCostUsd(t.cost_breakdown ?? {}).usd, 0);
  const readerUsd = estimateCostUsd({
    openai_tokens_input: 0, openai_tokens_output: 0, perplexity_calls: 0, elevenlabs_chars: 0, embedding_tokens: 0,
    anthropic_tokens_input: usage.inputTokens, anthropic_tokens_output: usage.outputTokens,
    by_model: { [config.anthropic.questionsModel]: { input: usage.inputTokens, output: usage.outputTokens } },
  } as never).usd;
  await db.close();
  return { persona: p.persona, read, records: records.length, facts: facts.length, patterns: patterns.length, verdicts, scores: scoreByAbility(verdicts), usd: { reading: readingUsd, reader: readerUsd } };
}

async function main() {
  const personas = readdirSync(DIR).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Persona)
    .filter((p) => !only || p.persona === only);
  mkdirSync('.eval-results', { recursive: true });
  for (const p of personas) {
    const r = await runPersona(p);
    console.log(`\n${r.persona}: ${r.facts} facts, ${r.patterns} patterns kept from ${p.items.length} items`);
    console.table(r.scores.map((s) => ({ ability: s.ability, score: `${s.correct}/${s.total}`, rate: `${Math.round(s.rate * 100)}%` })));
    const total = r.verdicts.filter((v) => v.correct).length;
    console.log(`overall ${total}/${r.verdicts.length} · cost $${(r.usd.reading + r.usd.reader).toFixed(3)} (reading $${r.usd.reading.toFixed(3)}, questions $${r.usd.reader.toFixed(3)})`);
    for (const v of r.verdicts.filter((x) => !x.correct)) console.log(`  ✗ ${v.id} ${v.question} — ${v.why}`);
    const out = join('.eval-results', `${r.persona}-${new Date().toISOString().slice(0, 16).replace(/:/g, '')}.json`);
    writeFileSync(out, JSON.stringify(r, null, 2));
    console.log(`  full results: ${out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
