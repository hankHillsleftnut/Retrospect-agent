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

/**
 * Connection-string parameters that change TLS. pg parses the connection
 * string and lays it OVER the explicit `ssl` object, so `?sslmode=no-verify`,
 * `?sslmode=disable` or `?ssl=0` would quietly turn verification (or TLS) off.
 */
export const TLS_URL_PARAMS = ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslnegotiation', 'uselibpqcompat'] as const;

/** The pg client settings db:migrate connects with, in every mode. */
export function migrationClientConfig(url: string, env: NodeJS.ProcessEnv, read?: (path: string) => string): ClientConfig {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    // Never echo the URL: it carries the password.
    throw new Error('DATABASE_URL is not a valid postgres:// URL');
  }
  const named = [...params.keys()].map((k) => k.toLowerCase()).filter((k) => (TLS_URL_PARAMS as readonly string[]).includes(k));
  if (named.length) {
    throw new Error(
      `DATABASE_URL sets ${[...new Set(named)].join(', ')}: remove it. TLS is always verified against DATABASE_CA_CERT, and a URL parameter would override that.`,
    );
  }
  return { connectionString: url, ssl: databaseTls(env, read) };
}
