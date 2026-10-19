import { Router } from 'express';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runDailyBrief } from '../briefs/run-daily-brief';

export const briefsRouter = Router();

/** GET /briefs/:userId/latest -- their most recent daily brief, or null. */
briefsRouter.get('/:userId/latest', async (req, res) => {
  const { data, error } = await supabase.from(Tables.DAILY_BRIEFS).select('*')
    .eq('user_id', req.params.userId).order('brief_date', { ascending: false }).limit(1).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ brief: data ?? null });
});

/** POST /briefs/generate { userId, dryRun? } -- make today's brief now. */
briefsRouter.post('/generate', async (req, res) => {
  const { userId, dryRun } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    return res.json(await runDailyBrief(userId, { dryRun: !!dryRun }));
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** PUT /briefs/:userId/enabled { enabled } -- the per-person on/off switch (default off). */
briefsRouter.put('/:userId/enabled', async (req, res) => {
  const enabled = req.body?.enabled === true;
  const { error } = await supabase.from(Tables.USERS).update({ daily_brief_enabled: enabled }).eq('id', req.params.userId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ enabled });
});
