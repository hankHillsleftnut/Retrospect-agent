import { supabase } from '../../db/supabase';
import { Tables } from '../../db/tables';
import { generateEmbedding } from '../../services/embeddings';
import type { AgentTool } from './types';

interface Args {
  query: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  match_threshold?: number;
  goal_id?: string;
  include_observations?: boolean;
}

interface Hit {
  id: string;
  title: string;
  content: string;
  evidence_summary: string;
  goal_id: string;
  confidence_score: number;
  created_at: string;
  similarity: number;
  supporting_observations?: { id: string; content: string; reason_why: string }[];
}

export const searchInsightsTool: AgentTool<Args, { hits: Hit[]; count: number }> = {
  name: 'search_insights',
  description:
    'Embedding-search the user\'s insights (synthesized conclusions from clusters of observations). Each hit can optionally include its supporting observations. Use this when you want to surface higher-level patterns from the past.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What pattern are you looking for' },
      start_date: { type: 'string', description: 'ISO date — only insights created on or after this date' },
      end_date: { type: 'string', description: 'ISO date — only insights created on or before this date' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
      match_threshold: { type: 'number', minimum: 0, maximum: 1, default: 0.3 },
      goal_id: { type: 'string', description: 'Restrict to a specific goal' },
      include_observations: {
        type: 'boolean',
        default: true,
        description: 'Also return the observations that support each insight',
      },
    },
    required: ['query'],
  },
  async execute(args, ctx) {
    const embedding = await generateEmbedding(args.query);
    const { data, error } = await supabase.rpc('match_user_insights', {
      query_embedding: embedding,
      match_threshold: args.match_threshold ?? 0.3,
      match_count: args.limit ?? 8,
      filter_user_id: ctx.userId,
      filter_goal_id: args.goal_id ?? null,
    });
    if (error) throw new Error(`search_insights RPC failed: ${error.message}`);
    let hits = (data ?? []) as Hit[];
    if (args.start_date) hits = hits.filter((h) => h.created_at >= args.start_date!);
    if (args.end_date) hits = hits.filter((h) => h.created_at <= args.end_date!);

    if (args.include_observations !== false && hits.length > 0) {
      // Fetch supporting_observation_ids for each hit, then their content
      const { data: insightRows } = await supabase
        .from(Tables.INSIGHTS)
        .select('id, supporting_observation_ids')
        .in('id', hits.map((h) => h.id));

      const allObsIds = Array.from(
        new Set(
          (insightRows ?? []).flatMap((r: any) => (r.supporting_observation_ids as string[]) ?? [])
        )
      );
      if (allObsIds.length > 0) {
        const { data: obsRows } = await supabase
          .from(Tables.OBSERVATIONS)
          .select('id, content, reason_why')
          .in('id', allObsIds);
        const obsMap = new Map<string, { id: string; content: string; reason_why: string }>();
        for (const o of obsRows ?? []) obsMap.set(o.id, o as any);

        for (const hit of hits) {
          const row = (insightRows ?? []).find((r: any) => r.id === hit.id);
          const ids = (row?.supporting_observation_ids as string[]) ?? [];
          hit.supporting_observations = ids
            .map((id) => obsMap.get(id))
            .filter(Boolean) as { id: string; content: string; reason_why: string }[];
        }
      }
    }

    return { hits, count: hits.length };
  },
};
