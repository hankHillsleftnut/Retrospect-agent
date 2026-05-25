import { supabase } from '../../db/supabase';
import { generateEmbedding } from '../../services/embeddings';
import type { AgentTool } from './types';

interface Args {
  query: string;
  limit?: number;
  match_threshold?: number;
}

interface Hit {
  id: string;
  title: string;
  description: string;
  summary: string;
  created_at: string;
  similarity: number;
}

export const searchPreviousPodcastsTool: AgentTool<Args, { hits: Hit[]; count: number }> = {
  name: 'search_previous_podcasts',
  description:
    'Embedding-search the summaries of past podcast episodes. Use this BEFORE you commit to a theme to make sure the upcoming episode isn\'t repeating something you said recently, or to deliberately call back to a previous episode.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What past topics/themes you want to surface' },
      limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      match_threshold: { type: 'number', minimum: 0, maximum: 1, default: 0.3 },
    },
    required: ['query'],
  },
  async execute(args, ctx) {
    const embedding = await generateEmbedding(args.query);
    const { data, error } = await supabase.rpc('match_podcast_summaries', {
      query_embedding: embedding,
      match_threshold: args.match_threshold ?? 0.3,
      match_count: args.limit ?? 5,
      filter_user_id: ctx.userId,
    });
    if (error) throw new Error(`search_previous_podcasts RPC failed: ${error.message}`);
    const hits = (data ?? []) as Hit[];
    return { hits, count: hits.length };
  },
};
