import { Router } from 'express';
import { supabase } from '../db/supabase';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const { error } = await supabase.from('users').select('id').limit(1);
  res.json({
    status: error ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    db: error ? error.message : 'reachable',
  });
});
