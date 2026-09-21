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

healthRouter.get('/ready', async (_req, res) => {
  const requiredTables = ['integration_jobs', 'integration_credentials', 'entities', 'entity_resolution_candidates', 'assertions', 'assertion_evidence', 'assertion_relations'];
  const checks = await Promise.all(requiredTables.map(async (table) => {
    const { error } = await supabase.from(table).select('id', { head: true }).limit(1);
    return { table, ready: !error, error: error?.message ?? null };
  }));
  const { count: deadLetters } = await supabase
    .from('integration_jobs')
    .select('id', { head: true, count: 'exact' })
    .eq('status', 'dead_letter');
  const ready = checks.every((check) => check.ready);
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks,
    deadLetters: deadLetters ?? 0,
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get('/metrics', async (_req, res) => {
  const statuses = ['queued', 'leased', 'running', 'completed', 'dead_letter'] as const;
  const counts = await Promise.all(statuses.map(async (status) => {
    const { count } = await supabase.from('integration_jobs').select('id', { head: true, count: 'exact' }).eq('status', status);
    return [status, count ?? 0] as const;
  }));
  res.type('text/plain').send([
    '# HELP retrospect_integration_jobs Integration jobs by status',
    '# TYPE retrospect_integration_jobs gauge',
    ...counts.map(([status, count]) => `retrospect_integration_jobs{status="${status}"} ${count}`),
  ].join('\n'));
});
