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
  const runData = data as Record<string, unknown>;
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
    // Identity inferences produced by this ingestion run.
    // Prefer the trace column; fall back to inputs_snapshot.active_inference_ids
    // (set by the standalone cook0 endpoint).
    const inferenceIds =
      ((runData.identity_inference_ids as string[] | undefined) ??
        (snap.active_inference_ids as string[] | undefined) ??
        []) as string[];
    if (Array.isArray(inferenceIds) && inferenceIds.length > 0) {
      const { data: infRows } = await supabase
        .from(Tables.IDENTITY_INFERENCES)
        .select(
          'id, content, domain, domain_label, confidence_score, is_provisional, evidence_summary, created_at, retired_at, superseded_by'
        )
        .in('id', inferenceIds);
      ctx.identity_inferences = infRows ?? [];
    }

    // User Understanding Document — what Cook 0 wrote in this run.
    // Try in order:
    //   1. Trace column (preferred — set by trace.setUserUnderstanding)
    //   2. inputs_snapshot.user_understanding_version (for podcast runs)
    //   3. Look up by source_ingestion_run_id (most robust for ingest/cook0 runs)
    //   4. Fall back to the user's latest document version
    const runUserId = runData.user_id as string;
    if (runData.user_understanding_document) {
      ctx.user_understanding_document = runData.user_understanding_document;
      ctx.user_understanding_version = runData.user_understanding_version;
    } else if (snap.user_understanding_version != null) {
      const { data: docRow } = await supabase
        .from(Tables.USER_UNDERSTANDING)
        .select('document, version, generation_notes, created_at')
        .eq('user_id', runUserId)
        .eq('version', snap.user_understanding_version as number)
        .maybeSingle();
      if (docRow) {
        ctx.user_understanding_document = docRow.document;
        ctx.user_understanding_version = docRow.version;
        ctx.user_understanding_generation_notes = docRow.generation_notes;
      }
    } else {
      // Look up by source_ingestion_run_id first (this run's own document)
      const { data: docRow } = await supabase
        .from(Tables.USER_UNDERSTANDING)
        .select('document, version, generation_notes, created_at')
        .eq('source_ingestion_run_id', req.params.id)
        .maybeSingle();
      if (docRow) {
        ctx.user_understanding_document = docRow.document;
        ctx.user_understanding_version = docRow.version;
        ctx.user_understanding_generation_notes = docRow.generation_notes;
      } else {
        // Final fallback: latest document for this user.
        const { data: latest } = await supabase
          .from(Tables.USER_UNDERSTANDING)
          .select('document, version, generation_notes, created_at')
          .eq('user_id', runUserId)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest) {
          ctx.user_understanding_document = latest.document;
          ctx.user_understanding_version = latest.version;
          ctx.user_understanding_generation_notes = latest.generation_notes;
        }
      }
    }

    if (Object.keys(ctx).length > 0) {
      runData.context_data = ctx;
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
