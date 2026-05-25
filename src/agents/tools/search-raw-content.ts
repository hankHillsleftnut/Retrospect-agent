import { supabase } from '../../db/supabase';
import { generateEmbedding } from '../../services/embeddings';
import type { AgentTool } from './types';

interface Args {
  query: string;
  start_date?: string;
  end_date?: string;
  content_type?: string;
  limit?: number;
  match_threshold?: number;
}

interface Hit {
  id: string;
  content: string;
  content_type: string;
  content_date: string | null;
  created_at: string;
  similarity: number;
}

export const searchRawContentTool: AgentTool<Args, { hits: Hit[]; count: number }> = {
  name: 'search_raw_content',
  description:
    'LAST-RESORT tool: search the user\'s raw content (voice transcripts, screen time reports, docs). Use this ONLY when the observations/insights tools don\'t give you what you need — e.g. you want the user\'s actual words on a topic.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What you\'re looking for in raw content' },
      start_date: { type: 'string' },
      end_date: { type: 'string' },
      content_type: { type: 'string', description: 'Filter by content_type (voice_recording, screen_time, google_docs, etc.)' },
      limit: { type: 'integer', minimum: 1, maximum: 10, default: 4 },
      match_threshold: { type: 'number', minimum: 0, maximum: 1, default: 0.35 },
    },
    required: ['query'],
  },
  async execute(args, ctx) {
    const embedding = await generateEmbedding(args.query);
    const { data, error } = await supabase.rpc('match_raw_content', {
      query_embedding: embedding,
      match_threshold: args.match_threshold ?? 0.35,
      match_count: args.limit ?? 4,
      filter_user_id: ctx.userId,
      start_date: args.start_date ?? null,
      end_date: args.end_date ?? null,
    });
    if (error) throw new Error(`search_raw_content RPC failed: ${error.message}`);
    let hits = (data ?? []) as Hit[];
    if (args.content_type) hits = hits.filter((h) => h.content_type === args.content_type);

    // Trim raw content for token budget
    hits = hits.map((h) => ({
      ...h,
      content: h.content.length > 800 ? `${h.content.slice(0, 800)}…` : h.content,
    }));

    return { hits, count: hits.length };
  },
};
