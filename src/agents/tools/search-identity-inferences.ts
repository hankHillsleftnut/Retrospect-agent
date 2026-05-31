import { supabase } from '../../db/supabase';
import { generateEmbedding } from '../../services/embeddings';
import type { AgentTool } from './types';

interface Args {
  query: string;
  domain?:
    | 'self_concept'
    | 'emotional'
    | 'work_achievement'
    | 'relational'
    | 'physical'
    | 'cognitive'
    | 'emerging';
  min_confidence?: number;
  include_provisional?: boolean;
  limit?: number;
  match_threshold?: number;
}

interface Hit {
  id: string;
  content: string;
  domain: string;
  domain_label: string | null;
  confidence_score: number;
  is_provisional: boolean;
  evidence_summary: string | null;
  created_at: string;
  similarity: number;
}

export const searchIdentityInferencesTool: AgentTool<Args, { hits: Hit[]; count: number }> = {
  name: 'search_identity_inferences',
  description:
    "Embedding-search the user's identity inferences — high-level claims about WHO this person is (their self-concept, emotional baseline, relational patterns, etc.). Use this when you want to ground a podcast segment in a durable trait or pattern, or check whether the system has a confident claim about a specific aspect of the user. Returns only active (non-superseded, non-retired) inferences.",
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What aspect of identity are you looking for' },
      domain: {
        type: 'string',
        enum: [
          'self_concept',
          'emotional',
          'work_achievement',
          'relational',
          'physical',
          'cognitive',
          'emerging',
        ],
        description: 'Restrict to a specific identity domain',
      },
      min_confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        default: 0.0,
        description: 'Lower bound on confidence_score',
      },
      include_provisional: {
        type: 'boolean',
        default: true,
        description:
          'Whether to include provisional inferences (single-evidence, not yet corroborated). Set false to only get high-trust claims.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
      match_threshold: { type: 'number', minimum: 0, maximum: 1, default: 0.3 },
    },
    required: ['query'],
  },
  async execute(args, ctx) {
    const embedding = await generateEmbedding(args.query);
    const { data, error } = await supabase.rpc('match_identity_inferences', {
      query_embedding: embedding,
      match_threshold: args.match_threshold ?? 0.3,
      match_count: args.limit ?? 10,
      filter_user_id: ctx.userId,
      filter_domain: args.domain ?? null,
      filter_min_confidence: args.min_confidence ?? 0.0,
      filter_include_provisional: args.include_provisional !== false,
    });
    if (error) throw new Error(`search_identity_inferences RPC failed: ${error.message}`);
    const hits = (data ?? []) as Hit[];
    return { hits, count: hits.length };
  },
};
