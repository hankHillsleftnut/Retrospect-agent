/**
 * The portrait -- a small, current, always-readable model of the person.
 *
 * Built from named blocks, each rebuilt from LIVE facts and patterns and each
 * carrying the IDs it came from. Cook 0 today rewrites one prose blob from a
 * 14-day dump, which is why it drifts and keeps January's answers in
 * September.
 *
 * The rule that makes it trustworthy: a block that cannot be traced to live
 * IDs is EMPTY. Empty beats January's marathon (04 §6).
 */

import { currentTruth, livePatterns, type FactRow, type PatternRow } from './pulls';

export type PortraitSlot =
  | 'current_goals'
  | 'current_state'
  | 'live_tensions'
  | 'significant_people'
  | 'open_threads'
  | 'self_talk_now'
  | 'what_changed';

export interface PortraitBlock {
  slot: PortraitSlot;
  /** Short. The portrait is a lens, not the history. */
  lines: string[];
  sourceAssertionIds: string[];
  sourcePatternIds: string[];
  /** False when nothing live supports this slot. Renders as empty, not stale. */
  populated: boolean;
}

export const PORTRAIT_SLOTS: PortraitSlot[] = [
  'current_goals',
  'current_state',
  'live_tensions',
  'significant_people',
  'open_threads',
  'self_talk_now',
  'what_changed',
];

/** Max lines per block. A portrait that grows stops being a lens. */
export const MAX_LINES_PER_BLOCK = 6;

function objectText(fact: FactRow): string {
  const v = fact.object_value as Record<string, unknown> | null;
  return String(v?.text ?? v?.normalized ?? '').trim();
}

export function emptyBlock(slot: PortraitSlot): PortraitBlock {
  return { slot, lines: [], sourceAssertionIds: [], sourcePatternIds: [], populated: false };
}

/**
 * Build one block. Pure over the rows it is handed, so the traceability rule
 * can be tested without a database.
 */
export function buildBlock(
  slot: PortraitSlot,
  input: { facts?: FactRow[]; patterns?: PatternRow[] }
): PortraitBlock {
  const facts = input.facts ?? [];
  const patterns = input.patterns ?? [];

  const fromFacts = (rows: FactRow[], render: (f: FactRow) => string): PortraitBlock => {
    const usable = rows.filter((f) => objectText(f));
    if (usable.length === 0) return emptyBlock(slot);
    const take = usable.slice(0, MAX_LINES_PER_BLOCK);
    return {
      slot,
      lines: take.map(render),
      sourceAssertionIds: take.map((f) => f.id),
      sourcePatternIds: [],
      populated: true,
    };
  };

  switch (slot) {
    case 'current_goals':
      return fromFacts(facts, (f) => objectText(f));

    case 'self_talk_now':
      return fromFacts(facts, (f) => `"${objectText(f)}"`);

    case 'open_threads':
      return fromFacts(facts, (f) => `${f.predicate.replace(/_/g, ' ')}: ${objectText(f)}`);

    case 'current_state':
      return fromFacts(facts, (f) => objectText(f));

    case 'live_tensions': {
      if (patterns.length === 0) return emptyBlock(slot);
      const take = patterns.slice(0, MAX_LINES_PER_BLOCK);
      return {
        slot,
        // Boring labels on purpose: a metaphor here breaks typed retrieval
        // and invites the writer to improvise (05 D5).
        lines: take.map((p) => p.label),
        sourceAssertionIds: [],
        sourcePatternIds: take.map((p) => p.id),
        populated: true,
      };
    }

    case 'significant_people':
    case 'what_changed':
    default:
      return emptyBlock(slot);
  }
}

export interface PortraitDocument {
  blocks: Record<PortraitSlot, PortraitBlock>;
  builtAt: string;
  /** Slots deliberately left empty because nothing live supported them. */
  emptySlots: PortraitSlot[];
}

/** Assemble the whole portrait from the live bank. */
export async function buildPortrait(userId: string): Promise<PortraitDocument> {
  const [goals, selfTalkFacts, patterns, stateFacts] = await Promise.all([
    currentTruth({ userId, predicate: 'stated_goal', limit: 20 }),
    currentTruth({ userId, predicate: 'said_about_self', limit: 20 }),
    livePatterns({ userId, limit: 20 }),
    currentTruth({ userId, predicate: 'felt', limit: 20 }),
  ]);

  const blocks = {
    current_goals: buildBlock('current_goals', { facts: goals }),
    current_state: buildBlock('current_state', { facts: stateFacts }),
    live_tensions: buildBlock('live_tensions', { patterns }),
    significant_people: emptyBlock('significant_people'),
    open_threads: emptyBlock('open_threads'),
    self_talk_now: buildBlock('self_talk_now', { facts: selfTalkFacts }),
    what_changed: emptyBlock('what_changed'),
  } as Record<PortraitSlot, PortraitBlock>;

  return {
    blocks,
    builtAt: new Date().toISOString(),
    emptySlots: PORTRAIT_SLOTS.filter((s) => !blocks[s].populated),
  };
}

/**
 * Patch the User Understanding Document's slots from live blocks.
 *
 * HARD CONSTRAINT: `document.active_goals` keeps its existing shape. The API's
 * onboarding flow reads it directly (backend goals.ts), and if the shape
 * changes onboarding does not error -- it silently falls through to the
 * goal_candidates graveyard and new users quietly get worse goals.
 */
export function patchDocument(
  existing: Record<string, unknown> | null,
  portrait: PortraitDocument
): Record<string, unknown> {
  const doc = { ...(existing ?? {}) };

  const goalsBlock = portrait.blocks.current_goals;
  if (goalsBlock.populated) {
    const prior = Array.isArray(doc.active_goals) ? (doc.active_goals as any[]) : [];
    doc.active_goals = goalsBlock.lines.map((title, i) => {
      const assertionId = goalsBlock.sourceAssertionIds[i] ?? null;
      // Match on the underlying fact first. Titles are rendered text and drift
      // between runs ("half marathon" -> "the half marathon"); matching on them
      // alone drops goal_id, which the API's onboarding flow reads to link a
      // goal back to its row in the goals table.
      const match =
        (assertionId
          ? prior.find((g) => g?.source_assertion_id === assertionId)
          : undefined) ??
        prior.find(
          (g) => typeof g?.title === 'string' && g.title.toLowerCase() === title.toLowerCase()
        );
      return {
        // Shape preserved exactly: goal_id, title, what_its_really_about.
        goal_id: match?.goal_id ?? null,
        title,
        what_its_really_about: match?.what_its_really_about ?? '',
        source_assertion_id: assertionId,
      };
    });
  }
  // If nothing live supports goals we leave the prior value ALONE rather than
  // blanking it: an empty bank early on must not wipe a working onboarding.

  if (portrait.blocks.live_tensions.populated) {
    doc.live_tensions = portrait.blocks.live_tensions.lines;
  }

  doc.portrait_blocks = portrait.blocks;
  doc.portrait_built_at = portrait.builtAt;
  return doc;
}
