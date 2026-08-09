import type { IntegrationSourceItemInput } from '../types';
import type { ConnectorContext, IntegrationConnector } from './connector';
import { oauthJson } from './oauth-http';

interface TikTokUser {
  open_id?: string;
  union_id?: string;
  avatar_url?: string;
  display_name?: string;
  bio_description?: string;
  profile_deep_link?: string;
  is_verified?: boolean;
  follower_count?: number;
  following_count?: number;
  likes_count?: number;
  video_count?: number;
}

interface TikTokUserInfoResponse {
  data?: { user?: TikTokUser };
  error?: { code?: string; message?: string; log_id?: string };
}

interface TikTokVideo {
  id?: string;
  create_time?: number;
  cover_image_url?: string;
  share_url?: string;
  video_description?: string;
  duration?: number;
  height?: number;
  width?: number;
  title?: string;
  embed_link?: string;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
}

interface TikTokVideoListResponse {
  data?: {
    videos?: TikTokVideo[];
    cursor?: number;
    has_more?: boolean;
  };
  error?: { code?: string; message?: string; log_id?: string };
}

const userFields = [
  'open_id',
  'union_id',
  'avatar_url',
  'display_name',
  'bio_description',
  'profile_deep_link',
  'is_verified',
  'follower_count',
  'following_count',
  'likes_count',
  'video_count',
].join(',');

const videoFields = [
  'id',
  'create_time',
  'cover_image_url',
  'share_url',
  'video_description',
  'duration',
  'height',
  'width',
  'title',
  'embed_link',
  'like_count',
  'comment_count',
  'share_count',
  'view_count',
].join(',');

function assertTikTokOk(response: TikTokUserInfoResponse | TikTokVideoListResponse, label: string): void {
  const code = response.error?.code;
  if (code && code !== 'ok') {
    throw new Error(`TikTok ${label} failed: ${response.error?.message ?? code}`);
  }
}

function cursorValue(context: ConnectorContext): number | undefined {
  const value = context.cursor.videoCursor;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function videoOccurredAt(video: TikTokVideo): string | undefined {
  return typeof video.create_time === 'number' ? new Date(video.create_time * 1000).toISOString() : undefined;
}

function videoItems(page: TikTokVideoListResponse): IntegrationSourceItemInput[] {
  return (page.data?.videos ?? []).map((video) => {
    const id = video.id ?? '';
    const title = video.title ?? video.video_description ?? 'TikTok video';
    const payload = { ...video, relationship: 'published_video' };
    return {
      providerObjectType: 'published_video',
      providerObjectId: id,
      payload,
      canonicalType: 'short_form_media_interest',
      canonicalText: [
        `TikTok published video: ${title}`,
        video.video_description ?? '',
        typeof video.view_count === 'number' ? `Views: ${video.view_count}` : '',
        typeof video.like_count === 'number' ? `Likes: ${video.like_count}` : '',
      ].filter(Boolean).join('\n').trim(),
      normalizedData: payload,
      occurredAt: videoOccurredAt(video),
      providerCreatedAt: videoOccurredAt(video),
      parserVersion: 'tiktok-display-api-v1',
      normalizerVersion: 'tiktok-published-video-v1',
      contentType: 'tiktok',
      metadata: {
        source: 'tiktok',
        relationship: 'published_video',
        signal_class: 'short_form_expression',
      },
    };
  }).filter((item) => Boolean(item.providerObjectId));
}

export const tiktokConnector: IntegrationConnector = {
  providerId: 'tiktok',
  async sync(context) {
    const userUrl = new URL('https://open.tiktokapis.com/v2/user/info/');
    userUrl.searchParams.set('fields', userFields);
    const profileResponse = await oauthJson<TikTokUserInfoResponse>(context, userUrl.toString());
    assertTikTokOk(profileResponse, 'profile sync');

    const profile = profileResponse.data?.user;
    if (!profile?.open_id) throw new Error('TikTok profile response did not include an open_id');

    const videoUrl = new URL('https://open.tiktokapis.com/v2/video/list/');
    videoUrl.searchParams.set('fields', videoFields);
    const videoCursor = cursorValue(context);
    const videoResponse = await oauthJson<TikTokVideoListResponse>(context, videoUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_count: 20,
        ...(typeof videoCursor === 'number' ? { cursor: videoCursor } : {}),
      }),
    });
    assertTikTokOk(videoResponse, 'video sync');

    const profilePayload = { ...profile, relationship: 'authenticated_profile' };
    const profileItem: IntegrationSourceItemInput = {
      providerObjectType: 'profile',
      providerObjectId: profile.open_id,
      payload: profilePayload,
      canonicalType: 'social_profile',
      canonicalText: [
        `TikTok profile: ${profile.display_name ?? profile.open_id}`,
        profile.bio_description ?? '',
        typeof profile.follower_count === 'number' ? `Followers: ${profile.follower_count}` : '',
        typeof profile.following_count === 'number' ? `Following: ${profile.following_count}` : '',
        typeof profile.likes_count === 'number' ? `Profile likes: ${profile.likes_count}` : '',
      ].filter(Boolean).join('\n').trim(),
      normalizedData: profilePayload,
      parserVersion: 'tiktok-display-api-v1',
      normalizerVersion: 'tiktok-profile-v1',
      contentType: 'tiktok',
      metadata: {
        source: 'tiktok',
        relationship: 'authenticated_profile',
        signal_class: 'short_form_identity',
      },
    };

    return {
      cursorAfter: {
        profileSyncedAt: new Date().toISOString(),
        videoCursor: videoResponse.data?.has_more ? videoResponse.data.cursor ?? '' : '',
        videoHasMore: Boolean(videoResponse.data?.has_more),
      },
      items: [profileItem, ...videoItems(videoResponse)],
    };
  },
};
