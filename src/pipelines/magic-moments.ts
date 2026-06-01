import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { claudeJsonCompletion } from '../services/anthropic';
import { config } from '../config';
import { MAGIC_MOMENTS_SYSTEM_PROMPT } from '../prompts/magic-moments';
import type { Trace } from './trace';
import type { DbRawContent, MagicMoment, MagicMomentsResult } from '../types';

export interface RunMagicMomentsOptions {
  userId: string;
  /** Keep this many top moments (by strength). Default 2. */
  keep?: number;
  trace?: Trace;
}

export interface RunMagicMomentsSummary {
  moments: MagicMoment[];
  notes?: string;
  hadOnboarding: boolean;
  integrationTypes: string[];
}

const INTEGRATION_TYPES = ['healthkit', 'screen_time', 'google_docs', 'calendar', 'social_web_research'];

/**
 * The interpretation engine. Pure-ish: reads onboarding + integration raw
 * content for a user, asks Claude for the magic moments, returns the top N.
 *
 * Deliberately self-contained so it can be driven by a standalone endpoint now
 * and folded into the ingest pipeline later without rewriting the logic.
 */
export async function runMagicMoments(
  options: RunMagicMomentsOptions
): Promise<RunMagicMomentsSummary> {
  const keep = options.keep ?? 2;

  // 1. Pull onboarding answers (richest single source).
  const { data: onboardingRows } = await supabase
    .from(Tables.RAW_CONTENT)
    .select('id, content_type, content, created_at, metadata')
    .eq('user_id', options.userId)
    .eq('content_type', 'onboarding_profile')
    .order('created_at', { ascending: false })
    .limit(1);

  const onboarding = (onboardingRows?.[0] ?? null) as DbRawContent | null;

  // 2. Pull integration data ingested during/around onboarding (last 60 days).
  const sinceIso = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data: integrationRows } = await supabase
    .from(Tables.RAW_CONTENT)
    .select('id, content_type, content, created_at, metadata')
    .eq('user_id', options.userId)
    .in('content_type', INTEGRATION_TYPES)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(60);

  const integrations = (integrationRows ?? []) as DbRawContent[];
  const integrationTypes = [...new Set(integrations.map((r) => r.content_type))];

  // 3. Build the input blocks.
  const onboardingBlock = onboarding
    ? `# ONBOARDING ANSWERS (the user's own words)
${onboarding.content.slice(0, 10000)}`
    : `# ONBOARDING ANSWERS
(none found — interpret from integration data alone, and say so in notes.)`;

  const integrationBlock = integrations.length > 0
    ? `# INTEGRATION DATA (what their life actually shows)
${summarizeIntegrations(integrations)}`
    : `# INTEGRATION DATA
(none connected — build moments from the answers alone. Note the absence.)`;

  const userMessage = `${onboardingBlock}

${integrationBlock}

Find the magic moments. Cross-reference what they SAID against what their DATA SHOWS. Return STRICT JSON per your system prompt.`;

  // 4. Call Claude.
  const { data, usage } = await claudeJsonCompletion<MagicMomentsResult>(
    MAGIC_MOMENTS_SYSTEM_PROMPT,
    userMessage,
    { maxTokens: 4000, model: config.anthropic.cook0Model }
  );

  options.trace?.addCost({
    anthropic_tokens_input: usage.inputTokens,
    anthropic_tokens_output: usage.outputTokens,
  });

  // 5. Normalize + keep top N by strength.
  const moments = normalizeMoments(data.moments)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, keep);

  return {
    moments,
    notes: data.notes,
    hadOnboarding: !!onboarding,
    integrationTypes,
  };
}

function summarizeIntegrations(rows: DbRawContent[]): string {
  // Group by type, cap each group so the prompt stays bounded.
  const byType: Record<string, DbRawContent[]> = {};
  for (const r of rows) {
    (byType[r.content_type] ??= []).push(r);
  }
  const blocks: string[] = [];
  for (const [type, items] of Object.entries(byType)) {
    const lines = items
      .slice(0, 14)
      .map((r) => `  - (${r.created_at.slice(0, 10)}) ${r.content.slice(0, 400)}`)
      .join('\n');
    blocks.push(`## ${type} (${items.length} entries)\n${lines}`);
  }
  return blocks.join('\n\n');
}

function normalizeMoments(raw: unknown): MagicMoment[] {
  if (!Array.isArray(raw)) return [];
  const valid: MagicMoment[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const o = m as Record<string, unknown>;
    if (typeof o.reframe !== 'string' || typeof o.pattern !== 'string') continue;
    valid.push({
      structure: (typeof o.structure === 'string' ? o.structure : 'contradiction') as MagicMoment['structure'],
      title: typeof o.title === 'string' ? o.title : '',
      pattern: o.pattern,
      evidence: typeof o.evidence === 'string' ? o.evidence : '',
      reframe: o.reframe,
      future_self_line: typeof o.future_self_line === 'string' ? o.future_self_line : null,
      hypothesis: typeof o.hypothesis === 'string' ? o.hypothesis : '',
      strength: typeof o.strength === 'number' ? Math.max(0, Math.min(1, o.strength)) : 0.5,
    });
  }
  return valid;
}
