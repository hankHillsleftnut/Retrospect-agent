/**
 * A real Postgres, built from this repo's migrations, for tests.
 *
 * Every migration in this project has been applied to production by hand. Until
 * 18 October 2026 not one of them had ever been executed anywhere first, and it
 * turned out the history could not be replayed from scratch at all. This builds
 * a database the way production got its own -- base schema, then every numbered
 * migration in order -- in PGlite: genuine Postgres compiled to WebAssembly, so
 * it runs in-process with no server, locally and in CI.
 *
 * Shared by every test that needs real SQL behaviour: constraints, unique
 * indexes, triggers, functions. A test that can only pass against a mock of the
 * database cannot tell you whether the SQL works.
 */
// Resolved as ESM to match the dynamic import below. Without the attribute,
// TypeScript resolves this as CommonJS and sees a *different* PGlite type to the
// one the import returns -- identical in shape, incompatible in identity.
import type { PGlite } from '@electric-sql/pglite' with { 'resolution-mode': 'import' };
import { readdirSync, readFileSync } from 'node:fs';

export type { PGlite };
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');
const BASE_SCHEMA = join(__dirname, '..', 'fixtures', 'base-schema.sql');

/**
 * The parts of Supabase the migrations assume exist. These are provided by the
 * platform in production and are not what is under test, so they are stubbed to
 * the minimum the migrations touch.
 */
const SUPABASE_ENVIRONMENT = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE IF NOT EXISTS storage.buckets (
    id text PRIMARY KEY, name text, public boolean, owner uuid,
    file_size_limit bigint, allowed_mime_types text[], avif_autodetection boolean,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text,
    owner uuid, metadata jsonb, created_at timestamptz DEFAULT now()
  );
`;

/** Numbered migrations in this repo, in the order they were applied. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
}

export interface MigrationResult {
  file: string;
  ok: boolean;
  error?: string;
}

/**
 * Build a database from scratch. Returns it along with what happened to each
 * migration, so a test can assert on the replay itself as well as use the result.
 *
 * A failed migration does not stop the replay: later ones still run, and the
 * report says exactly which failed and why. That is more useful than stopping at
 * the first error, because one bad migration usually explains several that
 * follow it.
 */
export async function freshDatabase(): Promise<{ db: PGlite; results: MigrationResult[] }> {
  // Loaded dynamically: this repo compiles to CommonJS, and PGlite's extension
  // modules are ESM-only. A static import runs under tsx but fails the
  // typecheck that CI performs; a dynamic import is valid in both.
  const { PGlite } = await import('@electric-sql/pglite');
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp');
  const { vector } = await import('@electric-sql/pglite-pgvector');
  const db = new PGlite({ extensions: { uuid_ossp, vector } });
  await db.exec(SUPABASE_ENVIRONMENT);

  const results: MigrationResult[] = [];
  const apply = async (file: string, sql: string) => {
    try {
      await db.exec(sql);
      results.push({ file, ok: true });
    } catch (e) {
      results.push({ file, ok: false, error: String((e as Error).message).split('\n')[0] });
    }
  };

  await apply('base-schema.sql', readFileSync(BASE_SCHEMA, 'utf8'));
  for (const file of migrationFiles()) {
    await apply(file, readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return { db, results };
}

/** Insert a user, since almost every table references one. Returns its id. */
export async function insertUser(db: PGlite, email = `u-${Math.random().toString(36).slice(2)}@test`): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, apple_user_id) VALUES ($1, $2) RETURNING id`,
    [email, `apple-${email}`],
  );
  return rows[0]!.id;
}
