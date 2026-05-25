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
