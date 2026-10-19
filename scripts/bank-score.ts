#!/usr/bin/env tsx
/**
 * `npm run bank:score` -- run today's extractor on the test bank and score it.
 *
 *   npm run bank:score                 all entries
 *   npm run bank:score -- --only 41    one entry (by its number)
 *   npm run bank:score -- --extractor facts-only   the Option F extractor instead of the live one
 *   npm run bank:score -- --extractor facts-only --model claude-haiku-5-5   ...on another model
 *
 * Reads test-bank/ (local, never committed). Calls the extractor once per
 * entry, exactly as ingestion would for that one item, then a judge once per
 * entry to check the extracted facts against the "should not" list. Writes the
 * full result to test-bank/results/ and prints the two numbers the Phase 3
 * brief declared: recall and false positives. Saves nothing to the database.
 */
import 'dotenv/config';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { parseArgs } from './_args';
import { runIngestionAgent } from '../src/agents/ingestion-agent';
import { extractFacts } from '../src/agents/fact-extractor';
import { claudeJsonCompletion } from '../src/services/anthropic';
import { Trace, costLines, estimateCostUsd, formatCostLines } from '../src/pipelines/trace';
import { config } from '../src/config';
import {
  attributedFromOthers, scoreRecall, totals,
  type BankExpectation, type Candidate, type EntryScore,
} from '../src/eval/bank-score';

const BANK = join(__dirname, '..', 'test-bank');

const JUDGE_SYSTEM = `You check an information extractor's output against a list of conclusions that would be WRONG for this piece of writing.

For each extracted fact, decide whether it asserts, implies, or is substantially the same as any of the forbidden conclusions. Be strict about meaning, not wording: "survived abuse" and "grew up in an abusive home" are the same claim. A fact that merely mentions the same topic without making the forbidden claim is NOT a match.

The forbidden conclusions are about THE WRITER. A fact whose subject is someone else (a named person, a company, a document's author) is a statement about them, not about the writer, and is NOT a match -- unless its wording puts the claim in the writer's mouth.

Return STRICT JSON only: {"matches": [{"fact": <index>, "forbidden": <index>}]}`;

async function judge(facts: Candidate[], forbidden: { claim: string; why: string }[], trace: Trace) {
  if (facts.length === 0 || forbidden.length === 0) return [] as { fact: number; forbidden: number }[];
  const user = `# Forbidden conclusions\n${forbidden.map((f, i) => `${i}. ${f.claim} -- ${f.why}`).join('\n')}\n\n# Extracted facts\n${
    facts.map((f, i) => `${i}. subject=${f.subject} | ${f.predicate} | ${f.object} | quote: "${f.excerpt}"`).join('\n')}`;
  const { data, usage } = await claudeJsonCompletion<{ matches?: { fact: number; forbidden: number }[] }>(
    JUDGE_SYSTEM, user, { maxTokens: 1500, model: config.anthropic.questionsModel });
  trace.addCost({ anthropic_tokens_input: usage.inputTokens, anthropic_tokens_output: usage.outputTokens }, config.anthropic.questionsModel);
  return (data.matches ?? []).filter((m) => facts[m.fact] && forbidden[m.forbidden]);
}

async function main() {
  const args = parseArgs();
  const only = typeof args.only === 'string' ? args.only.padStart(2, '0') : null;
  const extractor = args.extractor === 'facts-only' ? 'facts-only' : 'live';
  const model = typeof args.model === 'string' ? args.model : config.openai.chatModel;
  if (extractor === 'live' && model !== config.openai.chatModel) throw new Error('--model applies to the facts-only extractor');
  const seconds: number[] = [];
  console.log(`Extractor: ${extractor === 'live' ? 'live (ingestion-agent.ts)' : 'facts-only (fact-extractor.ts, Option F)'}\n`);
  const trace = Trace.forTesting();
  const files = readdirSync(join(BANK, 'expected')).filter((f) => f.endsWith('.yaml') && (!only || f.startsWith(only))).sort();
  const scores: EntryScore[] = [];

  for (const file of files) {
    const exp = parse(readFileSync(join(BANK, 'expected', file), 'utf8')) as BankExpectation;
    const text = readFileSync(join(BANK, 'entries', exp.entry), 'utf8');
    const [, date, type] = /^\d+-(\d{4}-\d{2}-\d{2})-([a-z_]+?)(?:-|\.md)/.exec(exp.entry) ?? [];
    const rc = {
      id: `bank-${exp.entry}`, user_id: 'bank', content_type: type ?? 'text_entry', content: text,
      content_date: `${date}T12:00:00Z`, created_at: `${date}T12:00:00Z`, metadata: {}, processing_status: 'pending',
      // What production would know: a Google Doc's author can't be told from the file.
      authorship: type === 'google_docs' ? 'unknown' : 'self',
    } as any;

    const started = Date.now();
    const raw = extractor === 'facts-only'
      ? await extractFacts({ items: [rc], trace, model })
      : (await runIngestionAgent({
          newRawContent: [rc], recentInsights: [], activeGoals: [], openGoalCandidates: [], currentDocument: null, trace,
        })).fact_candidates ?? [];
    seconds.push((Date.now() - started) / 1000);
    const candidates = (raw as any[]).map((c) => ({
      subject: String(c.subject ?? ''), predicate: String(c.predicate ?? ''), object: String(c.object ?? ''), excerpt: String(c.excerpt ?? ''),
    }));

    const recall = scoreRecall(text, exp.should_extract ?? [], candidates);
    const verified = recall.verified.map((v) => v.candidate);
    const forbidden = exp.should_not_extract ?? [];
    const judged = await judge(verified, forbidden, trace);
    const fromOthers = attributedFromOthers(exp.authorship ?? '', verified);
    const fp = new Map<Candidate, string>();
    for (const m of judged) fp.set(verified[m.fact]!, forbidden[m.forbidden]!.claim);
    for (const c of fromOthers) if (!fp.has(c)) fp.set(c, "a claim about the user from someone else's words");

    const score: EntryScore = {
      entry: exp.entry, cases: exp.cases ?? [], expected: (exp.should_extract ?? []).length,
      found: recall.found, missed: recall.missed, candidates: candidates.length, unverifiable: recall.unverifiable,
      falsePositives: [...fp].map(([candidate, matches]) => ({ candidate, matches })),
    };
    scores.push(score);
    const r = score.expected ? `${score.found.length}/${score.expected}` : '  -';
    console.log(`${exp.entry.slice(0, 44).padEnd(44)} recall ${r.padStart(5)}  facts ${String(score.candidates).padStart(3)}  unverifiable ${score.unverifiable}  WRONG ${score.falsePositives.length}`);
  }

  const t = totals(scores);
  const usd = estimateCostUsd(trace.snapshot().cost_breakdown).usd;
  console.log(`\nRecall ${t.found}/${t.expected} = ${Math.round(t.recall * 100)}%   False positives ${t.falsePositives}   Unverifiable quotes ${t.unverifiable}/${t.candidates}`);
  const sorted = [...seconds].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 0;
  console.log(`Speed: ${median.toFixed(1)}s median, ${p90.toFixed(1)}s slowest-10% per entry (${model})`);
  const lines = costLines(trace.snapshot().cost_breakdown);
  console.log(`\nCost:\n${formatCostLines(lines, {
    [model]: `the ${extractor} extractor being tested, one call per entry`,
    [config.anthropic.questionsModel]: 'the judge checking extracted facts against the "should not" list',
  })}`);
  for (const s of scores) for (const f of s.falsePositives) console.log(`  WRONG in ${s.entry.slice(0, 30)}: "${f.candidate.object}" -- matches: ${f.matches}`);

  mkdirSync(join(BANK, 'results'), { recursive: true });
  const out = join(BANK, 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(out, JSON.stringify({ extractor, model, speed: { median, p90 }, totals: t, costUsd: usd, cost: lines, scores }, null, 2));
  console.log(`\nFull result: ${out}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
