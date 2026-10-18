/**
 * Rules for writing the legacy tables -- observations, insights, identity
 * inferences.
 *
 * These are the old extraction's outputs, still written alongside the new fact
 * bank so the episode keeps working while it migrates. They are meant to be
 * disconnectable later, and until then they must never be able to take the new
 * path down with them.
 *
 * Both rules here come from reading the production failures, 18 October 2026.
 */

/**
 * Keep a goal id only if it is one the model was actually shown.
 *
 * The ingestion prompt's example output contains the literal string
 * "uuid-or-null" as a placeholder for goal_id, and the model sometimes hands
 * that string back as if it were an answer. Production holds failed runs with
 * `invalid input syntax for type uuid: "uuid-or-null"` and `"null"`. Separately,
 * 23 runs failed with a foreign-key violation: the model citing a goal id that
 * does not exist -- invented, or remembered from a goal since deleted.
 *
 * Both are the same mistake: trusting an id the model produced. The model was
 * given a specific list of active goals, so any id outside that list is wrong by
 * construction, whatever it looks like.
 *
 * Returns null when the id should not be written.
 */
export function sanitizeGoalId(raw: unknown, knownGoalIds: ReadonlySet<string>): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return knownGoalIds.has(id) ? id : null;
}

/**
 * Whether a legacy row can be stored given its goal id.
 *
 * The two tables differ, and that difference is the whole reason this exists:
 *
 * - `observations.goal_id` is nullable -- migration 100 dropped the constraint,
 *   and production holds 166 observations with no goal. An observation with an
 *   invalid goal is still worth keeping, unlinked.
 * - `insights.goal_id` is NOT NULL and has never been relaxed. An insight with
 *   no valid goal cannot be stored at all, so it is dropped rather than written
 *   to fail the insert -- and with it, until now, the entire ingest run.
 */
export function legacyGoalIdOrDrop(
  table: 'observations' | 'insights',
  raw: unknown,
  knownGoalIds: ReadonlySet<string>,
): { keep: true; goalId: string | null } | { keep: false } {
  const goalId = sanitizeGoalId(raw, knownGoalIds);
  if (goalId === null && table === 'insights') return { keep: false };
  return { keep: true, goalId };
}
