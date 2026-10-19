import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { trustForRow, type TrustClass } from './trust';

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
    const { error } = await db.from(Tables.RAW_CONTENT).update({ trust_class: trustClass }).in('id', ids);
    if (error) {
      console.warn(`[trust] could not record trust classes (${error.message}); continuing`);
      return counts;
    }
    counts[trustClass] = ids.length;
  }
  return counts;
}
