/**
 * Delete everything: the brain's half of deleting an account (BE0.6).
 *
 * The backend deletes the person's `users` row, and every table that holds
 * their data cascades from it (tests/user-delete-cascade.test.ts). Two things
 * a row delete never reaches: the OAuth grants they gave a provider, and the
 * files in storage. This does both, before the backend deletes the row.
 *
 * Rules:
 * - Grants go through the one revoke engine (integrations/revoke.ts). A grant
 *   that could not be revoked is counted in `grantsFailed`, never hidden, and
 *   never stops the file step.
 * - Files: every prefix is built from the person's id. A listed name is only
 *   ever appended to that prefix, and a name that could leave it is refused.
 *   Listings are read 1,000 at a time until a page comes back empty.
 * - Idempotent: a second call finds nothing left and reports zeros, `ok: true`.
 *   A grant this sweep revoked is marked on its connection, so it is not counted
 *   again; one that failed is tried again.
 * - No row is deleted here.
 * - Logs carry counts and the person's id only: never a path, a name, a token
 *   or a storage error message (those can carry paths).
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { revokeAccountGrants, defaultRevokeDeps, type RevokeDeps } from '../integrations/revoke';
import { AUDIO_BUCKET } from '../services/audio-storage';
import { BRIEF_AUDIO_BUCKET } from '../briefs/brief-audio';

/** Storage's page size: `list()` returns at most this many entries. */
export const PAGE = 1000;
/** A listing that never ends is a broken listing, not a person with a billion files. */
const MAX_PAGES = 1000;
/** How deep a person's folders may go before the sweep stops and reports it. */
const MAX_DEPTH = 4;
/** Sweep a prefix again after removing, until it lists empty; more passes than this is a failure. */
const MAX_PASSES = 3;

export const IMPORTS_BUCKET = 'integration-imports';
export const MEDIA_BUCKET = 'integration-media';
export const EVIDENCE_BUCKET = 'integration-evidence';

/** The prefixes a person's files live under, built from their id alone. */
export function personPrefixes(userId: string): Array<{ bucket: string; prefix: string }> {
  return [
    { bucket: AUDIO_BUCKET, prefix: `podcasts/${userId}` },
    { bucket: BRIEF_AUDIO_BUCKET, prefix: userId },
    { bucket: IMPORTS_BUCKET, prefix: userId },
    { bucket: MEDIA_BUCKET, prefix: userId },
    { bucket: EVIDENCE_BUCKET, prefix: userId },
  ];
}

/** The part of a storage bucket this uses (supabase-js `storage.from(bucket)`). */
export interface SweepBucket {
  list(
    prefix: string,
    options: { limit: number; offset: number; sortBy: { column: string; order: string } },
  ): Promise<{ data: Array<{ name: string; id: string | null }> | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
}

export interface DeleteEverythingDeps {
  db: Pick<typeof supabase, 'from'>;
  storage: (bucket: string) => SweepBucket;
  /** The revoke engine's provider calls. Its connection listing is replaced here (unrevoked only). */
  revoke: Pick<RevokeDeps, 'loadCredentials' | 'revokeGoogleToken'>;
  now: () => Date;
  log: (line: string) => void;
}

export const defaultDeleteDeps = (): DeleteEverythingDeps => ({
  db: supabase,
  storage: (bucket) => supabase.storage.from(bucket) as unknown as SweepBucket,
  revoke: defaultRevokeDeps,
  now: () => new Date(),
  log: (line) => console.log(line),
});

export interface DeleteReport {
  grantsRevoked: number;
  grantsFailed: number;
  /** Google connections with no stored credential: no grant exists, so nothing to revoke (not a failure). */
  grantsNothingToRevoke: number;
  objectsDeleted: Record<string, number>;
  /**
   * Rows naming a file this sweep will not touch: a path outside the person's
   * own folder, one that could escape it, or a bucket that is not an
   * integration bucket. Never deleted; their own folders are still swept.
   */
  objectsSkipped: number;
  ok: boolean;
  /** Which steps did not finish ('grants' or a bucket name); empty when ok. */
  failedSteps: string[];
}

class StepFailed extends Error {}

// ── Grants ───────────────────────────────────────────────────────────────────

interface ConnectionRow { id: string; provider_id: string; metadata: Record<string, unknown> | null }

async function revokeGrants(userId: string, deps: DeleteEverythingDeps): Promise<{ revoked: number; failed: number; nothingToRevoke: number }> {
  let connections: ConnectionRow[] = [];
  const tokenOf = new Map<string, string>();
  const revokedTokens = new Set<string>();
  // Connections with no stored credential (a Google connect started, never finished): no grant exists.
  const absent = new Set<string>();
  const engine: RevokeDeps = {
    listConnections: async (u) => {
      const { data, error } = await deps.db.from(Tables.INTEGRATION_CONNECTIONS)
        .select('id,provider_id,metadata').eq('user_id', u).eq('collection_mode', 'oauth_api');
      if (error) throw new StepFailed('connections');
      // A grant this sweep already revoked (or found absent) is not handled, or counted, twice.
      connections = ((data ?? []) as ConnectionRow[]).filter((c) => !c.metadata?.grant_revoked_at && !c.metadata?.grant_absent_at);
      return connections;
    },
    loadCredentials: async (u, connectionId) => {
      // No credential row means nothing to revoke: {} makes the engine skip it instead of
      // failing it on every call forever (which would block the deletion). A vault or
      // database error is still a failure.
      const { data: row, error } = await deps.db.from(Tables.INTEGRATION_CREDENTIALS)
        .select('connection_id').eq('user_id', u).eq('connection_id', connectionId).maybeSingle();
      if (error) throw new StepFailed('credentials');
      if (!row) { absent.add(connectionId); return {}; }
      const creds = await deps.revoke.loadCredentials(u, connectionId);
      const token = String(creds.refresh_token ?? creds.access_token ?? '');
      if (token) tokenOf.set(connectionId, token);
      else absent.add(connectionId);
      return creds;
    },
    revokeGoogleToken: async (token) => {
      const ok = await deps.revoke.revokeGoogleToken(token);
      if (ok) revokedTokens.add(token);
      return ok;
    },
  };
  const result = await revokeAccountGrants(userId, engine);

  // Every connection behind a revoked grant is marked (one Google grant serves several).
  const at = deps.now().toISOString();
  let unmarked = 0;
  for (const c of connections) {
    const token = tokenOf.get(c.id);
    const revoked = token !== undefined && revokedTokens.has(token);
    if (!revoked && !absent.has(c.id)) continue;
    const mark = revoked ? { grant_revoked_at: at } : { grant_absent_at: at };
    const { error } = await deps.db.from(Tables.INTEGRATION_CONNECTIONS)
      .update({ status: 'disconnected', disconnected_at: at, metadata: { ...(c.metadata ?? {}), ...mark } })
      .eq('id', c.id).eq('user_id', userId);
    if (error) unmarked += 1;
  }
  // The grant is gone either way; an unmarked one is only counted again next time.
  if (unmarked) deps.log(`[user-delete] user=${userId} grants unmarked=${unmarked}`);
  return { ...result, nothingToRevoke: absent.size };
}

// ── Files ────────────────────────────────────────────────────────────────────

/** A listed name that stays inside its folder: one segment, not "." or "..". */
const safeName = (name: unknown): name is string =>
  typeof name === 'string' && name.length > 0 && !name.includes('/') && name !== '.' && name !== '..';

/** Every file path under a prefix, read one page of 1,000 at a time until a page is empty. */
async function listUnder(bucket: SweepBucket, prefix: string, depth = 0): Promise<string[]> {
  const files: string[] = [];
  for (let page = 0, offset = 0; ; page += 1) {
    if (page >= MAX_PAGES) throw new StepFailed('too many pages');
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new StepFailed('list');
    const entries = data ?? [];
    if (entries.length === 0) break;
    offset += entries.length;
    for (const entry of entries) {
      if (!safeName(entry.name)) throw new StepFailed('unsafe name');
      const path = `${prefix}/${entry.name}`;
      if (entry.id === null) {
        // A folder: storage lists folders with no id. Its files are still under this person's prefix.
        if (depth >= MAX_DEPTH) throw new StepFailed('too deep');
        files.push(...(await listUnder(bucket, path, depth + 1)));
      } else {
        files.push(path);
      }
    }
  }
  return files;
}

/**
 * Remove paths 1,000 per call, counting what storage says it removed as it
 * goes (so a step that fails half way still reports what did go).
 */
async function removeAll(bucket: SweepBucket, paths: string[], counted: (n: number) => void): Promise<void> {
  for (let i = 0; i < paths.length; i += PAGE) {
    const { data, error } = await bucket.remove(paths.slice(i, i + PAGE));
    if (error) throw new StepFailed('remove');
    counted((data ?? []).length);
  }
}

async function sweepPrefix(bucket: SweepBucket, prefix: string, counted: (n: number) => void): Promise<void> {
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const paths = await listUnder(bucket, prefix);
    if (paths.length === 0) return;
    await removeAll(bucket, paths, counted);
  }
  // Still not empty after removing: storage refused quietly, or files keep arriving.
  throw new StepFailed('not empty');
}

/** Buckets a row may name. Every upload door writes `<userId>/<provider>/<id>` there (backend routes/integrations.ts). */
const ROW_BUCKETS = new Set([IMPORTS_BUCKET, MEDIA_BUCKET, EVIDENCE_BUCKET]);

/** A row's path is deleted only when it sits inside this person's own folder and cannot climb out of it. */
export function ownsRowPath(userId: string, bucket: unknown, path: unknown): path is string {
  if (typeof bucket !== 'string' || !ROW_BUCKETS.has(bucket)) return false;
  if (typeof path !== 'string' || !path.startsWith(`${userId}/`)) return false;
  return path.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The person's own rows that name a stored file, read 1,000 at a time. */
async function pathsFromRows(
  deps: DeleteEverythingDeps,
  table: string,
  columns: string,
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await deps.db.from(table).select(columns)
      .eq('user_id', userId).order('id').range(from, from + PAGE - 1);
    if (error) throw new StepFailed('rows');
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

// ── The sweep ────────────────────────────────────────────────────────────────

export async function deleteEverything(rawUserId: string, deps: DeleteEverythingDeps = defaultDeleteDeps()): Promise<DeleteReport> {
  // Postgres accepts a UUID in any case, but every folder is named with the lower-case form
  // (auth ids, `podcasts/<id>`): an id in capitals would list nothing, skip every row and say ok.
  const userId = rawUserId.toLowerCase();
  const failed = new Set<string>();
  const objectsDeleted: Record<string, number> = {};
  for (const { bucket } of personPrefixes(userId)) objectsDeleted[bucket] = 0;
  const add = (bucket: string, n: number) => { objectsDeleted[bucket] = (objectsDeleted[bucket] ?? 0) + n; };
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch {
      failed.add(name);
    }
  };

  // 1. Grants. A failure is counted and reported; the files still go.
  let grantsRevoked = 0;
  let grantsFailed = 0;
  let grantsNothingToRevoke = 0;
  await step('grants', async () => {
    const r = await revokeGrants(userId, deps);
    grantsRevoked = r.revoked;
    grantsFailed = r.failed;
    grantsNothingToRevoke = r.nothingToRevoke;
  });

  // 2. Files the person's rows point at (archives they imported, media of their sources).
  //    The rows are the person's own (filtered by their id), but a stored path is still held to
  //    the person's own folder: one outside it is skipped and counted, never deleted.
  let objectsSkipped = 0;
  await step(IMPORTS_BUCKET, async () => {
    const rows = await pathsFromRows(deps, Tables.INTEGRATION_IMPORTS, 'id,storage_path', userId);
    const paths: string[] = [];
    for (const r of rows) {
      if (ownsRowPath(userId, IMPORTS_BUCKET, r.storage_path)) paths.push(r.storage_path);
      else objectsSkipped += 1;
    }
    await removeAll(deps.storage(IMPORTS_BUCKET), paths, (n) => add(IMPORTS_BUCKET, n));
  });
  let assetRows: Array<Record<string, unknown>> = [];
  await step('source-assets', async () => {
    assetRows = await pathsFromRows(deps, Tables.SOURCE_ASSETS, 'id,storage_bucket,storage_path', userId);
  });
  const byBucket = new Map<string, string[]>();
  for (const r of assetRows) {
    if (!ownsRowPath(userId, r.storage_bucket, r.storage_path)) { objectsSkipped += 1; continue; }
    const bucket = r.storage_bucket as string;
    const list = byBucket.get(bucket) ?? [];
    list.push(r.storage_path);
    byBucket.set(bucket, list);
  }
  for (const [bucket, paths] of byBucket) {
    await step(bucket, () => removeAll(deps.storage(bucket), paths, (n) => add(bucket, n)));
  }

  // 3. Everything under the person's own folders, so nothing a row forgot survives.
  for (const { bucket, prefix } of personPrefixes(userId)) {
    await step(bucket, () => sweepPrefix(deps.storage(bucket), prefix, (n) => add(bucket, n)));
  }

  const failedSteps = [...failed].sort();
  const ok = failedSteps.length === 0 && grantsFailed === 0;
  const total = Object.values(objectsDeleted).reduce((a, b) => a + b, 0);
  deps.log(
    `[user-delete] user=${userId} grantsRevoked=${grantsRevoked} grantsFailed=${grantsFailed} grantsNothingToRevoke=${grantsNothingToRevoke}` +
    ` objects=${total} objectsSkipped=${objectsSkipped} ok=${ok}` +
    (failedSteps.length ? ` failedSteps=${failedSteps.join(',')}` : ''),
  );
  return { grantsRevoked, grantsFailed, grantsNothingToRevoke, objectsDeleted, objectsSkipped, ok, failedSteps };
}
