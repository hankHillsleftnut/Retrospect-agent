import { config } from '../config';
import { loadIntegrationCredentials, storeIntegrationCredentials } from '../services/credential-vault';
import type { ConnectorContext } from './connector';

interface ProviderRefreshConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  basicAuth?: boolean;
  clientIdParam?: string;
  clientSecretParam?: string;
}

const refreshConfigs: Record<string, ProviderRefreshConfig> = {
  google_docs: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: config.integrations.googleClientId,
    clientSecret: config.integrations.googleClientSecret,
  },
  gmail: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: config.integrations.googleClientId,
    clientSecret: config.integrations.googleClientSecret,
  },
  youtube: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: config.integrations.googleClientId,
    clientSecret: config.integrations.googleClientSecret,
  },
  spotify: {
    tokenUrl: 'https://accounts.spotify.com/api/token',
    clientId: config.integrations.spotifyClientId,
    clientSecret: config.integrations.spotifyClientSecret,
    basicAuth: true,
  },
  reddit: {
    tokenUrl: 'https://www.reddit.com/api/v1/access_token',
    clientId: config.integrations.redditClientId,
    clientSecret: config.integrations.redditClientSecret,
    basicAuth: true,
  },
  pinterest: {
    tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
    clientId: config.integrations.pinterestClientId,
    clientSecret: config.integrations.pinterestClientSecret,
    basicAuth: true,
  },
  tiktok: {
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    clientId: config.integrations.tiktokClientKey,
    clientSecret: config.integrations.tiktokClientSecret,
    clientIdParam: 'client_key',
  },
  linkedin: {
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientId: config.integrations.linkedinClientId,
    clientSecret: config.integrations.linkedinClientSecret,
  },
  x: {
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    clientId: config.integrations.xClientId,
    clientSecret: config.integrations.xClientSecret,
    basicAuth: true,
  },
};

async function refreshCredentials(context: ConnectorContext, credentials: Record<string, unknown>) {
  const provider = refreshConfigs[context.providerId];
  const refreshToken = typeof credentials.refresh_token === 'string' ? credentials.refresh_token : '';
  if (!provider || !refreshToken || !provider.clientId || !provider.clientSecret) {
    throw new Error(`${context.providerId} credentials expired and cannot be refreshed`);
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  if (provider.basicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString('base64')}`;
  } else {
    params.set(provider.clientIdParam ?? 'client_id', provider.clientId);
    params.set(provider.clientSecretParam ?? 'client_secret', provider.clientSecret);
  }
  const response = await fetch(provider.tokenUrl, { method: 'POST', headers, body: params });
  const refreshed = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`${context.providerId} token refresh failed (${response.status})`);
  const merged = { ...credentials, ...refreshed, refresh_token: refreshed.refresh_token ?? refreshToken };
  const expiresIn = typeof refreshed.expires_in === 'number' ? refreshed.expires_in : null;
  await storeIntegrationCredentials({
    userId: context.userId,
    connectionId: context.connectionId,
    credentials: merged,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
  });
  return merged;
}

export async function oauthJson<T>(
  context: ConnectorContext,
  url: string,
  init: RequestInit = {}
): Promise<T> {
  let credentials = await loadIntegrationCredentials(context.userId, context.connectionId);
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = typeof credentials.access_token === 'string' ? credentials.access_token : '';
    if (!token) throw new Error(`${context.providerId} credentials do not contain an access token`);
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Retrospect/1.0',
        ...(init.headers ?? {}),
      },
    });
    if (response.status === 401 && attempt === 0) {
      credentials = await refreshCredentials(context, credentials);
      continue;
    }
    if (response.status === 429) throw new Error(`${context.providerId} rate limited the sync`);
    if (!response.ok) throw new Error(`${context.providerId} API request failed (${response.status})`);
    return await response.json() as T;
  }
  throw new Error(`${context.providerId} authorization failed`);
}

export function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
