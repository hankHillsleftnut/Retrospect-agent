/**
 * The goals someone states in onboarding, read straight from their answers.
 *
 * Onboarding used to get its goals by running the whole ingest pipeline and
 * then reading the portrait that Cook 0 rewrote. That took minutes (the "94%"
 * hang) and, since facts-only reading stopped running Cook 0 on new material
 * (#31), would return nothing for a new user. This is one model call over the
 * answers themselves, in seconds. The answers are still read in full by the
 * pipeline afterwards; this only decides what the screen shows.
 *
 * Goal 7 (understanding reported goals): every goal must quote the person's own
 * words, checked against the answers, so nothing is invented.
 */

import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { verifyExcerpt } from '../brain/verify-span';
import { config } from '../config';

export const MAX_STATED_GOALS = 5;

export interface StatedGoal {
  title: string;
  description: string;
  reasoning: string;
  /** Their exact words the goal rests on, verified present in the answers. */
  quote: string;
}

export const STATED_GOALS_SYSTEM = `You read a person's answers to a few onboarding questions and list the goals they have stated or clearly expressed wanting.

Rules:
- Only goals they actually expressed. Never invent one, never add a goal they "should" have.
- At most ${MAX_STATED_GOALS}, most important first. Fewer is fine. None is fine if they expressed none.
- title: a few words, in their framing, not therapy language.
- description: one sentence on what the goal is really about, grounded in what they wrote.
- reasoning: one sentence on why it matters to them, from their own words. Empty if they didn't say.
- quote: the exact words from their answers the goal rests on, copied character for character. 5 to 30 words.
- Write to them as "you". Never assume pronouns. Do not use em dashes.

Reply with JSON only: {"goals": [{"title": "...", "description": "...", "reasoning": "...", "quote": "..."}]}`;

export type StatedGoalsModel = (system: string, user: string) => Promise<{ data: { goals?: unknown }; usage: ClaudeUsage }>;

export interface StatedGoalsResult {
  goals: StatedGoal[];
  /** Goals the model returned but whose quote is not in the answers. */
  dropped: number;
  usage: ClaudeUsage;
  model: string;
}

export async function extractStatedGoals(
  answersText: string,
  model: StatedGoalsModel = (system, user) =>
    claudeJsonCompletion<{ goals?: unknown }>(system, user, { model: config.anthropic.questionsModel, maxTokens: 2000 }),
): Promise<StatedGoalsResult> {
  const text = answersText.trim();
  const empty = { goals: [], dropped: 0, usage: { inputTokens: 0, outputTokens: 0 }, model: config.anthropic.questionsModel };
  if (!text) return empty;

  const { data, usage } = await model(STATED_GOALS_SYSTEM, `ONBOARDING ANSWERS\n${text}`);
  const raw = Array.isArray(data.goals) ? data.goals : [];

  const goals: StatedGoal[] = [];
  let dropped = 0;
  for (const g of raw) {
    const goal = g as Partial<StatedGoal>;
    const title = clean(goal.title);
    const quote = clean(goal.quote);
    if (!title || !verifyExcerpt(quote, text).ok) {
      dropped += 1;
      continue;
    }
    goals.push({ title, description: clean(goal.description), reasoning: clean(goal.reasoning), quote });
    if (goals.length === MAX_STATED_GOALS) break;
  }
  return { goals, dropped, usage, model: config.anthropic.questionsModel };
}

/** Product rule: no em dashes in anything the person reads. */
function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s*—\s*/g, ', ').trim() : '';
}
