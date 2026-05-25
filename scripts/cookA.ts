#!/usr/bin/env tsx
/**
 * Cook A in isolation — produces just the current-context outline.
 * No agent, no transcript, no TTS.
 *
 * Usage:
 *   npm run cookA -- --user <id> [--days 14]
 */
import { parseArgs, requireArg, optNum } from './_args';
import { writeOutput } from './_io';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { jsonChatCompletion } from '../src/services/openai';
import { CURRENT_CONTEXT_OUTLINE_SYSTEM_PROMPT } from '../src/prompts/current-context-outline';
import type { DbGoal, DbInsight, DbObservation, OutlineV1 } from '../src/types';

async function main() {
  const args = parseArgs();
  const userId = requireArg(args, 'user');
  const daysBack = optNum(args, 'days') ?? 14;
  const sinceIso = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  const [goalsRes, insightsRes, observationsRes] = await Promise.all([
    supabase.from(Tables.GOALS).select('*').eq('user_id', userId).eq('is_active', true),
    supabase
      .from(Tables.INSIGHTS)
      .select('*')
      .eq('user_id', userId)
      .gte('updated_at', sinceIso)
      .order('updated_at', { ascending: false }),
    supabase
      .from(Tables.OBSERVATIONS)
      .select('*')
      .eq('user_id', userId)
      .gte('observation_date', sinceIso)
      .order('observation_date', { ascending: false }),
  ]);

  const goals = (goalsRes.data ?? []) as DbGoal[];
  const insights = (insightsRes.data ?? []) as DbInsight[];
  const observations = (observationsRes.data ?? []) as DbObservation[];

  const userMessage = `# Active Goals
${goals.map((g) => `- [${g.id}] "${g.title}"${g.description ? `: ${g.description}` : ''}`).join('\n') || '(none)'}

# Recent Insights
${insights.map((i) => `- [${i.id}] "${i.title}": ${i.content}\n  Evidence: ${i.evidence_summary}\n  Goal: ${i.goal_id}`).join('\n') || '(none)'}

# Recent Observations
${observations.slice(0, 60).map((o) => `- [${o.id}] (goal:${o.goal_id ?? '∅'}) ${o.content}`).join('\n') || '(none)'}

Produce the structured OutlineV1 JSON.`;

  const { data } = await jsonChatCompletion<OutlineV1>(
    CURRENT_CONTEXT_OUTLINE_SYSTEM_PROMPT,
    userMessage,
    { temperature: 0.4, maxTokens: 4096 }
  );

  const out = writeOutput('outlineV1.json', data);
  console.log(`Outline written: ${out}`);
  console.log(`Theme: "${data.theme}"`);
  console.log(`Segments: ${data.segments.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
