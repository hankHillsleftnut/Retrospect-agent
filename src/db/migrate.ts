/**
 * Applying migrations: one command instead of pasting SQL by hand.
 *
 * Every migration so far has been applied by hand, which is how production
 * came to lack users.voice_persona for months without anyone knowing. This
 * records what has been applied, in the database itself, and applies only
 * what has not -- each migration in its own transaction, so one that fails
 * leaves nothing half-done and stops the run.
 *
 * Pure planning plus a runner over a minimal executor, so it is tested against
 * real Postgres (PGlite) without a network. scripts/migrate.ts connects it to
 * production.
 */

export const LEDGER_TABLE = 'schema_migrations';

export const LEDGER_SQL = `
  CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
    file        TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 'applied' by this tool, or 'baseline' when recorded as already present
    -- from the hand-applied era, without running it.
    how         TEXT NOT NULL CHECK (how IN ('applied', 'baseline'))
  );
  REVOKE ALL ON ${LEDGER_TABLE} FROM PUBLIC;
`;

/** Runs SQL. A transaction is opened and closed by the runner. */
export interface Executor {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface Plan {
  alreadyRecorded: string[];
  /** Recorded as present without running (only with a baseline). */
  toBaseline: string[];
  toApply: string[];
}

/**
 * What would happen. `baselineThrough` marks every migration up to and
 * including that file as already present -- used once, to adopt a database
 * whose earlier migrations were applied by hand.
 */
/**
 * Narrow a plan to one pending migration, so each change can be approved on its
 * own (19 October 2026: 128 was pre-approved as additive while 127, which
 * replaces a function, still waited for the founder). Baselining is not mixed in.
 */
export function only(p: Plan, file: string): Plan {
  if (!p.toApply.includes(file)) {
    throw new Error(p.alreadyRecorded.includes(file) ? `${file} is already applied` : `${file} is not a pending migration`);
  }
  return { alreadyRecorded: p.alreadyRecorded, toBaseline: [], toApply: [file] };
}

export function plan(files: string[], recorded: Set<string>, baselineThrough?: string): Plan {
  const sorted = [...files].sort();
  if (baselineThrough && !sorted.includes(baselineThrough)) {
    throw new Error(`baseline ${baselineThrough} is not a migration file`);
  }
  const out: Plan = { alreadyRecorded: [], toBaseline: [], toApply: [] };
  for (const f of sorted) {
    if (recorded.has(f)) out.alreadyRecorded.push(f);
    else if (baselineThrough && f <= baselineThrough) out.toBaseline.push(f);
    else out.toApply.push(f);
  }
  return out;
}

/**
 * What the database records as applied. With `create: false` (a preview) this
 * only reads: a database with no ledger yet simply has nothing recorded.
 */
export async function recordedMigrations(db: Executor, opts: { create?: boolean } = { create: true }): Promise<Set<string>> {
  if (opts.create) {
    await db.query(LEDGER_SQL);
  } else {
    const { rows: exists } = await db.query(`SELECT to_regclass('public.${LEDGER_TABLE}') IS NOT NULL AS present`);
    if (!exists[0]?.present) return new Set();
  }
  const { rows } = await db.query(`SELECT file FROM ${LEDGER_TABLE}`);
  return new Set(rows.map((r) => r.file as string));
}

export interface ApplyResult {
  baselined: string[];
  applied: string[];
  failed?: { file: string; error: string };
}

/**
 * Carry out a plan. Stops at the first failure: later migrations may depend on
 * it, and a clean stop with a clear error beats a cascade.
 */
export async function applyPlan(db: Executor, p: Plan, readSql: (file: string) => string): Promise<ApplyResult> {
  const result: ApplyResult = { baselined: [], applied: [] };
  for (const file of p.toBaseline) {
    await db.query(`INSERT INTO ${LEDGER_TABLE} (file, how) VALUES ($1, 'baseline') ON CONFLICT (file) DO NOTHING`, [file]);
    result.baselined.push(file);
  }
  for (const file of p.toApply) {
    try {
      await db.query('BEGIN');
      await db.query(readSql(file));
      await db.query(`INSERT INTO ${LEDGER_TABLE} (file, how) VALUES ($1, 'applied')`, [file]);
      await db.query('COMMIT');
      result.applied.push(file);
    } catch (err) {
      await db.query('ROLLBACK').catch(() => undefined);
      result.failed = { file, error: (err as Error).message.split('\n')[0]! };
      break;
    }
  }
  return result;
}
