/**
 * A portrait with every section present.
 *
 * Portraits written by Cook 0 always had every section. Facts-only reading
 * builds a new person's portrait from facts instead (patchDocument), which
 * leaves out sections it has nothing for -- and every reader assumed they were
 * there. The first episode for a brand-new person crashed reading
 * `active_goals` (found by the end-to-end test, 19 October 2026). Readers go
 * through this instead of trusting the stored shape.
 */

import type { UserUnderstandingDocument } from '../types';

export function completeDocument(doc: Partial<UserUnderstandingDocument> | null | undefined): UserUnderstandingDocument | null {
  if (!doc) return null;
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    ...doc,
    identity_core: text(doc.identity_core),
    active_goals: list(doc.active_goals),
    behavioral_patterns: text(doc.behavioral_patterns),
    emotional_baseline: text(doc.emotional_baseline),
    live_tensions: list(doc.live_tensions),
    track_record: text(doc.track_record),
    forward_focus: text(doc.forward_focus),
    emerging_dimensions: list(doc.emerging_dimensions),
  } as UserUnderstandingDocument;
}
