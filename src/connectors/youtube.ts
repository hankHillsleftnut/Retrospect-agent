import type { IntegrationSourceItemInput } from '../types';
import type { ConnectorContext, IntegrationConnector } from './connector';
import { oauthJson } from './oauth-http';

interface YouTubeSnippet {
  title?: string;
  description?: string;
  publishedAt?: string;
  channelTitle?: string;
  resourceId?: { channelId?: string; videoId?: string };
}
interface YouTubePage {
  nextPageToken?: string;
  items?: { id: string | { videoId?: string }; snippet?: YouTubeSnippet; contentDetails?: Record<string, unknown> }[];
}

function pageToken(context: ConnectorContext, key: string): string {
  return typeof context.cursor[key] === 'string' ? context.cursor[key] as string : '';
}

async function youtubePage(context: ConnectorContext, endpoint: string, params: Record<string, string>, cursorKey: string): Promise<YouTubePage> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (pageToken(context, cursorKey)) url.searchParams.set('pageToken', pageToken(context, cursorKey));
  return oauthJson<YouTubePage>(context, url.toString());
}

function itemId(item: YouTubePage['items'] extends (infer T)[] | undefined ? T : never): string {
  if (!item) return '';
  return typeof item.id === 'string' ? item.id : item.id.videoId ?? '';
}

function normalize(page: YouTubePage, relationship: string, objectType: string): IntegrationSourceItemInput[] {
  return (page.items ?? []).map((item) => {
    const id = itemId(item);
    const title = item.snippet?.title ?? 'YouTube item';
    const description = item.snippet?.description ?? '';
    const payload = {
      id,
      title,
      description,
      relationship,
      channel_title: item.snippet?.channelTitle ?? '',
      channel_id: item.snippet?.resourceId?.channelId ?? '',
      video_id: item.snippet?.resourceId?.videoId ?? (objectType === 'liked_video' ? id : ''),
      content_details: item.contentDetails ?? {},
    };
    return {
      providerObjectType: objectType,
      providerObjectId: id,
      payload,
      canonicalType: 'media_interest',
      canonicalText: `${relationship.replace(/_/g, ' ')}: ${title}\n${description}`.trim(),
      normalizedData: payload,
      occurredAt: item.snippet?.publishedAt,
      parserVersion: 'youtube-api-v2',
      normalizerVersion: `youtube-${objectType}-v1`,
      contentType: 'youtube',
      metadata: { source: 'youtube', relationship, channel_id: payload.channel_id, video_id: payload.video_id },
    };
  }).filter((item) => Boolean(item.providerObjectId));
}

export const youtubeConnector: IntegrationConnector = {
  providerId: 'youtube',
  async sync(context) {
    const [subscriptions, playlists, likes] = await Promise.all([
      youtubePage(context, 'subscriptions', { part: 'snippet', mine: 'true', maxResults: '50' }, 'subscriptionsPageToken'),
      youtubePage(context, 'playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: '50' }, 'playlistsPageToken'),
      youtubePage(context, 'videos', { part: 'snippet,contentDetails', myRating: 'like', maxResults: '50' }, 'likesPageToken'),
    ]);
    return {
      cursorAfter: {
        subscriptionsPageToken: subscriptions.nextPageToken ?? '',
        playlistsPageToken: playlists.nextPageToken ?? '',
        likesPageToken: likes.nextPageToken ?? '',
        completedAt: new Date().toISOString(),
      },
      items: [
        ...normalize(subscriptions, 'subscribed_to', 'subscription'),
        ...normalize(playlists, 'created_playlist', 'playlist'),
        ...normalize(likes, 'liked_video', 'liked_video'),
      ],
    };
  },
};
