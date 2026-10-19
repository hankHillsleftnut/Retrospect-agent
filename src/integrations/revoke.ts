/**
 * Revoke the OAuth grants a person gave, when they delete their account.
 *
 * The backend deletes the account; only the agent can read the encrypted tokens,
 * so it asks here first. Google's grant is one token behind every Google
 * connection (Docs, Gmail, YouTube, Calendar); revoking it once ends all of
 * them. Best effort: the account is deleted either way.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { loadIntegrationCredentials } from '../services/credential-vault';

const GOOGLE_PROVIDERS = new Set(['google', 'google_docs', 'gmail', 'youtube', 'google_calendar']);

export interface RevokeDeps {
  listConnections: (userId: string) => Promise<Array<{ id: string; provider_id: string }>>;
  loadCredentials: (userId: string, connectionId: string) => Promise<Record<string, unknown>>;
  revokeGoogleToken: (token: string) => Promise<boolean>;
}

export const defaultRevokeDeps: RevokeDeps = {
  listConnections: async (userId) => {
    const { data, error } = await supabase.from(Tables.INTEGRATION_CONNECTIONS)
      .select('id,provider_id').eq('user_id', userId).eq('collection_mode', 'oauth_api');
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{ id: string; provider_id: string }>;
  },
  loadCredentials: loadIntegrationCredentials,
  revokeGoogleToken: async (token) => {
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    // 400 "invalid_token" means it was already revoked or expired: nothing left to end.
    return res.ok || res.status === 400;
  },
};

export async function revokeAccountGrants(userId: string, deps: RevokeDeps = defaultRevokeDeps): Promise<{ revoked: number; failed: number }> {
  const connections = await deps.listConnections(userId);
  const done = new Set<string>();
  let revoked = 0;
  let failed = 0;
  for (const c of connections.filter((x) => GOOGLE_PROVIDERS.has(x.provider_id))) {
    try {
      const creds = await deps.loadCredentials(userId, c.id);
      const token = String(creds.refresh_token ?? creds.access_token ?? '');
      if (!token || done.has(token)) continue;
      done.add(token);
      if (await deps.revokeGoogleToken(token)) revoked += 1;
      else failed += 1;
    } catch {
      failed += 1; // no stored credential, or a vault error -- keep going
    }
  }
  return { revoked, failed };
}
