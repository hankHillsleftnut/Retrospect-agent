import type { IntegrationSourceItemInput } from '../types';
import type { ConnectorContext, IntegrationConnector } from './connector';
import { oauthJson } from './oauth-http';

interface XUser {
  id: string;
  name?: string;
  username?: string;
  description?: string;
  location?: string;
  verified?: boolean;
  created_at?: string;
  public_metrics?: Record<string, unknown>;
  url?: string;
}

interface XPost {
  id: string;
  text?: string;
  note_tweet?: { text?: string };
  created_at?: string;
  lang?: string;
  public_metrics?: Record<string, unknown>;
  context_annotations?: unknown[];
  entities?: Record<string, unknown>;
  referenced_tweets?: unknown[];
}

interface XUserResponse { data?: XUser }
interface XPage<T> { data?: T[]; meta?: { next_token?: string; result_count?: number } }

const userFields = 'created_at,description,location,profile_image_url,public_metrics,url,verified';
const tweetFields = 'created_at,public_metrics,context_annotations,entities,lang,referenced_tweets,note_tweet';

function nextToken(context: ConnectorContext, key: string): string {
  return typeof context.cursor[key] === 'string' ? context.cursor[key] as string : '';
}

async function xPage<T>(context: ConnectorContext, path: string, params: Record<string, string>, cursorKey?: string): Promise<XPage<T>> {
  const url = new URL(`https://api.x.com/2${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (cursorKey && nextToken(context, cursorKey)) url.searchParams.set('pagination_token', nextToken(context, cursorKey));
  return oauthJson<XPage<T>>(context, url.toString());
}

async function optionalXPage<T>(
  context: ConnectorContext,
  path: string,
  params: Record<string, string>,
  cursorKey: string,
  label: string
): Promise<{ page: XPage<T>; error?: string }> {
  try {
    return { page: await xPage<T>(context, path, params, cursorKey) };
  } catch (error) {
    return {
      page: {},
      error: error instanceof Error ? error.message : `${label} sync failed`,
    };
  }
}

function postText(post: XPost): string {
  return post.note_tweet?.text ?? post.text ?? '';
}

function postItems(page: XPage<XPost>, relationship: 'authored' | 'liked' | 'bookmarked'): IntegrationSourceItemInput[] {
  return (page.data ?? []).map((post) => {
    const text = postText(post);
    const payload = { ...post, relationship, text };
    return {
      providerObjectType: `${relationship}_post`,
      providerObjectId: post.id,
      payload,
      canonicalType: relationship === 'authored' ? 'social_post' : 'written_interest',
      canonicalText: `X ${relationship} post: ${text}`.trim(),
      normalizedData: payload,
      occurredAt: post.created_at,
      providerCreatedAt: post.created_at,
      parserVersion: 'x-api-v1',
      normalizerVersion: `x-${relationship}-post-v1`,
      contentType: 'x',
      metadata: {
        source: 'x',
        relationship,
        signal_class: relationship === 'authored' ? 'written_expression' : 'written_interest',
      },
    };
  }).filter((item) => Boolean(item.providerObjectId && item.canonicalText));
}

function followingItems(page: XPage<XUser>): IntegrationSourceItemInput[] {
  return (page.data ?? []).map((user) => {
    const payload = { ...user, relationship: 'following' };
    return {
      providerObjectType: 'following_user',
      providerObjectId: user.id,
      payload,
      canonicalType: 'written_interest',
      canonicalText: [
        `Follows @${user.username ?? user.id} on X`,
        user.name ? `Name: ${user.name}` : '',
        user.description ?? '',
      ].filter(Boolean).join('\n').trim(),
      normalizedData: payload,
      providerCreatedAt: user.created_at,
      parserVersion: 'x-api-v1',
      normalizerVersion: 'x-following-v1',
      contentType: 'x',
      metadata: {
        source: 'x',
        relationship: 'following',
        signal_class: 'written_interest_network',
      },
    };
  });
}

function coverageGapItem(providerObjectId: string, label: string, error: string): IntegrationSourceItemInput {
  const payload = {
    label,
    error,
    relationship: 'coverage_gap',
    occurred_at: new Date().toISOString(),
  };
  return {
    providerObjectType: 'coverage_gap',
    providerObjectId,
    payload,
    canonicalType: 'connector_coverage',
    canonicalText: `X coverage gap: ${label}. ${error}`,
    normalizedData: payload,
    analysisEligible: false,
    parserVersion: 'x-api-v1',
    normalizerVersion: 'x-coverage-gap-v1',
    contentType: 'x',
    metadata: { source: 'x', relationship: 'coverage_gap', label },
  };
}

export const xConnector: IntegrationConnector = {
  providerId: 'x',
  async sync(context) {
    const meUrl = new URL('https://api.x.com/2/users/me');
    meUrl.searchParams.set('user.fields', userFields);
    const me = await oauthJson<XUserResponse>(context, meUrl.toString());
    const user = me.data;
    if (!user?.id) throw new Error('X profile response did not include a user id');

    const profilePayload = { ...user, relationship: 'authenticated_profile' };
    const profileItem: IntegrationSourceItemInput = {
      providerObjectType: 'profile',
      providerObjectId: user.id,
      payload: profilePayload,
      canonicalType: 'social_profile',
      canonicalText: [
        `X profile: @${user.username ?? user.id}`,
        user.name ? `Name: ${user.name}` : '',
        user.description ?? '',
        user.location ? `Location: ${user.location}` : '',
      ].filter(Boolean).join('\n').trim(),
      normalizedData: profilePayload,
      providerCreatedAt: user.created_at,
      parserVersion: 'x-api-v1',
      normalizerVersion: 'x-profile-v1',
      contentType: 'x',
      metadata: { source: 'x', relationship: 'authenticated_profile', signal_class: 'written_identity' },
    };

    const [authored, liked, bookmarked, following] = await Promise.all([
      xPage<XPost>(context, `/users/${user.id}/tweets`, { max_results: '100', 'tweet.fields': tweetFields }, 'authoredNextToken'),
      optionalXPage<XPost>(context, `/users/${user.id}/liked_tweets`, { max_results: '100', 'tweet.fields': tweetFields }, 'likedNextToken', 'liked posts'),
      optionalXPage<XPost>(context, `/users/${user.id}/bookmarks`, { max_results: '100', 'tweet.fields': tweetFields }, 'bookmarksNextToken', 'bookmarks'),
      optionalXPage<XUser>(context, `/users/${user.id}/following`, { max_results: '100', 'user.fields': userFields }, 'followingNextToken', 'following'),
    ]);

    const coverageGaps = [
      liked.error ? coverageGapItem('liked-posts', 'liked posts', liked.error) : null,
      bookmarked.error ? coverageGapItem('bookmarks', 'bookmarks', bookmarked.error) : null,
      following.error ? coverageGapItem('following', 'following', following.error) : null,
    ].filter((item): item is IntegrationSourceItemInput => Boolean(item));

    return {
      cursorAfter: {
        userId: user.id,
        authoredNextToken: authored.meta?.next_token ?? '',
        likedNextToken: liked.page.meta?.next_token ?? '',
        bookmarksNextToken: bookmarked.page.meta?.next_token ?? '',
        followingNextToken: following.page.meta?.next_token ?? '',
        completedAt: new Date().toISOString(),
      },
      items: [
        profileItem,
        ...postItems(authored, 'authored'),
        ...postItems(liked.page, 'liked'),
        ...postItems(bookmarked.page, 'bookmarked'),
        ...followingItems(following.page),
        ...coverageGaps,
      ],
    };
  },
};
