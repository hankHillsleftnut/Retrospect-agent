import { supabase } from '../db/supabase';
import { generateEmbeddings } from '../services/embeddings';

/** What a saved link is searched by: what it is, and why they kept it. Pure. */
export function savedText(r: { title: string | null; summary: string | null; intent: string | null; url: string }): string {
  return [r.title, r.summary, r.intent && `Saved because: ${r.intent}`, r.url].filter(Boolean).join('\n').slice(0, 8000);
}

/**
 * Give saved links a meaning vector so they're found by why they were kept,
 * not only by shared words (gate R1.5). Enriched or failed alike: a failed
 * fetch still has the person's reason. A failure only means fewer vectors now.
 */
export async function embedSaved(userId: string, options: { db?: typeof supabase; embed?: (texts: string[]) => Promise<Array<number[] | null>>; limit?: number } = {}): Promise<number> {
  const db = options.db ?? supabase;
  const embed = options.embed ?? generateEmbeddings;
  const { data, error } = await db.from('reference_items').select('id,title,summary,intent,url').eq('user_id', userId)
    .is('embedding', null).in('status', ['enriched', 'failed']).order('created_at', { ascending: false }).limit(options.limit ?? 100);
  if (error) throw new Error(`embedSaved: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; title: string | null; summary: string | null; intent: string | null; url: string }>;
  let done = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const part = rows.slice(i, i + 50);
    try {
      const vectors = await embed(part.map(savedText));
      for (let k = 0; k < part.length; k++) {
        if (!vectors[k]) continue;
        const { error: e } = await db.from('reference_items').update({ embedding: vectors[k] }).eq('id', part[k]!.id);
        if (!e) done++;
      }
    } catch (err) {
      console.warn(`[embed-saved] ${(err as Error).message}`);
    }
  }
  return done;
}
