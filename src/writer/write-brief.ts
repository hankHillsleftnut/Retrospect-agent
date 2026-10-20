/**
 * The daily brief, written (D1.3).
 *
 * Its own prompt, never the weekly one (spec: the daily fails by being boring,
 * the weekly by being wrong; "they must not share a prompt"). Latitude for a
 * through-line; short on a quiet day. The claim guard checks claims about the
 * person only, so the framing is never sanded down. Each item they sent gets a
 * reason it's worth their attention, drawn only from their stated goals and
 * known answers (given as facts, so the reasons are checked too).
 */

import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { guardSentences, type GuardModel } from './claim-guard';
import { factLines } from './write-episode';
import type { DailyPlan } from '../planner/daily';

export interface BriefSection { id: string; kind: 'inbox' | 'today' | 'item'; facts: string[] }

const time = (iso: string) => /T(\d{2}:\d{2})/.exec(iso)?.[1] ?? '';

/** Sections in order: what they sent, today, what moved. Pure. */
export function briefSections(plan: DailyPlan, context: { goals: string[]; answers: string[] }): BriefSection[] {
  const about = [...context.goals.map((g) => `A goal they stated: ${g}.`), ...context.answers.map((a) => `Known about them: ${a}.`)];
  return [
    ...plan.inbox.map((i) => ({ id: `inbox:${i.id}`, kind: 'inbox' as const, facts: [`They sent this on ${i.at.slice(0, 10)}: "${i.preview}"${i.url ? ` (link: ${i.url})` : ''}`, ...about] })),
    ...(plan.today.length ? [{ id: 'today', kind: 'today' as const, facts: plan.today.map((e) => `On their calendar today: "${e.title}" at ${time(e.start)}${e.end ? `-${time(e.end)}` : ''}${e.withOthers ? `, with ${e.withOthers} other(s)` : ''}.`) }] : []),
    ...plan.items.map((it) => ({ id: it.id, kind: 'item' as const, facts: factLines(it) })),
  ];
}

export const BRIEF_SYSTEM = `You write a short spoken morning brief for one person, from a typed list of sections.
Voice: second person, warm, quick, a little wry; it should be something they look forward to, not a report. Find one thread that ties the day together if there honestly is one.
Sections:
- INBOX: things they sent you to come back to. For each, say what it is in a sentence and why it might matter to them TODAY, using only their stated goals or what's known about them (given in FACTS). If nothing connects, say it's here for them without inventing a reason.
- TODAY: their calendar for the day, briefly.
- ITEM: something that changed; say it plainly with its numbers.
Rules: say nothing about the person that isn't in that section's FACTS. Connecting lines that claim nothing about them get section "craft". If there are no sections, write one or two sentences saying it's a quiet day.
Reply with JSON only: {"title":"<few words>","sentences":[{"section":"<section id or craft>","text":"..."}]}`;

export interface WrittenBrief { title: string; text: string; kept: number; cut: Array<{ sentence: string; reason: string }>; usage: { writer: ClaudeUsage; guard: ClaudeUsage } }

export type BriefWriter = (system: string, prompt: string) => Promise<{ data: { title?: unknown; sentences?: Array<{ section?: unknown; text?: unknown }> }; usage: ClaudeUsage }>;

export async function writeBrief(sections: BriefSection[], options: { asOf: string; writer?: BriefWriter; guard?: GuardModel }): Promise<WrittenBrief> {
  const writer: BriefWriter = options.writer ?? ((s, p) => claudeJsonCompletion(s, p, { model: config.anthropic.writerModel, maxTokens: 2500 }));
  const prompt = sections.length
    ? sections.map((s) => `SECTION ${s.id} [${s.kind.toUpperCase()}]\nFACTS:\n${s.facts.map((f) => `- ${f}`).join('\n')}`).join('\n\n')
    : 'No sections today.';
  const { data, usage: writerUsage } = await writer(BRIEF_SYSTEM, `Today is ${options.asOf}.\n\n${prompt}`);
  const byId = new Map(sections.map((s) => [s.id, s]));
  const lines = (data.sentences ?? []).filter((x) => typeof x.text === 'string' && x.text).map((x) => ({ facts: byId.get(String(x.section))?.facts ?? [], text: String(x.text) }));
  const { results, usage: guardUsage } = lines.length
    ? await guardSentences(lines.map((l) => ({ text: l.text, evidence: l.facts })), options.guard, options.asOf)
    : { results: [], usage: { inputTokens: 0, outputTokens: 0 } };
  const kept = lines.filter((_, i) => results[i]!.verdict === 'supported').map((l) => l.text);
  return {
    title: typeof data.title === 'string' ? data.title : 'Today',
    text: kept.join(' '),
    kept: kept.length,
    cut: lines.flatMap((l, i) => (results[i]!.verdict === 'supported' ? [] : [{ sentence: l.text, reason: results[i]!.reason }])),
    usage: { writer: writerUsage, guard: guardUsage },
  };
}
