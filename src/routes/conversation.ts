import { Router } from 'express';
import { supabase } from '../db/supabase';
import { converse, WORKING_MEMORY_HOURS } from '../conversation/reply';

/** Talking to it bit by bit (goal 18). */
export const conversationRouter = Router();

/** POST /conversation { userId, text } -- a reply, which may be empty: saying nothing is allowed. */
conversationRouter.post('/', async (req, res) => {
  const { userId, text } = req.body ?? {};
  if (!userId || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'userId and text required' });
  try { const { usage, ...r } = await converse(userId, text.trim()); void usage; return res.json(r); }
  catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

/** GET /conversation/:userId/today -- the day so far, so the app shows one continuous thread. */
conversationRouter.get('/:userId/today', async (req, res) => {
  const since = new Date(Date.now() - WORKING_MEMORY_HOURS * 3600e3).toISOString();
  const { data, error } = await supabase.from('conversation_turns').select('role,text,created_at').eq('user_id', req.params.userId).gte('created_at', since).order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ turns: data ?? [] });
});
