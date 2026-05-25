#!/usr/bin/env tsx
/**
 * Run the full pipeline against every JSON fixture in tests/scenarios/
 * and dump scripts side-by-side for prompt-regression spotting.
 *
 * Each scenario gets:
 *  - a temp user
 *  - fixture goals/preferences/raw_content seeded
 *  - ingest run
 *  - podcast run (--skip-tts)
 *  - script + outline written to scripts/outputs/scenarios/<ts>/<name>/
 *
 * The temp user is torn down at the end unless --keep is passed.
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { parseArgs, optBool } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { generateEmbeddings } from '../src/services/embeddings';
import { runIngest } from '../src/pipelines/ingest';
import { runPodcast } from '../src/pipelines/podcast';

const SCENARIO_DIR = path.join(__dirname, '..', 'tests', 'scenarios');

interface Scenario {
  name: string;
  description: string;
  goals: { title: string; description?: string }[];
  preferences?: {
    tone?: string;
    trusted_voice_description?: string;
    focus_areas?: string[];
    avoid_topics?: string[];
  };
  raw_content: { daysAgo: number; content_type: string; content: string }[];
}

async function seedScenario(scenario: Scenario): Promise<string> {
  const fakeAppleId = `scenario-${scenario.name}-${uuid().slice(0, 8)}`;
  const { data: user, error: userErr } = await supabase
    .from(Tables.USERS)
    .insert({ apple_user_id: fakeAppleId, email: `${fakeAppleId}@scenario.local` })
    .select('id')
    .single();
  if (userErr || !user) throw new Error(`Create scenario user failed: ${userErr?.message}`);

  // goals
  const goalRows = scenario.goals.map((g) => ({
    user_id: user.id,
    title: g.title,
    description: g.description ?? null,
    is_active: true,
  }));
  const { data: insertedGoals } = await supabase
    .from(Tables.GOALS)
    .insert(goalRows)
    .select('id, title, description');
  const embs = await generateEmbeddings(
    (insertedGoals ?? []).map((g) => `${g.title}\n${g.description ?? ''}`)
  );
  for (let i = 0; i < (insertedGoals ?? []).length; i++) {
    await supabase
      .from(Tables.GOALS)
      .update({ embedding: embs[i] })
      .eq('id', insertedGoals![i]!.id);
  }

  // preferences
  if (scenario.preferences) {
    await supabase.from(Tables.USER_PREFERENCES).insert({
      user_id: user.id,
      tone: scenario.preferences.tone ?? null,
      trusted_voice_description: scenario.preferences.trusted_voice_description ?? null,
      focus_areas: scenario.preferences.focus_areas ?? [],
      avoid_topics: scenario.preferences.avoid_topics ?? [],
      directives: [],
    });
  }

  // raw_content
  const now = Date.now();
  const rawRows = scenario.raw_content.map((rc) => ({
    user_id: user.id,
    content: rc.content,
    content_type: rc.content_type,
    content_date: new Date(now - rc.daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    processing_status: 'pending',
  }));
  const { data: inserted } = await supabase
    .from(Tables.RAW_CONTENT)
    .insert(rawRows)
    .select('id, content');
  const rcEmbs = await generateEmbeddings(
    (inserted ?? []).map((r) => r.content.slice(0, 2000))
  );
  for (let i = 0; i < (inserted ?? []).length; i++) {
    await supabase
      .from(Tables.RAW_CONTENT)
      .update({ embedding: rcEmbs[i] })
      .eq('id', inserted![i]!.id);
  }
  return user.id;
}

async function teardown(userId: string) {
  await supabase.from(Tables.EPISODE_FEEDBACK).delete().eq('user_id', userId);
  await supabase.from(Tables.PODCAST_EPISODES).delete().eq('user_id', userId);
  await supabase.from(Tables.GOAL_CANDIDATES).delete().eq('user_id', userId);
  await supabase.from(Tables.INSIGHTS).delete().eq('user_id', userId);
  await supabase.from(Tables.OBSERVATIONS).delete().eq('user_id', userId);
  await supabase.from(Tables.RAW_CONTENT).delete().eq('user_id', userId);
  await supabase.from(Tables.GOALS).delete().eq('user_id', userId);
  await supabase.from(Tables.USER_PREFERENCES).delete().eq('user_id', userId);
  await supabase.from(Tables.PIPELINE_RUN_TRACES).delete().eq('user_id', userId);
  await supabase.from(Tables.USERS).delete().eq('id', userId);
}

async function main() {
  const args = parseArgs();
  const keep = optBool(args, 'keep');

  const files = fs
    .readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.error('No scenarios found in', SCENARIO_DIR);
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, 'outputs', 'scenarios', stamp);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Running ${files.length} scenarios → ${outDir}`);

  for (const file of files) {
    const scenario = JSON.parse(fs.readFileSync(path.join(SCENARIO_DIR, file), 'utf-8')) as Scenario;
    const scenarioOutDir = path.join(outDir, scenario.name);
    fs.mkdirSync(scenarioOutDir, { recursive: true });
    console.log(`\n=== ${scenario.name} ===`);
    console.log(`    ${scenario.description}`);

    const userId = await seedScenario(scenario);
    try {
      const ingestResult = await runIngest({
        userId,
        daysBack: 30,
        triggeredBy: 'cli',
        notes: `scenario:${scenario.name}`,
      });
      fs.writeFileSync(path.join(scenarioOutDir, 'ingest.json'), JSON.stringify(ingestResult, null, 2));
      console.log(
        `    ingest → obs=${ingestResult.observations_created} ins=${ingestResult.insights_created} cand=${ingestResult.goal_candidates_created}`
      );

      const podcastResult = await runPodcast({
        userId,
        daysBack: 30,
        skipTTS: true,
        triggeredBy: 'cli',
        notes: `scenario:${scenario.name}`,
      });
      fs.writeFileSync(
        path.join(scenarioOutDir, 'outlineV1.json'),
        JSON.stringify(podcastResult.outlineV1, null, 2)
      );
      fs.writeFileSync(
        path.join(scenarioOutDir, 'outlineV2.json'),
        JSON.stringify(podcastResult.outlineV2, null, 2)
      );
      fs.writeFileSync(path.join(scenarioOutDir, 'script.txt'), podcastResult.script);
      fs.writeFileSync(path.join(scenarioOutDir, 'summary.txt'), podcastResult.summary);
      console.log(`    podcast → "${podcastResult.title}" (${podcastResult.script.split(/\s+/).length} words)`);
      console.log(`    trace: ${podcastResult.traceId}`);
    } catch (err) {
      console.error(`    FAILED: ${err instanceof Error ? err.message : err}`);
      fs.writeFileSync(
        path.join(scenarioOutDir, 'error.txt'),
        err instanceof Error ? err.stack ?? err.message : String(err)
      );
    } finally {
      if (!keep) {
        await teardown(userId);
        console.log(`    cleaned up.`);
      } else {
        console.log(`    --keep set, user retained: ${userId}`);
      }
    }
  }

  console.log(`\nAll scenarios done. Outputs: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
