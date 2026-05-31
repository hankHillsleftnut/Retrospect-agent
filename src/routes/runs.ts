import { Router } from 'express';
import path from 'path';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

export const runsRouter = Router();

const DASHBOARD_HTML = path.join(__dirname, '..', 'public', 'runs-dashboard.html');

runsRouter.get('/', async (req, res) => {
  if (req.accepts('html') && !req.query.json) {
    return res.sendFile(DASHBOARD_HTML);
  }
  const { userId, limit = 50 } = req.query;
  let q = supabase
    .from(Tables.PIPELINE_RUN_TRACES)
    .select(
      'id, user_id, kind, status, triggered_by, started_at, finished_at, duration_ms, cost_breakdown, episode_id, parent_run_id, notes, error_message'
    )
    .order('started_at', { ascending: false })
    .limit(Number(limit));
  if (userId) q = q.eq('user_id', userId as string);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ runs: data ?? [] });
});

runsRouter.get('/latest', async (req, res) => {
  const { userId } = req.query;
  let q = supabase
    .from(Tables.PIPELINE_RUN_TRACES)
    .select('id')
    .order('started_at', { ascending: false })
    .limit(1);
  if (userId) q = q.eq('user_id', userId as string);
  const { data } = await q;
  if (!data || data.length === 0) return res.status(404).json({ error: 'no runs' });
  const id = (data[0] as { id: string }).id;

  if (req.accepts('html') && !req.query.json) {
    return res.redirect(`/runs/${id}`);
  }
  return res.redirect(`/runs/${id}?json=1`);
});

runsRouter.get('/:id', async (req, res) => {
  if (req.accepts('html') && !req.query.json) {
    return res.sendFile(DASHBOARD_HTML);
  }
  const { data, error } = await supabase
    .from(Tables.PIPELINE_RUN_TRACES)
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: error.message });

  // Hydrate IDs from inputs_snapshot into actual content
  const snap = (data as Record<string, unknown>).inputs_snapshot as Record<string, unknown> | null;
  if (snap) {
    const fetches: PromiseLike<void>[] = [];
    const ctx: Record<string, unknown> = {};

    if (Array.isArray(snap.observation_ids) && snap.observation_ids.length > 0) {
      fetches.push(
        supabase.from(Tables.OBSERVATIONS)
          .select('id, content, observation_date, goal_id, raw_content_id')
          .in('id', snap.observation_ids)
          .then(({ data: rows }) => { ctx.observations = rows ?? []; })
      );
    }
    if (Array.isArray(snap.insight_ids) && snap.insight_ids.length > 0) {
      fetches.push(
        supabase.from(Tables.INSIGHTS)
          .select('id, title, content, evidence_summary, created_at')
          .in('id', snap.insight_ids)
          .then(({ data: rows }) => { ctx.insights = rows ?? []; })
      );
    }
    if (Array.isArray(snap.active_goal_ids) && snap.active_goal_ids.length > 0) {
      fetches.push(
        supabase.from(Tables.GOALS)
          .select('id, title, description')
          .in('id', snap.active_goal_ids)
          .then(({ data: rows }) => { ctx.goals = rows ?? []; })
      );
    }
    if (snap.onboarding_profile_id) {
      fetches.push(
        supabase.from(Tables.RAW_CONTENT)
          .select('id, content_type, content, created_at')
          .eq('id', snap.onboarding_profile_id)
          .maybeSingle()
          .then(({ data: row }) => { ctx.onboardingProfile = row ?? null; })
      );
    }
    if (Array.isArray(snap.raw_content_ids) && snap.raw_content_ids.length > 0) {
      fetches.push(
        supabase.from(Tables.RAW_CONTENT)
          .select('id, content_type, content, created_at')
          .in('id', snap.raw_content_ids)
          .then(({ data: rows }) => { ctx.rawContent = rows ?? []; })
      );
    }

    await Promise.all(fetches);

    // For podcast runs: follow observation.raw_content_id to surface the actual journal entries
    // that fed into the podcast (ingestion runs already have raw_content directly in the snapshot).
    if (!snap.raw_content_ids && Array.isArray(ctx.observations) && (ctx.observations as Record<string, unknown>[]).length > 0) {
      const rcIds = [...new Set(
        (ctx.observations as Record<string, unknown>[])
          .map((o) => o['raw_content_id'])
          .filter((id): id is string => typeof id === 'string')
      )];
      if (rcIds.length > 0) {
        const { data: srcRows } = await supabase
          .from(Tables.RAW_CONTENT)
          .select('id, content_type, content, created_at')
          .in('id', rcIds);
        ctx.sourceEntries = srcRows ?? [];
      }
    }
    if (Object.keys(ctx).length > 0) {
      (data as Record<string, unknown>).context_data = ctx;
    }
  }

  return res.json({ run: data });
});

runsRouter.get('/:idA/compare/:idB', async (req, res) => {
  if (req.accepts('html') && !req.query.json) {
    return res.sendFile(DASHBOARD_HTML);
  }
  const [{ data: a }, { data: b }] = await Promise.all([
    supabase.from(Tables.PIPELINE_RUN_TRACES).select('*').eq('id', req.params.idA).maybeSingle(),
    supabase.from(Tables.PIPELINE_RUN_TRACES).select('*').eq('id', req.params.idB).maybeSingle(),
  ]);
  if (!a || !b) return res.status(404).json({ error: 'one or both runs not found' });
  return res.json({ a, b });
});
