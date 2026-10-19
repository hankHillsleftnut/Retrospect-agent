-- 133: runs can say they were started by a "material arrived" event (F3.2),
-- so F3.3 can measure how much still falls through to the daily crons.
-- Widens the allowed values; every existing row stays valid.
ALTER TABLE pipeline_run_traces DROP CONSTRAINT IF EXISTS pipeline_run_traces_triggered_by_check;
ALTER TABLE pipeline_run_traces ADD CONSTRAINT pipeline_run_traces_triggered_by_check
  CHECK (triggered_by IN ('manual', 'cron', 'http', 'cli', 'replay', 'event'));
