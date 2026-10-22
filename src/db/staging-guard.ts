/**
 * What stands between a staging run of `db:migrate` and production.
 *
 * `npm run db:migrate:staging` passes `--staging`, and then:
 *
 * 1. loadStagingEnv: the variables come from `.env.staging` itself, overriding
 *    anything already in the process (an exported production DATABASE_URL, or
 *    the `.env` that `dotenv/config` loaded first). Each variable the run
 *    needs must be in that file; one inherited from elsewhere is refused.
 * 2. The file must say RETROSPECT_ENV=staging.
 * 3. assertOnlyTestUsers: the database itself is checked. Any user who isn't a
 *    `dev-test-user:` account means it isn't staging, whatever the env says.
 * 4. stagingTls: the connection is verified against Supabase's CA certificate
 *    (DATABASE_CA_CERT), never unverified.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import dotenv from 'dotenv';

export const STAGING_REQUIRED = ['RETROSPECT_ENV', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'DATABASE_CA_CERT'] as const;
/** Only accounts the backend's dev route makes start with this; a real Apple subject never does. */
export const TEST_SUBJECT_PREFIX = 'dev-test-user:';

export function loadStagingEnv(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
  read: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): void {
  let parsed: Record<string, string>;
  try {
    parsed = dotenv.parse(read(file));
  } catch {
    throw new Error(`could not read ${basename(file)}; copy .env.staging.example and fill it in`);
  }
  const missing = STAGING_REQUIRED.filter((name) => !parsed[name]);
  if (missing.length) throw new Error(`${basename(file)} is missing: ${missing.join(', ')}`);
  if (parsed.RETROSPECT_ENV !== 'staging') throw new Error('Refusing to run: RETROSPECT_ENV in .env.staging is not "staging".');
  Object.assign(env, parsed);
}

/** Runs SQL; satisfied by pg's Client and by PGlite. */
export interface Executor {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export async function assertOnlyTestUsers(db: Executor): Promise<void> {
  const { rows: exists } = await db.query<{ present: boolean }>(`SELECT to_regclass('public.users') IS NOT NULL AS present`);
  if (!exists[0]?.present) return;
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users WHERE apple_user_id NOT LIKE $1`,
    [`${TEST_SUBJECT_PREFIX}%`],
  );
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) throw new Error(`Refusing to run: this database has ${n} users who are not test accounts, so it is not staging.`);
}

export function stagingTls(env: NodeJS.ProcessEnv, read: (path: string) => string = (p) => readFileSync(p, 'utf8')) {
  const path = env.DATABASE_CA_CERT;
  if (!path) throw new Error('DATABASE_CA_CERT is not set: point it at the Supabase CA certificate');
  return { ca: read(path), rejectUnauthorized: true };
}
