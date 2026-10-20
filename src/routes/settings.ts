import { Router } from 'express';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { masterOff } from '../ambient/switch';

/** Per-person settings the app changes. */
export const settingsRouter = Router();

/** PUT /settings/:userId/ambient { enabled } -- their ambient switch (AMB). The founder's master switch still wins. */
settingsRouter.put('/:userId/ambient', async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled (true/false) required' });
  const { error } = await supabase.from(Tables.USERS).update({ ambient_enabled: req.body.enabled }).eq('id', req.params.userId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ enabled: req.body.enabled, effective: req.body.enabled && !masterOff() });
});

/** GET /settings/:userId/ambient -- what they chose, and what's in effect. */
settingsRouter.get('/:userId/ambient', async (req, res) => {
  const { data, error } = await supabase.from(Tables.USERS).select('ambient_enabled').eq('id', req.params.userId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  const enabled = (data as { ambient_enabled?: boolean } | null)?.ambient_enabled !== false;
  return res.json({ enabled, effective: enabled && !masterOff() });
});
