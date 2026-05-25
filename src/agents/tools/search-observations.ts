import { supabase } from '../../db/supabase';
import { generateEmbedding } from '../../services/embeddings';
import type { AgentTool } from './types';

interface Args {
  query: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  match_threshold?: number;
  goal_id?: string;
}

interface Hit {
  id: string;
  content: string;
  reason_why: string;
  goal_id: string | null;
  observation_date: string;
  similarity: number;
}

export const searchObservationsTool: AgentTool<Args, { hits: Hit[]; count: number }> = {
  name: 'search_observations',
  description:
    'Embedding-search the user\'s observations (atomic facts from raw content). Use this when you want to ground claims in specific evidence. Returns hits sorted by relevance.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language description of what to look for' },
      start_date: { type: 'string', description: 'ISO date — only observations on or after this date' },
      end_date: { type: 'string', description: 'ISO date — only observations on or before this date' },
      limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
      match_threshold: { type: 'number', minimum: 0, maximum: 1, default: 0.3 },
      goal_id: { type: 'string', description: 'Restrict to a specific goal' },
    },
    required: ['query'],
  },
  async execute(args, ctx) {
    const embedding = await generateEmbedding(args.query);
    const { data, error } = await supabase.rpc('match_observations', {
      query_embedding: embedding,
      match_threshold: args.match_threshold ?? 0.3,
      match_count: args.limit ?? 10,
      filter_user_id: ctx.userId,
      filter_goal_id: args.goal_id ?? null,
    });
    if (error) throw new Error(`search_observations RPC failed: ${error.message}`);
    let hits = (data ?? []) as Hit[];
    if (args.start_date) hits = hits.filter((h) => h.observation_date >= args.start_date!);
    if (args.end_date) hits = hits.filter((h) => h.observation_date <= args.end_date!);
    return { hits, count: hits.length };
  },
};
