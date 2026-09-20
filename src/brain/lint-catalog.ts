/**
 * The lint catalog.
 *
 * Every check carries THE SENTENCE a user would hear if it went undetected.
 * That sentence is not documentation -- it is the admission test. Three
 * candidate checks were dropped during design because no sentence followed
 * from them (null embeddings, orphaned entities, stale candidates); they are
 * ops metrics, not lint.
 *
 * Severity is how bad that sentence is:
 *   safety -- the system could say something harmful; separate alert path
 *   bug    -- an invariant is violated; this should have been impossible
 *   rot    -- becoming true over time; a claim decaying toward false
 *   info   -- worth a glance; no wrong sentence results
 *
 * docs/second-brain/13.
 */

export type Severity = 'safety' | 'bug' | 'rot' | 'info';

export interface CheckDefinition {
  id: string;
  layer: 'sources' | 'facts' | 'entities' | 'patterns' | 'whys' | 'portrait';
  severity: Severity;
  /** What a user would hear if this went undetected. Required. */
  prevents: string;
  /** The capability that resolves it. Named as an outcome, not an implementation. */
  remediation: string;
  /** True when the fix does not exist yet (A12 scope). */
  remediationIsNew: boolean;
}

export const CHECKS: CheckDefinition[] = [
  // ── Sources ───────────────────────────────────────────────────────────────
  {
    id: 'S1', layer: 'sources', severity: 'bug',
    prevents: '"You haven\'t mentioned work much lately." -- they journaled about it three times and extraction silently produced nothing.',
    remediation: 'Re-process the source row, overriding the completed-skip.',
    remediationIsNew: true,
  },
  {
    id: 'S2', layer: 'sources', severity: 'bug',
    prevents: '"Sounds like a quiet week." -- the entry describing the week never finished processing.',
    remediation: 'Lease expiry should have released it; if it did not, that is the defect. Escalate.',
    remediationIsNew: false,
  },
  {
    id: 'S3', layer: 'sources', severity: 'bug',
    prevents: '"Quiet week." -- they wrote every day and none of it was ingested.',
    remediation: 'Trigger ingest for the named rows.',
    remediationIsNew: false,
  },

  // ── Facts ─────────────────────────────────────────────────────────────────
  {
    id: 'F1', layer: 'facts', severity: 'bug',
    prevents: '"You told yourself you were too tired." -- they never wrote that.',
    remediation: 'Machine-retire the assertion with a reason, and investigate: sources are supposed to be immutable.',
    remediationIsNew: true,
  },
  {
    id: 'F2', layer: 'facts', severity: 'bug',
    prevents: '"You skipped standup three Thursdays." -- with no way to show which.',
    remediation: 'Machine-retire the evidence-less assertion.',
    remediationIsNew: true,
  },
  {
    id: 'F3', layer: 'facts', severity: 'bug',
    prevents: '"Your goal is the half marathon." -- in an episode that elsewhere says they quit.',
    remediation: 'Re-run supersession over the contradicting pair.',
    remediationIsNew: true,
  },
  {
    id: 'F4', layer: 'facts', severity: 'bug',
    prevents: '"You\'re still training for the half." -- retired in the data, live in the query.',
    remediation: 'Repair status/validity consistency.',
    remediationIsNew: true,
  },
  {
    id: 'F5', layer: 'facts', severity: 'bug',
    prevents: '"Three months ago you were training." -- with nothing linking it to what replaced it, so changed_since cannot return the pair.',
    remediation: 'Repair the supersession relation chain.',
    remediationIsNew: true,
  },
  {
    id: 'F6', layer: 'facts', severity: 'bug',
    prevents: '"You\'ve mentioned this six times." -- it was three, counted twice. Duplicate facts inflate instance_count and can push a behaviour over the promotion bar it never earned.',
    remediation: 'Merge the assertions, moving all evidence to the survivor.',
    remediationIsNew: true,
  },

  // ── Entities ──────────────────────────────────────────────────────────────
  {
    id: 'E1', layer: 'entities', severity: 'rot',
    prevents: '"Alex came up twice this week." -- it was six times across two unmerged identities, and neither crossed the significance threshold.',
    remediation: 'Create a resolution candidate for a human to decide.',
    remediationIsNew: true,
  },
  {
    id: 'E2', layer: 'entities', severity: 'rot',
    prevents: 'Same as E1, arriving through a queue nobody drains.',
    remediation: 'Escalate: surface pending candidates to a human.',
    remediationIsNew: true,
  },
  {
    id: 'E3', layer: 'entities', severity: 'rot',
    prevents: '"Alex has been a big part of your life." -- about someone they stopped seeing in March.',
    remediation: 'Recompute significance for the entity.',
    remediationIsNew: true,
  },

  // ── Patterns ──────────────────────────────────────────────────────────────
  {
    id: 'P1', layer: 'patterns', severity: 'rot',
    prevents: '"You\'re still disappearing on Thursdays." -- they stopped six weeks ago.',
    remediation: 'Confidence decay should have demoted it; verify decay is running.',
    remediationIsNew: false,
  },
  {
    id: 'P2', layer: 'patterns', severity: 'rot',
    prevents: '"This keeps happening to you." -- built entirely on facts the system no longer believes.',
    remediation: 'Retire the pattern.',
    remediationIsNew: false,
  },
  {
    id: 'P3', layer: 'patterns', severity: 'bug',
    prevents: '"You\'ve done this three times." -- it was two.',
    remediation: 'Re-run the promoter at a stated version.',
    remediationIsNew: true,
  },
  {
    id: 'P4', layer: 'patterns', severity: 'rot',
    prevents: '"There are two things you keep doing." -- it is one thing described twice, which makes the person sound more troubled than they are.',
    remediation: 'ESCALATE TO A HUMAN. Never auto-merge patterns.',
    remediationIsNew: true,
  },
  {
    id: 'P5', layer: 'patterns', severity: 'safety',
    prevents: '"Let\'s talk about your breakup." -- the thing the product promised never to do unasked.',
    remediation: 'Correct episode_promotable and alert immediately.',
    remediationIsNew: true,
  },

  // ── Whys ──────────────────────────────────────────────────────────────────
  {
    id: 'W1', layer: 'whys', severity: 'bug',
    prevents: '"You avoid things when they get hard." -- derived from a pattern that never cleared the bar. This is "it called me avoidant after one bad day" arriving through the back door.',
    remediation: 'Retire the why.',
    remediationIsNew: false,
  },
  {
    id: 'W2', layer: 'whys', severity: 'rot',
    prevents: '"You do this because you\'re ambivalent about the job." -- the facts behind that were retired in March.',
    remediation: 'Retire the why.',
    remediationIsNew: false,
  },
  {
    id: 'W3', layer: 'whys', severity: 'bug',
    prevents: '"The reason you do this is..." -- stated as fact, when the object is explicitly labelled inferred.',
    remediation: 'Clamp the confidence, or retire the why.',
    remediationIsNew: false,
  },
  {
    id: 'W4', layer: 'whys', severity: 'safety',
    prevents: '"The reason you\'re struggling is..." -- psychoanalysing a crisis.',
    remediation: 'Retire the why and alert immediately.',
    remediationIsNew: true,
  },

  // ── Portrait ──────────────────────────────────────────────────────────────
  {
    id: 'Po1', layer: 'portrait', severity: 'rot',
    prevents: '"Your goal is the half marathon." -- January\'s answer, in September.',
    remediation: 'Rebuild the portrait block.',
    remediationIsNew: false,
  },
  {
    id: 'Po2', layer: 'portrait', severity: 'rot',
    prevents: '"One of your live tensions is..." -- about a pattern that retired.',
    remediation: 'Rebuild the portrait block.',
    remediationIsNew: false,
  },
  {
    id: 'Po3', layer: 'portrait', severity: 'bug',
    prevents: '"You\'re someone who treats consistency as self-respect." -- from where? Untraceable, and the design says empty beats unsupported.',
    remediation: 'Rebuild or empty the block.',
    remediationIsNew: false,
  },
  {
    id: 'Po4', layer: 'portrait', severity: 'info',
    prevents: '"Here\'s where you are right now." -- from a month-old snapshot.',
    remediation: 'Rebuild the portrait.',
    remediationIsNew: false,
  },
  {
    id: 'Po5', layer: 'portrait', severity: 'bug',
    prevents: 'The episode silently falls back to a 14-day dump and sounds generic.',
    remediation: 'Build the portrait for this user.',
    remediationIsNew: false,
  },
];

export const CHECKS_BY_ID: Record<string, CheckDefinition> = Object.fromEntries(
  CHECKS.map((c) => [c.id, c])
);

/** Safety findings leave the list entirely. A safety item queued behind stale
 *  significance scores IS the failure that class exists to prevent. */
export function isSafety(checkId: string): boolean {
  return CHECKS_BY_ID[checkId]?.severity === 'safety';
}

/** Stable identity for a finding, so nightly runs update rather than pile up. */
export function fingerprint(checkId: string, subjectIds: string[]): string {
  return `${checkId}:${[...subjectIds].sort().join(',')}`;
}
