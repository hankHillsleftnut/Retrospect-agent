#!/usr/bin/env tsx
/**
 * Cook B in isolation — takes a Cook A outline file, runs the agent, writes Cook B outline.
 *
 * Usage:
 *   npm run cookB -- --user <id> --outline scripts/outputs/<timestamp>-outlineV1.json
 */
import { parseArgs, requireArg } from './_args';
import { readJsonFile, writeOutput } from './_io';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { runPodcastAgent } from '../src/agents/podcast-agent';
import { Trace } from '../src/pipelines/trace';
import type { OutlineV1, DbUserPreferences, DbEpisodeFeedback } from '../src/types';

async function main() {
  const args = parseArgs();
  const userId = requireArg(args, 'user');
  const outlinePath = requireArg(args, 'outline');

  const outlineV1 = readJsonFile<OutlineV1>(outlinePath);

  const [prefsRes, feedbackRes] = await Promise.all([
    supabase.from(Tables.USER_PREFERENCES).select('*').eq('user_id', userId).maybeSingle(),
    supabase
      .from(Tables.EPISODE_FEEDBACK)
      .select('*')
      .eq('user_id', userId)
      .eq('processed', false)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const trace = await Trace.start({ userId, kind: 'cookB', triggeredBy: 'cli' });
  try {
    const outlineV2 = await runPodcastAgent({
      userId,
      outlineV1,
      preferences: (prefsRes.data as DbUserPreferences | null) ?? null,
      unprocessedFeedback: ((feedbackRes.data ?? []) as DbEpisodeFeedback[]).map((f) => ({
        date: f.created_at,
        text: f.feedback_text,
      })),
      trace,
    });
    trace.setOutlineV1(outlineV1);
    trace.setOutlineV2(outlineV2);
    await trace.complete();

    const out = writeOutput('outlineV2.json', outlineV2);
    console.log(`Outline v2 written: ${out}`);
    console.log(`Tool calls: ${trace.snapshot().agent_tool_calls.length}`);
    console.log(`Trace: ${trace.id}`);
    console.log(`Dashboard: http://localhost:3001/runs/${trace.id}`);
  } catch (err) {
    await trace.fail(err);
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
