import { Router } from 'express';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

export const preferencesRouter = Router();

preferencesRouter.get('/:userId', async (req, res) => {
  const { data, error } = await supabase
    .from(Tables.USER_PREFERENCES)
    .select('*')
    .eq('user_id', req.params.userId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ preferences: data ?? null });
});

preferencesRouter.put('/:userId', async (req, res) => {
  const { tone, trusted_voice_description, focus_areas, avoid_topics, directives } = req.body ?? {};
  const userId = req.params.userId;

  const { data: existing } = await supabase
    .from(Tables.USER_PREFERENCES)
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  const row = {
    user_id: userId,
    tone: tone ?? null,
    trusted_voice_description: trusted_voice_description ?? null,
    focus_areas: focus_areas ?? [],
    avoid_topics: avoid_topics ?? [],
    directives: directives ?? [],
  };

  if (existing) {
    const { data, error } = await supabase
      .from(Tables.USER_PREFERENCES)
      .update(row)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ preferences: data });
  } else {
    const { data, error } = await supabase
      .from(Tables.USER_PREFERENCES)
      .insert(row)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ preferences: data });
  }
});
