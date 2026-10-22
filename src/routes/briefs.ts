import { Router } from 'express';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runDailyBrief as runDailyBriefEngine } from '../briefs/run-daily-brief';
import { checkDailySpend, spendLimitedBody } from '../pipelines/spend-guard';

export interface BriefsDeps {
  /** The engine records its own spend (BEA.4), whichever way it is reached: here, the cron, the CLI. */
  runDailyBrief: typeof runDailyBriefEngine;
  checkSpend: typeof checkDailySpend;
}

export function makeBriefsRouter(deps: Partial<BriefsDeps> = {}): Router {
  const d: BriefsDeps = { runDailyBrief: runDailyBriefEngine, checkSpend: checkDailySpend, ...deps };
  const router = Router();

  /** GET /briefs/:userId/latest -- their most recent daily brief, or null. */
  router.get('/:userId/latest', async (req, res) => {
    const { data, error } = await supabase.from(Tables.DAILY_BRIEFS).select('*')
      .eq('user_id', req.params.userId).order('brief_date', { ascending: false }).limit(1).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ brief: data ?? null });
  });

  /**
   * POST /briefs/generate { userId, dryRun? } -- make today's brief now.
   * A dry run still calls the model, so the cap applies to it too; it only skips the save,
   * so it is allowed while the person's brief switch is off (reading the guesses before trusting them).
   */
  router.post('/generate', async (req, res) => {
    const { userId, dryRun } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    try {
      const { data: user, error } = await supabase.from(Tables.USERS).select('daily_brief_enabled').eq('id', userId).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!user) return res.status(404).json({ error: 'user not found' });
      if (!dryRun && !(user as { daily_brief_enabled: boolean }).daily_brief_enabled) {
        return res.status(409).json({ error: 'briefs are off for this person' });
      }
      // The cap comes first: over it, no model is called (BEA.4).
      const spend = await d.checkSpend(userId);
      if (!spend.allowed) return res.status(429).json(spendLimitedBody(spend));
      return res.json(await d.runDailyBrief(userId, { dryRun: !!dryRun }));
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** PUT /briefs/:userId/enabled { enabled } -- the per-person on/off switch (default off). */
  router.put('/:userId/enabled', async (req, res) => {
    const enabled = req.body?.enabled === true;
    const { error } = await supabase.from(Tables.USERS).update({ daily_brief_enabled: enabled }).eq('id', req.params.userId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ enabled });
  });

  return router;
}

export const briefsRouter = makeBriefsRouter();
