import { readFileSync } from 'node:fs';
import type { ClientConfig } from 'pg';

/**
 * TLS for a direct Postgres connection (db:migrate, staging or production):
 * always verified against Supabase's CA certificate (dashboard → Database
 * settings → SSL configuration → download), named by DATABASE_CA_CERT.
 * Supabase signs database certificates with its own root, so the system store
 * can't verify them, and an unverified connection could be intercepted along
 * with every migration it carries. There is no unverified mode.
 */
export function databaseTls(env: NodeJS.ProcessEnv, read: (path: string) => string = (p) => readFileSync(p, 'utf8')) {
  const path = env.DATABASE_CA_CERT;
  if (!path) throw new Error('DATABASE_CA_CERT is not set: point it at the Supabase CA certificate');
  return { ca: read(path), rejectUnauthorized: true };
}

/** The pg client settings db:migrate connects with, in every mode. */
export function migrationClientConfig(url: string, env: NodeJS.ProcessEnv, read?: (path: string) => string): ClientConfig {
  return { connectionString: url, ssl: databaseTls(env, read) };
}
