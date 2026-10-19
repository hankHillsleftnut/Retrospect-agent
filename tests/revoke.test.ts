import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revokeAccountGrants, type RevokeDeps } from '../src/integrations/revoke';

/** On account deletion, every Google grant is revoked once; other providers and failures don't stop it. */

function deps(connections: Array<{ id: string; provider_id: string }>, creds: Record<string, Record<string, unknown> | Error>, revokeOk = true) {
  const revokedTokens: string[] = [];
  const d: RevokeDeps = {
    listConnections: async () => connections,
    loadCredentials: async (_u, id) => { const c = creds[id]; if (c instanceof Error) throw c; return c ?? {}; },
    revokeGoogleToken: async (t) => { revokedTokens.push(t); return revokeOk; },
  };
  return { d, revokedTokens };
}

test('one Google grant behind four connections is revoked once', async () => {
  const conns = ['google_docs', 'gmail', 'youtube', 'google_calendar'].map((p, i) => ({ id: `c${i}`, provider_id: p }));
  const same = { refresh_token: 'rt-1', access_token: 'at' };
  const { d, revokedTokens } = deps(conns, { c0: same, c1: same, c2: same, c3: same });
  const r = await revokeAccountGrants('u', d);
  assert.deepEqual(revokedTokens, ['rt-1']);
  assert.deepEqual(r, { revoked: 1, failed: 0 });
});

test('the refresh token is revoked in preference to the short-lived access token', async () => {
  const { d, revokedTokens } = deps([{ id: 'c', provider_id: 'gmail' }], { c: { refresh_token: 'rt', access_token: 'at' } });
  await revokeAccountGrants('u', d);
  assert.deepEqual(revokedTokens, ['rt']);
});

test('non-Google connections are left to their own deletion', async () => {
  const { d, revokedTokens } = deps([{ id: 's', provider_id: 'spotify' }], { s: { refresh_token: 'x' } });
  assert.deepEqual(await revokeAccountGrants('u', d), { revoked: 0, failed: 0 });
  assert.deepEqual(revokedTokens, []);
});

test('a missing credential or a refusal is counted, and the rest still go', async () => {
  const { d } = deps(
    [{ id: 'a', provider_id: 'gmail' }, { id: 'b', provider_id: 'youtube' }],
    { a: new Error('no credential'), b: { refresh_token: 'rt-b' } },
  );
  assert.deepEqual(await revokeAccountGrants('u', d), { revoked: 1, failed: 1 });
});
