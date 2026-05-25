#!/usr/bin/env tsx
/**
 * `npm run doctor`
 *
 * Checks everything needed for the project to be fully functional:
 *   - All required env vars are present
 *   - Supabase is reachable
 *   - Migrations 100 and 101 are applied
 *   - The podcast-audio storage bucket exists (warn only — needed for TTS)
 *   - OpenAI API key works
 *
 * Prints a colored checklist with exact fix instructions for any failures.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
  fix?: string;
  severity?: 'error' | 'warn';
}

const results: CheckResult[] = [];

function record(r: CheckResult) {
  results.push(r);
  const icon = r.ok ? `${GREEN}✓${RESET}` : r.severity === 'warn' ? `${YELLOW}⚠${RESET}` : `${RED}✗${RESET}`;
  const name = r.ok ? `${BOLD}${r.name}${RESET}` : `${BOLD}${r.severity === 'warn' ? YELLOW : RED}${r.name}${RESET}`;
  console.log(`${icon} ${name}${r.detail ? DIM + ' — ' + r.detail + RESET : ''}`);
  if (!r.ok && r.fix) {
    console.log(`    ${BLUE}fix:${RESET} ${r.fix}`);
  }
}

async function checkEnv() {
  console.log(`\n${BOLD}── env vars ──${RESET}`);
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY'];
  for (const k of required) {
    const v = process.env[k];
    record({
      name: k,
      ok: !!v && v.length > 5,
      detail: v ? `set (${v.length} chars)` : 'missing',
      fix: 'add to .env (try: npm run setup)',
    });
  }
  const optional: { key: string; reason: string }[] = [
    { key: 'PERPLEXITY_API_KEY', reason: 'internet_research tool will be a no-op without this' },
    { key: 'ELEVENLABS_API_KEY', reason: 'TTS will be skipped (use --skip-tts) without this' },
    { key: 'ANTHROPIC_API_KEY', reason: 'not currently used by the agent; safe to skip' },
  ];
  for (const o of optional) {
    const v = process.env[o.key];
    record({
      name: o.key,
      ok: !!v,
      severity: 'warn',
      detail: v ? 'set' : o.reason,
      fix: 'optional — add to .env if you want this feature',
    });
  }
}

async function checkSupabase() {
  console.log(`\n${BOLD}── supabase ──${RESET}`);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    record({ name: 'connect', ok: false, severity: 'error', detail: 'env not set', fix: 'see above' });
    return null;
  }
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await supabase.from('users').select('id').limit(1);
    record({
      name: 'connect',
      ok: !error,
      detail: error ? error.message : 'reachable',
      fix: 'verify SUPABASE_URL and SUPABASE_SERVICE_KEY (not the anon key!)',
    });
    if (error) return null;
    return supabase;
  } catch (err) {
    record({
      name: 'connect',
      ok: false,
      severity: 'error',
      detail: err instanceof Error ? err.message : String(err),
      fix: 'check your network and supabase URL',
    });
    return null;
  }
}

async function checkSchema(supabase: any) {
  console.log(`\n${BOLD}── schema (migration 100) ──${RESET}`);

  // Table checks: try select 1 row
  const newTables = ['user_preferences', 'goal_candidates', 'episode_feedback'];
  for (const t of newTables) {
    const { error } = await supabase.from(t).select('id').limit(1);
    record({
      name: `table ${t}`,
      ok: !error,
      detail: error ? error.message.split('\n')[0] : 'exists',
      fix: 'apply supabase/migrations/100_agent_extensions.sql',
    });
  }

  // Column checks via information_schema (use a generic select)
  const columnChecks: { table: string; column: string; via: string }[] = [
    { table: 'observations', column: 'is_goal_candidate', via: 'select is_goal_candidate from observations limit 1' },
    { table: 'podcast_episodes', column: 'summary', via: 'select summary from podcast_episodes limit 1' },
    { table: 'podcast_episodes', column: 'summary_embedding', via: 'select id from podcast_episodes where summary_embedding is null limit 1' },
    { table: 'raw_content', column: 'embedding', via: 'select id from raw_content where embedding is null limit 1' },
  ];
  for (const c of columnChecks) {
    // We rely on the column being readable; a missing column produces an error.
    const { error } = await (supabase.from(c.table) as any)
      .select(c.column)
      .limit(1);
    record({
      name: `${c.table}.${c.column}`,
      ok: !error,
      detail: error ? error.message.split('\n')[0] : 'exists',
      fix: 'apply supabase/migrations/100_agent_extensions.sql',
    });
  }

  // RPC checks
  console.log(`\n${BOLD}── rpc functions ──${RESET}`);
  const rpcChecks: { name: string; args: Record<string, unknown> }[] = [
    {
      name: 'match_observations',
      args: {
        query_embedding: new Array(3072).fill(0),
        match_threshold: 0.99,
        match_count: 1,
        filter_user_id: '00000000-0000-0000-0000-000000000000',
        filter_goal_id: null,
      },
    },
    {
      name: 'match_user_insights',
      args: {
        query_embedding: new Array(3072).fill(0),
        match_threshold: 0.99,
        match_count: 1,
        filter_user_id: '00000000-0000-0000-0000-000000000000',
        filter_goal_id: null,
      },
    },
    {
      name: 'match_podcast_summaries',
      args: {
        query_embedding: new Array(3072).fill(0),
        match_threshold: 0.99,
        match_count: 1,
        filter_user_id: '00000000-0000-0000-0000-000000000000',
      },
    },
    {
      name: 'match_raw_content',
      args: {
        query_embedding: new Array(3072).fill(0),
        match_threshold: 0.99,
        match_count: 1,
        filter_user_id: '00000000-0000-0000-0000-000000000000',
        start_date: null,
        end_date: null,
      },
    },
  ];
  for (const r of rpcChecks) {
    const { error } = await supabase.rpc(r.name, r.args as any);
    record({
      name: `rpc ${r.name}`,
      ok: !error,
      detail: error ? error.message.split('\n')[0] : 'callable',
      fix: r.name.startsWith('match_observations') || r.name.startsWith('match_user_insights')
        ? 'should exist from Retrospect migration 003 — check that migration was applied'
        : 'apply supabase/migrations/100_agent_extensions.sql',
    });
  }

  // Trace table (migration 101)
  console.log(`\n${BOLD}── schema (migration 101) ──${RESET}`);
  {
    const { error } = await supabase.from('pipeline_run_traces').select('id').limit(1);
    record({
      name: 'table pipeline_run_traces',
      ok: !error,
      detail: error ? error.message.split('\n')[0] : 'exists',
      fix: 'apply supabase/migrations/101_pipeline_run_traces.sql',
    });
  }
}

async function checkStorage(supabase: any) {
  console.log(`\n${BOLD}── storage ──${RESET}`);
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    record({
      name: 'list buckets',
      ok: false,
      severity: 'warn',
      detail: error.message,
      fix: 'check supabase service key has storage access',
    });
    return;
  }
  const has = (data ?? []).some((b: { name: string }) => b.name === 'podcast-audio');
  record({
    name: 'bucket podcast-audio',
    ok: has,
    severity: 'warn',
    detail: has ? 'exists' : 'missing',
    fix: 'Supabase dashboard -> Storage -> New Bucket -> name: podcast-audio (public). Only needed for non-skip-tts runs.',
  });
}

async function checkOpenAI() {
  console.log(`\n${BOLD}── openai ──${RESET}`);
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    record({ name: 'api key', ok: false, severity: 'error', detail: 'missing', fix: 'add OPENAI_API_KEY to .env' });
    return;
  }
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    record({
      name: 'auth',
      ok: res.ok,
      detail: res.ok ? `${res.status} OK` : `${res.status} ${res.statusText}`,
      fix: 'verify OPENAI_API_KEY is valid and active',
    });
  } catch (err) {
    record({ name: 'auth', ok: false, severity: 'error', detail: String(err), fix: 'check network' });
  }
}

async function checkFiles() {
  console.log(`\n${BOLD}── files ──${RESET}`);
  const projectRoot = path.resolve(__dirname, '..');
  const expected = [
    'supabase/migrations/100_agent_extensions.sql',
    'supabase/migrations/101_pipeline_run_traces.sql',
    'src/index.ts',
    '.env',
  ];
  for (const f of expected) {
    const full = path.join(projectRoot, f);
    record({
      name: f,
      ok: fs.existsSync(full),
      detail: fs.existsSync(full) ? 'present' : 'missing',
      fix: f === '.env' ? 'run: npm run setup' : 'file is part of the repo — re-check git status',
    });
  }
}

async function main() {
  console.log(`${BOLD}retrospect-agent doctor${RESET}\n`);
  await checkEnv();
  await checkFiles();
  const supabase = await checkSupabase();
  if (supabase) {
    await checkSchema(supabase);
    await checkStorage(supabase);
  }
  await checkOpenAI();

  const errors = results.filter((r) => !r.ok && r.severity !== 'warn');
  const warns = results.filter((r) => !r.ok && r.severity === 'warn');

  console.log(`\n${BOLD}── summary ──${RESET}`);
  console.log(`  ${GREEN}${results.filter((r) => r.ok).length} ok${RESET}`);
  console.log(`  ${YELLOW}${warns.length} warning${warns.length === 1 ? '' : 's'}${RESET}`);
  console.log(`  ${RED}${errors.length} error${errors.length === 1 ? '' : 's'}${RESET}`);

  if (errors.length === 0) {
    console.log(`\n${GREEN}${BOLD}You are good to go.${RESET}\n`);
    console.log(`Try:`);
    console.log(`  npm run seed:demo`);
    console.log(`  npm run ingest -- --user <demo-id>`);
    console.log(`  npm run podcast -- --user <demo-id> --skip-tts`);
    console.log(`  npm run dev   # then open http://localhost:3001/runs\n`);
  } else {
    console.log(`\n${RED}${BOLD}Fix the errors above before running anything else.${RESET}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
