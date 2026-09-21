import { supabase } from '../../db/supabase';
import { Tables } from '../../db/tables';
import type { AgentTool } from './types';

interface Args {
  query: string;
  assertion_kind?: 'observed' | 'inferred' | 'user_confirmed' | 'contradicted' | 'superseded';
  include_contradicted?: boolean;
  start_date?: string;
  end_date?: string;
  limit?: number;
}

function terms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9@._+-]+/).filter((term) => term.length >= 2))];
}

export const searchPersonalGraphTool: AgentTool<Args, {
  assertions: Record<string, unknown>[];
  relations: Record<string, unknown>[];
  count: number;
}> = {
  name: 'search_personal_graph',
  description:
    "Search the user's evidence-backed personal graph. Use this to examine canonical people/projects/topics, time-scoped observed facts, inferred hypotheses, user confirmations, and explicit support or contradiction relationships. Every returned claim includes its evidence links.",
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language topic, person, project, behavior, or relationship to inspect' },
      assertion_kind: {
        type: 'string',
        enum: ['observed', 'inferred', 'user_confirmed', 'contradicted', 'superseded'],
        description: 'Optional epistemic class filter',
      },
      include_contradicted: {
        type: 'boolean',
        default: true,
        description: 'Include contradicted claims so tensions and belief changes remain visible',
      },
      start_date: { type: 'string', description: 'Optional ISO event-time lower bound' },
      end_date: { type: 'string', description: 'Optional ISO event-time upper bound' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
    required: ['query'],
  },
  async execute(args, ctx) {
    let query = supabase.from(Tables.ASSERTIONS)
      .select('id,predicate,object_value,assertion_kind,confidence,event_time,observed_at,valid_from,valid_to,status,metadata,subject:entities!assertions_subject_entity_id_fkey(id,entity_type,canonical_name,attributes),object:entities!assertions_object_entity_id_fkey(id,entity_type,canonical_name,attributes),assertion_evidence(id,evidence_role,weight,excerpt,source_item_id,raw_content_id)')
      .eq('user_id', ctx.userId)
      .order('observed_at', { ascending: false })
      .limit(500);
    if (args.assertion_kind) query = query.eq('assertion_kind', args.assertion_kind);
    if (!args.include_contradicted) query = query.eq('status', 'active');
    if (args.start_date) query = query.gte('event_time', args.start_date);
    if (args.end_date) query = query.lte('event_time', args.end_date);
    const { data, error } = await query;
    if (error) throw new Error(`Search personal graph failed: ${error.message}`);

    const queryTerms = terms(args.query);
    const ranked = (data ?? []).map((assertion) => {
      const haystack = JSON.stringify(assertion).toLowerCase();
      const score = queryTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { assertion: assertion as Record<string, unknown>, score };
    }).filter((row) => queryTerms.length === 0 || row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, args.limit ?? 20)
      .map((row) => row.assertion);

    const ids = ranked.map((row) => row.id).filter((id): id is string => typeof id === 'string');
    const relationRows: Record<string, unknown>[] = [];
    if (ids.length > 0) {
      const [outgoing, incoming] = await Promise.all([
        supabase.from(Tables.ASSERTION_RELATIONS).select('*').eq('user_id', ctx.userId).in('from_assertion_id', ids),
        supabase.from(Tables.ASSERTION_RELATIONS).select('*').eq('user_id', ctx.userId).in('to_assertion_id', ids),
      ]);
      if (outgoing.error || incoming.error) {
        throw new Error(`Load personal graph relations failed: ${outgoing.error?.message ?? incoming.error?.message}`);
      }
      const unique = new Map<string, Record<string, unknown>>();
      for (const relation of [...(outgoing.data ?? []), ...(incoming.data ?? [])]) unique.set(relation.id, relation);
      relationRows.push(...unique.values());
    }
    return { assertions: ranked, relations: relationRows, count: ranked.length };
  },
};
