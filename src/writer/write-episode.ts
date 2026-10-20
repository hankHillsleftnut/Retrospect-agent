/**
 * The episode script, written from the plan and checked sentence by sentence (W6.2).
 *
 * Goal 13: the outline is TYPED and every section carries its evidence. It is
 * built from the plan in code, not by a model. Goal 14: one writing pass turns
 * it into speech in two registers, and the claim guard (W6.1) checks every
 * sentence against its own section's facts. An unsupported statement is cut;
 * an "asked" sentence that doesn't read as a question is cut. The cuts are
 * counted, so the writer's grounding is measured, not hoped for.
 * "Conservative about claims, never about craft": the guard checks claims
 * about the person only; the writing is free to be vivid.
 */

import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { guardSentences, type GuardModel } from './claim-guard';
import type { EpisodePlan, PlanItem } from '../planner/plan';

export interface OutlineSection { id: string; role: 'spine' | 'item' | 'question'; register: 'stated' | 'asked'; facts: string[] }

/** A plan item's facts as plain lines: the only ground its sentences may stand on. Pure. */
export function factLines(item: PlanItem): string[] {
  const f = item.facts as Record<string, any>;
  switch (item.kind) {
    case 'pattern': {
      const lines = [`A recurring pattern: ${f.label} (${f.instances} times recorded).`];
      if (f.counts && (f.trajectory === 'weakening' || f.trajectory === 'strengthening')) lines.push(`It is ${f.trajectory}: ${f.counts.prior} times in the four weeks before, ${f.counts.recent} in the last four.`);
      else if (f.counts) lines.push(`Not enough evidence yet to say whether it is changing (${f.counts.prior} before, ${f.counts.recent} recently).`);
      return lines;
    }
    case 'answer':
      return [`Asked "${f.question}", the evidence points to: ${f.answer}.`, f.confirmedByYou ? 'They confirmed this themselves.' : `How sure: ${Math.round(Number(f.confidence) * 100)}%, from ${f.sources} independent source(s).`];
    case 'shift':
      return [`This week, ${f.what} were ${f.direction === 'up' ? 'up' : 'down'}: median ${f.thisWeek} a day against ${f.usual} in the four weeks before (${f.days} recorded days).`];
    case 'said_vs_did':
      return [`A goal they stated: "${f.goal}" (stated ${String(f.said?.statedAt ?? '').slice(0, 10)}${f.said?.lastMentionedAt ? `, last mentioned ${String(f.said.lastMentionedAt).slice(0, 10)}` : ''}).`,
        `What they did toward it: ${f.did.hoursThisWeek} hours booked this week against ${f.did.hoursUsualWeek} in a usual week, across ${f.did.events} calendar events; ${f.did.contentItems} related things watched; related patterns: ${(f.did.patterns ?? []).join(', ') || 'none'}.`];
    case 'content':
      return [`Something they chose to follow or watch: ${f.items} items about ${f.topic ?? 'one topic'} in the last four weeks.`];
  }
}

/** The typed outline, in order: spine, items, then at most one asked question. Pure. */
export function outlineFromPlan(plan: EpisodePlan): OutlineSection[] {
  const sections: OutlineSection[] = plan.items.map((item, i) => ({ id: item.id, role: i === 0 ? 'spine' : 'item', register: item.register, facts: factLines(item) }));
  if (plan.reflection) {
    const pattern = plan.items.find((i) => i.id === `pattern:${plan.reflection!.patternId}`);
    const mech: Record<string, string> = { avoidance: 'it might be a way of avoiding something', ambivalence: 'part of them might want it and part might not', capacity: 'it might be about having too little left in the tank' };
    sections.push({ id: `why:${plan.reflection.whyId}`, role: 'question', register: 'asked',
      facts: [...(pattern ? factLines(pattern) : []), `A possibility to ASK about, never to state: ${mech[plan.reflection.mechanism] ?? plan.reflection.mechanism}.`] });
  }
  return sections;
}

export const WRITER_SYSTEM = `You write the script of a short personal audio episode, spoken by a host to one listener.

Voice: second person ("you"); the host is "I". Warm, direct, specific, never clinical, never a performance review. Short sentences that sound good out loud. Open with momentum (a specific observation or a question), never "Welcome" or a sigh.

You get a typed outline. For each section, write 2-5 sentences, in order. Rules:
- Say nothing about the listener that isn't in that section's FACTS. Numbers, dates and counts exactly as given. No feelings, motives or relationships unless a fact states them.
- A STATED section may state its facts plainly. An ASKED section must be phrased as questions or open wonderings ("I wonder whether..."), never as a conclusion.
- Lay out evidence and let the listener draw the conclusion; don't tell them what it means about them.
- Figurative language, transitions and warmth are welcome; they are craft, not claims.
- If the last section is a question, end the episode on it, and leave space for it.
Reply with JSON only: {"title":"<short episode title>","sections":[{"id":"<section id>","sentences":["...","..."]}]}`;

/**
 * W6.3: how much the writing is steered is an experiment, not a decision
 * (founder, 19 Oct). Three writers on the same outline; every sentence still
 * names the section it rests on, so the same guard judges all three.
 */
export type WriterStyle = 'heavy' | 'medium' | 'light';

const SHAPE: Record<WriterStyle, string> = {
  heavy: `Write each section in order, 2-5 sentences each.`,
  medium: `Weave the sections into ONE narrative thread: open on the spine, let each section lead into the next with a real transition, and build toward the end. Aim for 600-900 words in all. You may add short connecting sentences that make no claim about the listener; give them the section id "craft".`,
  light: `Here is everything you may say about the listener. Shape the episode however you think will be most worth listening to: order, length and structure are yours. Every sentence must still name the section whose facts it rests on, or "craft" if it makes no claim about the listener.`,
};

export function writerSystem(style: WriterStyle): string {
  return WRITER_SYSTEM
    .replace('For each section, write 2-5 sentences, in order. Rules:', `${SHAPE[style]} Rules:`)
    .replace('Reply with JSON only: {"title":"<short episode title>","sections":[{"id":"<section id>","sentences":["...","..."]}]}',
      style === 'heavy'
        ? 'Reply with JSON only: {"title":"<short episode title>","sections":[{"id":"<section id>","sentences":["...","..."]}]}'
        : 'Reply with JSON only: {"title":"<short episode title>","sentences":[{"section":"<section id or craft>","text":"..."}]} in the order they are spoken.');
}

export function writerPrompt(outline: OutlineSection[], listener: { name?: string | null; tone?: string | null } = {}): string {
  return [
    listener.name ? `LISTENER: ${listener.name}` : null,
    listener.tone ? `HOW THEY LIKE TO BE SPOKEN TO: ${listener.tone}` : null,
    'OUTLINE',
    ...outline.map((s) => `SECTION ${s.id} [${s.role}, ${s.register.toUpperCase()}]\nFACTS:\n${s.facts.map((f) => `- ${f}`).join('\n')}`),
  ].filter(Boolean).join('\n\n');
}

export interface WrittenEpisode {
  title: string;
  sections: Array<{ id: string; register: 'stated' | 'asked'; kept: string[]; cut: Array<{ sentence: string; reason: string }> }>;
  stats: { sentences: number; kept: number; cut: number; sectionsWithEvidence: number; sections: number; words: number };
  usage: { writer: ClaudeUsage; guard: ClaudeUsage };
}

export type WriterModel = (system: string, prompt: string) => Promise<{ data: { title?: unknown; sections?: Array<{ id?: unknown; sentences?: unknown }> }; usage: ClaudeUsage }>;

export async function writeEpisode(plan: EpisodePlan, options: { asOf: string; style?: WriterStyle; listener?: { name?: string | null; tone?: string | null }; writer?: WriterModel; guard?: GuardModel } = { asOf: new Date().toISOString().slice(0, 10) }): Promise<WrittenEpisode> {
  const outline = outlineFromPlan(plan);
  const writer: WriterModel = options.writer ?? ((s, p) => claudeJsonCompletion(s, p, { model: config.anthropic.writerModel, maxTokens: 4000 }));
  const style = options.style ?? 'heavy';
  const { data, usage: writerUsage } = await writer(writerSystem(style), writerPrompt(outline, options.listener));
  const craft: OutlineSection = { id: 'craft', role: 'item', register: 'stated', facts: [] };
  const byId = new Map(outline.map((s) => [s.id, s]));
  let flat: Array<{ sec: OutlineSection; text: string }>;
  if (style === 'heavy') {
    const written = new Map((data.sections ?? []).map((s) => [String(s.id), Array.isArray(s.sentences) ? (s.sentences as unknown[]).map(String).filter(Boolean) : []]));
    flat = outline.flatMap((sec) => (written.get(sec.id) ?? []).map((text) => ({ sec, text })));
  } else {
    // Spoken order as written; an unknown section id is treated as craft (no
    // facts), so any claim it makes about the listener is cut.
    const list = Array.isArray((data as { sentences?: unknown }).sentences) ? ((data as { sentences: Array<{ section?: unknown; text?: unknown }> }).sentences) : [];
    flat = list.filter((x) => typeof x.text === 'string' && x.text).map((x) => ({ sec: byId.get(String(x.section)) ?? craft, text: String(x.text) }));
  }

  // Every sentence is checked against its own section's facts, in one batch.
  const { results, usage: guardUsage } = flat.length
    ? await guardSentences(flat.map((f) => ({ text: f.text, register: f.sec.register, evidence: f.sec.facts })), options.guard, options.asOf)
    : { results: [], usage: { inputTokens: 0, outputTokens: 0 } };

  // Kept in spoken order: consecutive sentences from one section form a block.
  const sections: WrittenEpisode['sections'] = [];
  flat.forEach((f, i) => {
    let target = sections[sections.length - 1];
    if (!target || target.id !== f.sec.id) { target = { id: f.sec.id, register: f.sec.register, kept: [], cut: [] }; sections.push(target); }
    if (results[i]!.verdict === 'supported') target.kept.push(f.text);
    else target.cut.push({ sentence: f.text, reason: results[i]!.reason });
  });
  const kept = sections.reduce((n, s) => n + s.kept.length, 0);
  return {
    title: typeof data.title === 'string' ? data.title : 'This week',
    sections,
    stats: { sentences: flat.length, kept, cut: flat.length - kept, sectionsWithEvidence: outline.filter((s) => s.facts.length > 0).length, sections: outline.length,
      words: sections.reduce((n, s) => n + s.kept.join(' ').split(/\s+/).filter(Boolean).length, 0) },
    usage: { writer: writerUsage, guard: guardUsage },
  };
}

/** The spoken script: kept sentences, section by section. Pure. */
export function scriptText(e: WrittenEpisode): string {
  return e.sections.map((s) => s.kept.join(' ')).filter(Boolean).join('\n\n');
}
