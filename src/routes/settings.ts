import { Router } from 'express';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { masterOff } from '../ambient/switch';
import { LEVELS, readAppetite, setStatedAppetite, type Level } from '../appetite/appetite';
import { readLearning } from '../learning/reception';

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

/** GET /settings/:userId/appetite -- how boldly it thinks it may speak, why, and the choices (goal 22: visible). */
settingsRouter.get('/:userId/appetite', async (req, res) => {
  try { return res.json({ ...(await readAppetite(req.params.userId)), levels: LEVELS }); }
  catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

/** PUT /settings/:userId/appetite { level: 0-3 | null } -- their choice outranks inference; null hands back to it. */
settingsRouter.put('/:userId/appetite', async (req, res) => {
  const level = req.body?.level;
  if (!(level === null || [0, 1, 2, 3].includes(level))) return res.status(400).json({ error: 'level 0-3, or null' });
  try { return res.json({ ...(await setStatedAppetite(req.params.userId, level as Level | null)), levels: LEVELS }); }
  catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

/** GET /settings/:userId/learning -- what it has learned about its own questions, and the last five snapshots (goal 19: visible). */
settingsRouter.get('/:userId/learning', async (req, res) => {
  try { return res.json({ ...(await readLearning(req.params.userId)), inUse: process.env.ENABLE_LEARNING === 'true' }); }
  catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});
