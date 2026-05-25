#!/usr/bin/env tsx
/**
 * Cook C in isolation — takes a Cook B outline file, writes the final script.
 *
 * Usage:
 *   npm run cookC -- --user <id> --outline scripts/outputs/<timestamp>-outlineV2.json
 */
import { parseArgs, requireArg } from './_args';
import { readJsonFile, writeOutput } from './_io';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { chatCompletion } from '../src/services/openai';
import { FINAL_TRANSCRIPT_SYSTEM_PROMPT } from '../src/prompts/final-transcript';
import type { OutlineV2, DbUserPreferences, DbEpisodeFeedback } from '../src/types';

async function main() {
  const args = parseArgs();
  const userId = requireArg(args, 'user');
  const outlinePath = requireArg(args, 'outline');

  const outlineV2 = readJsonFile<OutlineV2>(outlinePath);

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

  const prefs = (prefsRes.data as DbUserPreferences | null) ?? null;
  const feedback = ((feedbackRes.data ?? []) as DbEpisodeFeedback[]).map((f) => ({
    date: f.created_at,
    text: f.feedback_text,
  }));

  const prefsBlock = prefs
    ? `tone: ${prefs.tone ?? '(none)'}
trusted_voice_description: ${prefs.trusted_voice_description ?? '(none)'}
focus_areas: ${prefs.focus_areas.join(', ') || '(none)'}
avoid_topics: ${prefs.avoid_topics.join(', ') || '(none)'}
directives:
${prefs.directives.slice(-10).reverse().map((d) => `  - (${d.date.slice(0, 10)}) ${d.text}`).join('\n') || '  (none)'}`
    : '(no preferences set)';

  const userMessage = `# User Preferences
${prefsBlock}

${feedback.length > 0 ? `# Unprocessed Feedback\n${feedback.map((f) => `  - (${f.date.slice(0, 10)}) ${f.text}`).join('\n')}\n` : ''}

# Enriched Outline
${JSON.stringify(outlineV2, null, 2)}

Write the final podcast script now.`;

  const { text } = await chatCompletion(FINAL_TRANSCRIPT_SYSTEM_PROMPT, userMessage, {
    temperature: 0.7,
    maxTokens: 6000,
  });

  const out = writeOutput('script.txt', text);
  console.log(`Script written: ${out}`);
  console.log(`Words: ${text.split(/\s+/).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
