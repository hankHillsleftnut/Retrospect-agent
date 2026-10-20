/**
 * Search one person's life (S1.1): their items, the facts about them, their
 * answers and their saved links, by keyword and by meaning, fused (migration
 * 144). The query is embedded with the same model the items were; if that
 * fails, keyword search still runs.
 */

import { supabase } from '../db/supabase';
import { generateEmbedding } from '../services/embeddings';

export interface SearchHit { kind: 'item' | 'fact' | 'answer' | 'saved'; id: string; snippet: string; happened_at: string | null; score: number }

export async function searchPerson(userId: string, query: string, options: { db?: typeof supabase; limit?: number; embed?: (q: string) => Promise<number[] | null> } = {}): Promise<SearchHit[]> {
  const db = options.db ?? supabase;
  const embed = options.embed ?? (async (q: string) => { try { return await generateEmbedding(q); } catch { return null; } });
  const vector = await embed(query);
  const { data, error } = await db.rpc('search_person', { p_user: userId, p_query: query, p_embedding: vector ? JSON.stringify(vector) : null, p_limit: options.limit ?? 20 });
  if (error) throw new Error(`searchPerson: ${error.message}`);
  return ((data ?? []) as SearchHit[]).map((h) => ({ ...h, score: Number(h.score) }));
}
