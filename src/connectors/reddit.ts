import type { IntegrationSourceItemInput } from '../types';
import type { ConnectorContext, IntegrationConnector } from './connector';
import { oauthJson } from './oauth-http';

interface RedditListing { data?: { after?: string | null; children?: { kind: string; data: Record<string, unknown> }[] } }

function after(context: ConnectorContext, key: string): string {
  return typeof context.cursor[key] === 'string' ? context.cursor[key] as string : '';
}

async function listing(context: ConnectorContext, path: string, cursorKey: string): Promise<RedditListing> {
  const url = new URL(`https://oauth.reddit.com${path}`);
  url.searchParams.set('limit', '100');
  if (after(context, cursorKey)) url.searchParams.set('after', after(context, cursorKey));
  return oauthJson<RedditListing>(context, url.toString());
}

function contentItems(value: RedditListing, relationship: string): IntegrationSourceItemInput[] {
  return (value.data?.children ?? []).map(({ kind, data }) => {
    const id = String(data.name ?? data.id);
    const title = String(data.title ?? data.link_title ?? data.body ?? 'Reddit item');
    const body = String(data.selftext ?? data.body ?? '');
    const occurredAt = typeof data.created_utc === 'number' ? new Date(data.created_utc * 1000).toISOString() : undefined;
    const payload = { ...data, reddit_kind: kind, relationship };
    return {
      providerObjectType: kind === 't1' ? `${relationship}_comment` : `${relationship}_post`,
      providerObjectId: id,
      payload,
      canonicalType: relationship === 'submitted' || relationship === 'commented' ? 'communication' : 'saved_interest',
      canonicalText: `${title}\n\n${body}`.trim(),
      normalizedData: payload,
      occurredAt,
      parserVersion: 'reddit-api-v2',
      normalizerVersion: `reddit-${relationship}-v1`,
      contentType: 'reddit',
      metadata: { source: 'reddit', relationship, subreddit: data.subreddit ?? null },
    };
  });
}

function subscriptionItems(value: RedditListing): IntegrationSourceItemInput[] {
  return (value.data?.children ?? []).map(({ data }) => {
    const id = String(data.name ?? data.id ?? data.display_name);
    const title = String(data.display_name_prefixed ?? data.display_name ?? 'Subreddit');
    const description = String(data.public_description ?? data.description ?? '');
    const payload = { ...data, relationship: 'subscribed' };
    return {
      providerObjectType: 'subreddit_subscription',
      providerObjectId: id,
      payload,
      canonicalType: 'media_interest',
      canonicalText: `Subscribed to ${title}.\n${description}`.trim(),
      normalizedData: payload,
      parserVersion: 'reddit-api-v2',
      normalizerVersion: 'reddit-subscription-v1',
      contentType: 'reddit',
      metadata: { source: 'reddit', relationship: 'subscribed', subreddit: data.display_name ?? null },
    };
  });
}

export const redditConnector: IntegrationConnector = {
  providerId: 'reddit',
  async sync(context) {
    const [saved, submitted, comments, subscriptions] = await Promise.all([
      listing(context, '/user/me/saved', 'savedAfter'),
      listing(context, '/user/me/submitted', 'submittedAfter'),
      listing(context, '/user/me/comments', 'commentsAfter'),
      listing(context, '/subreddits/mine/subscriber', 'subscriptionsAfter'),
    ]);
    return {
      cursorAfter: {
        savedAfter: saved.data?.after ?? '',
        submittedAfter: submitted.data?.after ?? '',
        commentsAfter: comments.data?.after ?? '',
        subscriptionsAfter: subscriptions.data?.after ?? '',
        completedAt: new Date().toISOString(),
      },
      items: [
        ...contentItems(saved, 'saved'),
        ...contentItems(submitted, 'submitted'),
        ...contentItems(comments, 'commented'),
        ...subscriptionItems(subscriptions),
      ],
    };
  },
};
