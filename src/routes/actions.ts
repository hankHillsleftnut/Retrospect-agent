import { Router } from 'express';
import { supabase } from '../db/supabase';
import { ACTION_CLASSES, approveAction, rejectAction, undoAction, runApproved } from '../actions/ledger';

/** Goal 17 for the app: see what it is about to do, approve it, reject it, undo it. */
export const actionsRouter = Router();

/** GET /actions/:userId -- the ledger, newest first, with what each class can do. */
actionsRouter.get('/:userId', async (req, res) => {
  const { data, error } = await supabase.from('actions').select('id,action_class,preview,status,approved_by,result,created_at,status_at').eq('user_id', req.params.userId).order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ actions: data ?? [], classes: ACTION_CLASSES });
});

/** POST /actions/:userId/:id { decision: "approve" | "reject" | "undo" } */
actionsRouter.post('/:userId/:id', async (req, res) => {
  const d = req.body?.decision;
  const fn = d === 'approve' ? approveAction : d === 'reject' ? rejectAction : d === 'undo' ? undoAction : null;
  if (!fn) return res.status(400).json({ error: 'decision "approve", "reject" or "undo"' });
  try {
    const ok = await fn(req.params.userId, req.params.id);
    if (!ok) return res.status(409).json({ error: `can't ${d} it from its current state` });
    if (d === 'approve') await runApproved(req.params.userId);
    return res.json({ ok: true });
  } catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});
