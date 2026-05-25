#!/usr/bin/env tsx
/**
 * Seed a fake user with hand-crafted raw_content + goals + preferences.
 * Idempotent — re-running just resets the demo user's data.
 *
 * Usage:
 *   npm run seed:demo                # seed default demo user
 *   npm run seed:demo -- --reset     # delete and re-create
 */
import { parseArgs, optBool } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { generateEmbedding, generateEmbeddings } from '../src/services/embeddings';
import {
  DEMO_USER,
  DEMO_GOALS,
  DEMO_RAW_CONTENT,
  DEMO_PREFERENCES,
} from '../tests/fixtures/demo-user';

async function findOrCreateDemoUser(): Promise<string> {
  const { data: existing } = await supabase
    .from(Tables.USERS)
    .select('id')
    .eq('apple_user_id', DEMO_USER.apple_user_id)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from(Tables.USERS)
    .insert(DEMO_USER)
    .select('id')
    .single();
  if (error || !data) throw new Error(`Create user failed: ${error?.message}`);
  return data.id;
}

async function wipeUser(userId: string) {
  await supabase.from(Tables.EPISODE_FEEDBACK).delete().eq('user_id', userId);
  await supabase.from(Tables.PODCAST_EPISODES).delete().eq('user_id', userId);
  await supabase.from(Tables.GOAL_CANDIDATES).delete().eq('user_id', userId);
  await supabase.from(Tables.INSIGHTS).delete().eq('user_id', userId);
  await supabase.from(Tables.OBSERVATIONS).delete().eq('user_id', userId);
  await supabase.from(Tables.RAW_CONTENT).delete().eq('user_id', userId);
  await supabase.from(Tables.GOALS).delete().eq('user_id', userId);
  await supabase.from(Tables.USER_PREFERENCES).delete().eq('user_id', userId);
}

async function main() {
  const args = parseArgs();
  const reset = optBool(args, 'reset');

  const userId = await findOrCreateDemoUser();
  console.log(`Demo user: ${userId}`);

  if (reset) {
    await wipeUser(userId);
    console.log('Wiped existing demo data.');
  }

  // Goals
  const { data: existingGoals } = await supabase
    .from(Tables.GOALS)
    .select('id')
    .eq('user_id', userId);
  if (!existingGoals || existingGoals.length === 0) {
    const goalsToInsert = DEMO_GOALS.map((g) => ({
      user_id: userId,
      title: g.title,
      description: g.description,
      is_active: true,
    }));
    const { data: insertedGoals, error: goalsErr } = await supabase
      .from(Tables.GOALS)
      .insert(goalsToInsert)
      .select('id, title, description');
    if (goalsErr) throw new Error(`Insert goals failed: ${goalsErr.message}`);

    const texts = (insertedGoals ?? []).map((g) => `${g.title}\n${g.description ?? ''}`);
    const embs = await generateEmbeddings(texts);
    for (let i = 0; i < (insertedGoals ?? []).length; i++) {
      await supabase
        .from(Tables.GOALS)
        .update({ embedding: embs[i] })
        .eq('id', insertedGoals![i]!.id);
    }
    console.log(`Inserted ${insertedGoals?.length ?? 0} goals.`);
  }

  // Raw content
  const { data: existingRaw } = await supabase
    .from(Tables.RAW_CONTENT)
    .select('id')
    .eq('user_id', userId);
  if (!existingRaw || existingRaw.length === 0) {
    const now = Date.now();
    const rawRows = DEMO_RAW_CONTENT.map((rc) => {
      const date = new Date(now - rc.daysAgo * 24 * 60 * 60 * 1000).toISOString();
      return {
        user_id: userId,
        content: rc.content,
        content_type: rc.content_type,
        content_date: date,
        processing_status: 'pending',
      };
    });
    const { data: insertedRaw } = await supabase
      .from(Tables.RAW_CONTENT)
      .insert(rawRows)
      .select('id, content');

    // Embeddings for raw_content (so search_raw_content tool works)
    if (insertedRaw && insertedRaw.length > 0) {
      const embeddings = await generateEmbeddings(insertedRaw.map((r) => r.content.slice(0, 2000)));
      for (let i = 0; i < insertedRaw.length; i++) {
        await supabase
          .from(Tables.RAW_CONTENT)
          .update({ embedding: embeddings[i] })
          .eq('id', insertedRaw[i]!.id);
      }
    }
    console.log(`Inserted ${insertedRaw?.length ?? 0} raw_content rows.`);
  }

  // Preferences
  const { data: existingPrefs } = await supabase
    .from(Tables.USER_PREFERENCES)
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!existingPrefs) {
    await supabase.from(Tables.USER_PREFERENCES).insert({
      user_id: userId,
      ...DEMO_PREFERENCES,
    });
    console.log('Inserted user_preferences.');
  }

  console.log(`\nDone. Demo user id: ${userId}`);
  console.log(`\nNext steps:`);
  console.log(`  npm run ingest -- --user ${userId}`);
  console.log(`  npm run podcast -- --user ${userId} --skip-tts`);
  console.log(`  open http://localhost:3001/runs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
