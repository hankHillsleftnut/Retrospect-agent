#!/usr/bin/env tsx
/**
 * `npm run eval:guard [-- --model claude-haiku-5-5]`: gate W6 for the claim
 * guard. Bar (declared in #54): >= 90% of cases right and every must_catch
 * case caught. Fictional sentences only; costs a fraction of a cent.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { claudeJsonCompletion } from '../src/services/anthropic';
import { guardSentences } from '../src/writer/claim-guard';

const model = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1]! : 'claude-haiku-5-5';
const gate = JSON.parse(readFileSync('tests/fixtures/gates/w6-grounding.json', 'utf8')) as {
  cases: Array<{ id: string; sentence: string; evidence: string[]; register?: 'asked'; expect: 'supported' | 'unsupported'; must_catch?: boolean }>;
};

(async () => {
  const { results, usage } = await guardSentences(gate.cases.map((c) => ({ text: c.sentence, evidence: c.evidence, register: c.register ?? 'stated' })),
    (s, p) => claudeJsonCompletion(s, p, { model, maxTokens: 4000 }), '2026-10-19');
  let right = 0, missed = 0;
  gate.cases.forEach((c, i) => {
    const r = results[i]!;
    const ok = r.verdict === c.expect;
    if (ok) right++;
    if (c.must_catch && r.verdict !== 'unsupported') missed++;
    console.log(`${ok ? '✓' : '✗'} ${c.id} expected ${c.expect}, got ${r.verdict}: ${r.reason}`);
  });
  console.log(`\n${model}: ${right}/${gate.cases.length} right · must-catch missed: ${missed} · gate ${right / gate.cases.length >= 0.9 && missed === 0 ? 'PASSED' : 'FAILED'} · tokens ${usage.inputTokens}+${usage.outputTokens}`);
})();
