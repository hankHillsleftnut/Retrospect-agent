/**
 * One door into what the brain knows about a person (W4.1).
 *
 * Every later reader (the episode planner, the daily brief, search, the app)
 * reads this, never the tables underneath (P4: contracts between layers).
 * Each item says what it is, how sure the brain is, how much evidence stands
 * behind it, and the REGISTER it may be spoken in. The register is decided
 * here, from counted confidence, never by the writer (design change C4,
 * research: models' stated confidence is miscalibrated):
 *
 *   stated  the evidence clears the domain's bar, or the person confirmed it;
 *           or it's a count (a pattern's instances, a shift, hours booked).
 *   asked   in a domain the brain may speak about, but below the bar; and
 *           every why, always (goal 12: a why is a question before a verdict).
 *
 * Domains that haven't earned the right to speak contribute nothing but their
 * name in `silent`. Rejected answers never appear.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { baselineShifts, type Shift } from '../brain/baseline-shifts';
import { weekTime, type WeekTime } from '../brain/time-categories';
import type { DailySummary } from '../brain/daily-summaries';
import type { TrajectoryResult } from '../brain/trajectory';
import { readAnswerMoves, type AnswerMove } from './answer-moves';

export type Register = 'stated' | 'asked';

export interface AnswerItem { kind: 'answer'; id: string; questionId: number; question: string; domainId: string; answer: string; confidence: number; sources: number; confirmed: boolean; register: Register; lastMovedAt: string | null }
export interface PatternItem { kind: 'pattern'; id: string; label: string; /** Counted and decayed by the promoter. */ confidence: number; instances: number; firstSeenAt: string | null; lastSeenAt: string | null; trajectory: TrajectoryResult['trajectory'] | null; trajectoryDetail: Partial<TrajectoryResult> | null; register: 'stated' }
export interface WhyItem { kind: 'why'; id: string; patternId: string; mechanism: string; confidence: number; register: 'asked'; /** Not past its gate: the founder allowed at most one per episode, asked (19 Oct). */ provisional: boolean }
export interface GoalItem { kind: 'goal'; id: string; title: string; description: string | null; statedAt: string | null; register: 'stated' }

export interface UnderstandingContract {
  userId: string;
  asOf: string;
  answers: AnswerItem[];
  silent: Array<{ domainId: string; label: string }>;
  patterns: PatternItem[];
  whys: WhyItem[];
  goals: GoalItem[];
  shifts: Shift[];
  time: { categories: WeekTime[]; otherShare: number; weeksOfBaseline: number };
  /** What moved in the answers since the last episode (W4.2). */
  moves: { since: string | null; items: AnswerMove[] };
}

export interface ContractRows {
  coverage: Array<{ domain_id: string; label: string; may_speak: boolean }>;
  domains: Array<{ id: string; confidence_floor: number | string }>;
  questions: Array<{ id: number; domain_id: string; text: string }>;
  answers: Array<{ id: string; question_id: number; answer: string; user_verdict: string | null; last_moved_at: string | null }>;
  scores: Array<{ answer_id: string; confidence: number | string; independent_sources: number | string }>;
  patterns: Array<{ id: string; label: string; status: string; episode_promotable: boolean; confidence?: number | string | null; instance_count: number; first_seen_at: string | null; last_seen_at: string | null; trajectory: string | null; trajectory_detail: Partial<TrajectoryResult> | null }>;
  whys: Array<{ id: string; pattern_id: string; mechanism: string; confidence: number | string; status: string }>;
  goals: Array<{ id: string; title: string; description: string | null; created_at: string | null; is_active: boolean | null }>;
  summaries: DailySummary[];
  /** Open lint findings (goal 5): what they name can't be spoken until resolved. */
  flags?: Array<{ subject_kind: string; subject_ids: string[]; check_id: string }>;
}

/** Pure: the contract from its rows. */
export function assembleContract(userId: string, rows: ContractRows, today: string, moves: UnderstandingContract['moves'] = { since: null, items: [] }): UnderstandingContract {
  const floor = new Map(rows.domains.map((d) => [d.id, Number(d.confidence_floor)]));
  const speaks = new Map(rows.coverage.map((c) => [c.domain_id, c.may_speak]));
  const question = new Map(rows.questions.map((q) => [q.id, q]));
  const score = new Map(rows.scores.map((s) => [s.answer_id, s]));
  // Anything lint has flagged (and not yet resolved) stays out of every output (goal 5).
  const flagged = new Set((rows.flags ?? []).flatMap((f) => f.subject_ids.map((id) => `${f.subject_kind}:${id}`)));

  // The standing answer per question: confirmed first, then most confident.
  const best = new Map<number, AnswerItem>();
  for (const a of rows.answers) {
    if (a.user_verdict === 'rejected' || flagged.has(`question_answer:${a.id}`)) continue;
    const q = question.get(a.question_id);
    if (!q || !speaks.get(q.domain_id)) continue;
    const s = score.get(a.id);
    const confidence = Number(s?.confidence ?? 0), confirmed = a.user_verdict === 'confirmed';
    const item: AnswerItem = {
      kind: 'answer', id: a.id, questionId: q.id, question: q.text, domainId: q.domain_id, answer: a.answer,
      confidence: Math.round(confidence * 100) / 100, sources: Number(s?.independent_sources ?? 0), confirmed,
      register: confirmed || confidence >= (floor.get(q.domain_id) ?? 1) ? 'stated' : 'asked', lastMovedAt: a.last_moved_at,
    };
    const prev = best.get(q.id);
    if (!prev || Number(confirmed) > Number(prev.confirmed) || (confirmed === prev.confirmed && confidence > prev.confidence)) best.set(q.id, item);
  }

  return {
    userId, asOf: today,
    answers: [...best.values()].sort((a, b) => a.questionId - b.questionId),
    silent: rows.coverage.filter((c) => !c.may_speak).map((c) => ({ domainId: c.domain_id, label: c.label })),
    patterns: rows.patterns.filter((p) => p.status === 'live' && p.episode_promotable && !flagged.has(`behavior_pattern:${p.id}`)).map((p) => ({
      kind: 'pattern' as const, id: p.id, label: p.label, confidence: Number(p.confidence ?? 0.5), instances: p.instance_count, firstSeenAt: p.first_seen_at, lastSeenAt: p.last_seen_at,
      trajectory: (p.trajectory as PatternItem['trajectory']) ?? null, trajectoryDetail: p.trajectory_detail, register: 'stated' as const,
    })),
    // Live whys, and provisional ones behind a live pattern: the founder allowed
    // one provisional why per episode, always asked (19 Oct). The planner caps it.
    whys: rows.whys.filter((w) => !flagged.has(`behavior_pattern_why:${w.id}`) && !flagged.has(`behavior_pattern:${w.pattern_id}`)).filter((w) => w.status === 'live' || (w.status === 'provisional' && rows.patterns.some((p) => p.id === w.pattern_id && p.status === 'live')))
      .map((w) => ({
        kind: 'why' as const, id: w.id, patternId: w.pattern_id, mechanism: w.mechanism, confidence: Number(w.confidence), register: 'asked' as const,
        provisional: w.status === 'provisional',
      })),
    goals: rows.goals.filter((g) => g.is_active !== false).map((g) => ({
      kind: 'goal' as const, id: g.id, title: g.title, description: g.description, statedAt: g.created_at, register: 'stated' as const,
    })),
    shifts: baselineShifts(rows.summaries, today),
    time: weekTime(rows.summaries, today),
    moves,
  };
}

export async function readUnderstanding(userId: string, db: typeof supabase = supabase, now = new Date()): Promise<UnderstandingContract> {
  const today = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 40 * 864e5).toISOString().slice(0, 10);
  const q = async <T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> => {
    const { data, error } = await p;
    if (error) throw new Error(`readUnderstanding ${what}: ${error.message}`);
    return (data ?? []) as T;
  };
  const [coverage, domains, questions, answers, scores, patterns, whys, goals, summaries, flags] = await Promise.all([
    q<ContractRows['coverage']>(db.from(Tables.DOMAIN_COVERAGE).select('domain_id,label,may_speak').eq('user_id', userId), 'coverage'),
    q<ContractRows['domains']>(db.from(Tables.QUESTION_DOMAINS).select('id,confidence_floor'), 'domains'),
    q<ContractRows['questions']>(db.from(Tables.CANONICAL_QUESTIONS).select('id,domain_id,text'), 'questions'),
    q<ContractRows['answers']>(db.from(Tables.QUESTION_ANSWERS).select('id,question_id,answer,user_verdict,last_moved_at').eq('user_id', userId).eq('status', 'active'), 'answers'),
    q<ContractRows['scores']>(db.from(Tables.ANSWER_CONFIDENCE).select('answer_id,confidence,independent_sources').eq('user_id', userId), 'confidence'),
    q<ContractRows['patterns']>(db.from(Tables.BEHAVIOR_PATTERNS).select('id,label,status,episode_promotable,confidence,instance_count,first_seen_at,last_seen_at,trajectory,trajectory_detail').eq('user_id', userId), 'patterns'),
    q<ContractRows['whys']>(db.from(Tables.BEHAVIOR_PATTERN_WHYS).select('id,pattern_id,mechanism,confidence,status').eq('user_id', userId), 'whys'),
    q<ContractRows['goals']>(db.from(Tables.GOALS).select('id,title,description,created_at,is_active').eq('user_id', userId), 'goals'),
    q<DailySummary[]>(db.from(Tables.DAILY_SUMMARIES).select('day,domain,metrics,items,source_ids').eq('user_id', userId).gte('day', since), 'summaries'),
    q<NonNullable<ContractRows['flags']>>(db.from(Tables.LINT_FINDINGS).select('subject_kind,subject_ids,check_id').eq('user_id', userId).eq('resolution', 'open').neq('severity', 'info'), 'lint'),
  ]);
  const m = await readAnswerMoves(userId, db, now);
  return assembleContract(userId, { coverage, domains, questions, answers, scores, patterns, whys, goals, summaries, flags }, today, { since: m.since, items: m.moves });
}
