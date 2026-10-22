import { Router } from 'express';
import { supabase } from '../db/supabase';
import { converse as converseEngine, WORKING_MEMORY_HOURS } from '../conversation/reply';
import { checkDailySpend, spendLimitedBody } from '../pipelines/spend-guard';
import { recordSpend } from '../pipelines/spend-ledger';

/** Talking to it bit by bit (goal 18). */
export interface ConversationDeps {
  converse: typeof converseEngine;
  checkSpend: typeof checkDailySpend;
  recordSpend: typeof recordSpend;
}

export function makeConversationRouter(deps: Partial<ConversationDeps> = {}): Router {
  const d: ConversationDeps = { converse: converseEngine, checkSpend: checkDailySpend, recordSpend, ...deps };
  const router = Router();

  /** POST /conversation { userId, text } -- a reply, which may be empty: saying nothing is allowed. */
  router.post('/', async (req, res) => {
    const { userId, text } = req.body ?? {};
    if (!userId || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'userId and text required' });
    try {
      // The cap comes first: over it, no model is called (BEA.4).
      const spend = await d.checkSpend(userId);
      if (!spend.allowed) return res.status(429).json(spendLimitedBody(spend));
      const { usage, cost, ...r } = await d.converse(userId, text.trim());
      void usage;
      await d.recordSpend(userId, 'conversation', cost);
      return res.json(r);
    } catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  /** GET /conversation/:userId/today -- the day so far, so the app shows one continuous thread. */
  router.get('/:userId/today', async (req, res) => {
    const since = new Date(Date.now() - WORKING_MEMORY_HOURS * 3600e3).toISOString();
    const { data, error } = await supabase.from('conversation_turns').select('role,text,created_at').eq('user_id', req.params.userId).gte('created_at', since).order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ turns: data ?? [] });
  });

  return router;
}

export const conversationRouter = makeConversationRouter();
