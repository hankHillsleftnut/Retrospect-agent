import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { trustForRow, type TrustClass } from './trust';

/** Ids per update; keeps the request URL well under the API's limit. */
export const STAMP_CHUNK = 100;

/**
 * Record each row's trust class (migration 129). One update per class. Never
 * fails a run: before the column exists, or on a write error, it warns and
 * moves on -- the class is recomputed from the row wherever it's needed.
 */
export async function stampTrustClasses(
  rows: Array<{ id: string; content_type: string; authorship?: string | null; content?: string | null; metadata?: unknown }>,
  db: typeof supabase = supabase,
): Promise<Record<TrustClass, number>> {
  const byClass = new Map<TrustClass, string[]>();
  for (const r of rows) {
    const c = trustForRow(r);
    byClass.set(c, [...(byClass.get(c) ?? []), r.id]);
  }
  const counts = {} as Record<TrustClass, number>;
  for (const [trustClass, ids] of byClass) {
    // In chunks: hundreds of ids in one filter overflow the request URL and the
    // API answers "Bad Request" (found backfilling 1,000 rows, 19 Oct 2026).
    for (let i = 0; i < ids.length; i += STAMP_CHUNK) {
      const chunk = ids.slice(i, i + STAMP_CHUNK);
      const { error } = await db.from(Tables.RAW_CONTENT).update({ trust_class: trustClass }).in('id', chunk);
      if (error) {
        console.warn(`[trust] could not record trust classes (${error.message}); continuing`);
        return counts;
      }
      counts[trustClass] = (counts[trustClass] ?? 0) + chunk.length;
    }
  }
  return counts;
}
