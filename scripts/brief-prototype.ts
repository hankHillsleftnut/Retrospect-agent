#!/usr/bin/env tsx
/**
 * `npm run brief:prototype -- --user <id> --days 2026-10-18,2026-09-27`
 *
 * Phase 5.2 prototype (docs/second-brain/brief-phase-5-coherence.md). For each
 * day, writes two text-only daily briefs from that day's own writing and the
 * person's current answers, and measures whether each hangs together:
 *
 *   B  question-led: pick the one answer the day's writing moves most; that is
 *      the spine, and items are chosen because they bear on it.
 *   A  items-first: pick the most relevant items, then find a thread.
 *
 * A separate judge rates every item against its brief's stated through-line.
 * Spine rate = items that genuinely bear on it / all items.
 *
 * Read-only: nothing is written to the database. No audio. Prints the cost.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { parseArgs, requireArg } from './_args';
import { supabase } from '../src/db/supabase';
import { claudeJsonCompletion, type ClaudeUsage } from '../src/services/anthropic';
import { costLines, estimateCostUsd, formatCostLines } from '../src/pipelines/trace';

const WRITER = 'claude-sonnet-5-5';
const JUDGE = 'claude-haiku-5-5';
const DAY_CHARS = 9_000;

interface Item { text: string; source_quote: string; bears_on_spine: string | null }
interface Brief { spine_question_id?: number | null; spine_movement?: string; through_line: string; items: Item[] }
interface Verdict {
  through_line_specificity: 'specific' | 'general' | 'vague';
  specificity_why: string;
  verdicts: Array<{ index: number; rating: 'bears' | 'forced' | 'unrelated'; why: string }>;
}

const usage: Record<string, { input: number; output: number; calls: number }> = {};
function count(model: string, u: ClaudeUsage) {
  const m = (usage[model] ??= { input: 0, output: 0, calls: 0 });
  m.input += u.inputTokens; m.output += u.outputTokens; m.calls += 1;
}

const RULES = `Rules for anything said about the person:
- Only claim what the writing or the answers support. Hedge where hedging is honest.
- Never assume pronouns; use "you".
- Each item quotes the exact words from today's writing it rests on (source_quote), copied verbatim.
Write warmly and plainly, as a friend who has read everything would. Short items, 1-3 sentences each.
Reply with JSON only.`;

const SYSTEM_B = `You write a short daily brief for one person, organised around ONE through-line.

Step 1. Read today's writing against their current answers to 36 questions about who they are. Pick the ONE question whose answer today's writing moves most -- strengthens, weakens, complicates, or contradicts. That question is the spine.
Step 2. State the through-line in one sentence: what today's writing shows about that question.
Step 3. Choose 1-4 items from today's writing that bear on the spine. For each, bears_on_spine says how, in a few words. Two strong items beat four mixed ones: if you need more than one short clause to explain how an item connects, it does not belong -- drop it or make it the aside. Anything worth mentioning that does not bear on it may be one extra item with bears_on_spine = null (an "also"). If nothing in today's writing moves any answer, return a single short item and say so.

${RULES}
{"spine_question_id": n, "spine_movement": "strengthens|weakens|complicates|contradicts", "through_line": "...", "items": [{"text": "...", "source_quote": "...", "bears_on_spine": "..." | null}]}`;

const SYSTEM_A = `You write a short daily brief for one person.

Step 1. From today's writing, choose the 3-5 things most relevant to who this person is and what they are trying to do (their current answers are below).
Step 2. Then write one sentence: the through-line that connects them.

${RULES}
{"through_line": "...", "items": [{"text": "...", "source_quote": "...", "bears_on_spine": "how this item connects to the through-line"}]}`;

const SYSTEM_JUDGE = `You judge whether a short brief hangs together. You get its stated through-line and its items.
For each item, rate:
- "bears": it genuinely bears on the through-line; a reader would see why it is there.
- "forced": the brief claims a connection, but it is a stretch.
- "unrelated": it does not bear on the through-line (fine only if the brief marked it as an aside).
Be strict: a connection that only works because of vague wording is "forced".
Also rate the through-line itself:
- "specific": it makes one particular, checkable point about this person today.
- "general": true, but it could describe most days or most ambitious people.
- "vague": broad enough that almost anything would fit under it.
Reply with JSON only: {"through_line_specificity": "specific|general|vague", "specificity_why": "...", "verdicts": [{"index": 0, "rating": "bears|forced|unrelated", "why": "..."}]}`;

async function main() {
  const args = parseArgs();
  const userId = requireArg(args, 'user');
  const days = requireArg(args, 'days').split(',').map((d) => d.trim());
  const out = typeof args.out === 'string' ? args.out : 'brief-prototype.md';

  const [{ data: answers }, { data: questions }] = await Promise.all([
    supabase.from('current_answers').select('question_id,answer,confidence').eq('user_id', userId),
    supabase.from('canonical_questions').select('id,text'),
  ]);
  const qText = new Map((questions ?? []).map((q: any) => [q.id, q.text]));
  const profile = (answers ?? [])
    .sort((a: any, b: any) => a.question_id - b.question_id)
    .map((a: any) => `Q${a.question_id} ${qText.get(a.question_id)} -> ${a.answer} (confidence ${Number(a.confidence).toFixed(2)})`)
    .join('\n');

  const report: string[] = [
    `# Through-line prototype`, '',
    `Writer ${WRITER}, judge ${JUDGE}. ${answers?.length ?? 0} current answers. Text only, nothing saved.`, '',
    `Caveat: the answers were derived from all writing, including these days, so "what moved" is simulated.`, '',
  ];
  const totals = { A: { bears: 0, all: 0, specific: 0, briefs: 0 }, B: { bears: 0, all: 0, specific: 0, briefs: 0 } };

  for (const day of days) {
    const { data: rows } = await supabase.from('raw_content')
      .select('content,content_type,content_date,created_at')
      .eq('user_id', userId).eq('authorship', 'self')
      .gte('content_date', `${day}T00:00:00Z`).lte('content_date', `${day}T23:59:59Z`);
    const today = (rows ?? [])
      .filter((r: any) => r.content_type !== 'onboarding_profile')
      .map((r: any) => `[${r.content_type}] ${r.content}`).join('\n\n---\n\n').slice(0, DAY_CHARS);
    if (!today.trim()) { report.push(`## ${day}`, '', '_No own writing that day._', ''); continue; }

    const user = `CURRENT ANSWERS\n${profile}\n\nTODAY'S WRITING (${day})\n${today}`;
    report.push(`## ${day}`, '');
    for (const [label, system] of [['B', SYSTEM_B], ['A', SYSTEM_A]] as const) {
      const { data: brief, usage: u } = await claudeJsonCompletion<Brief>(system, user, { model: WRITER, maxTokens: 3000 });
      count(WRITER, u);
      const itemsText = brief.items.map((it, i) => `${i}. ${it.text}${it.bears_on_spine ? '' : ' [marked as an aside]'}`).join('\n');
      const { data: judged, usage: ju } = await claudeJsonCompletion<Verdict>(
        SYSTEM_JUDGE, `THROUGH-LINE: ${brief.through_line}\n\nITEMS:\n${itemsText}`, { model: JUDGE, maxTokens: 1500 });
      count(JUDGE, ju);
      const ratings = new Map(judged.verdicts.map((v) => [v.index, v]));
      // Asides the brief itself flagged are not counted against it.
      const counted = brief.items.map((it, i) => ({ it, v: ratings.get(i) })).filter(({ it }) => it.bears_on_spine !== null);
      const bears = counted.filter(({ v }) => v?.rating === 'bears').length;
      totals[label].bears += bears; totals[label].all += counted.length;
      totals[label].briefs += 1; if (judged.through_line_specificity === 'specific') totals[label].specific += 1;

      const name = label === 'B' ? 'B — one moving question' : 'A — items first, then a thread';
      const spine = label === 'B' && brief.spine_question_id
        ? ` Spine: Q${brief.spine_question_id} "${qText.get(brief.spine_question_id)}" (${brief.spine_movement}).` : '';
      report.push(`### ${name}`, '', `**Through-line:** ${brief.through_line}${spine}`, '', `Through-line judged **${judged.through_line_specificity}** — ${judged.specificity_why}`, '');
      brief.items.forEach((it, i) => {
        const v = ratings.get(i);
        report.push(`${i + 1}. ${it.text}${it.bears_on_spine ? '' : ' _(aside)_'}  \n   > "${it.source_quote}"  \n   Judge: **${v?.rating ?? '?'}** — ${v?.why ?? ''}`);
      });
      report.push('', `Spine rate: ${bears} of ${counted.length}`, '');
    }
  }

  const breakdown = {
    openai_tokens_input: 0, openai_tokens_output: 0,
    anthropic_tokens_input: Object.values(usage).reduce((a, m) => a + m.input, 0),
    anthropic_tokens_output: Object.values(usage).reduce((a, m) => a + m.output, 0),
    embedding_tokens: 0, perplexity_calls: 0, elevenlabs_chars: 0, est_usd: 0,
    by_model: usage,
  };
  const pct = (t: { bears: number; all: number }) => (t.all ? Math.round((100 * t.bears) / t.all) : 0);
  report.splice(6, 0,
    `| | Spine rate (target ≥ 80%) | Through-line specific |`, `|---|---|---|`,
    `| B — one moving question | **${pct(totals.B)}%** (${totals.B.bears}/${totals.B.all}) | ${totals.B.specific} of ${totals.B.briefs} |`,
    `| A — items first | **${pct(totals.A)}%** (${totals.A.bears}/${totals.A.all}) | ${totals.A.specific} of ${totals.A.briefs} |`, '',
    `Cost: $${estimateCostUsd(breakdown as any).usd.toFixed(2)}`, '',
    '```', formatCostLines(costLines(breakdown as any), { [WRITER]: 'writing the briefs', [JUDGE]: 'judging each item' }), '```', '');
  writeFileSync(out, report.join('\n'));
  console.log(`B ${pct(totals.B)}% (${totals.B.specific}/${totals.B.briefs} specific)  A ${pct(totals.A)}% (${totals.A.specific}/${totals.A.briefs} specific)  · $${estimateCostUsd(breakdown as any).usd.toFixed(2)} · ${out}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
