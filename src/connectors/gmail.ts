import type { IntegrationConnector } from './connector';
import { oauthJson, stripHtml } from './oauth-http';

interface MessageList { messages?: { id: string; threadId: string }[]; nextPageToken?: string }
interface Part { headers?: { name: string; value: string }[] }
interface Message { id: string; threadId: string; internalDate?: string; labelIds?: string[]; payload?: Part; snippet?: string }

function header(part: Part | undefined, name: string): string {
  return part?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}
/**
 * Real conversations and what they sent -- not marketing. The first sync on the
 * founder's account (19 October 2026) was 25 messages of promotions,
 * newsletters and an overdue-library notice, each read into facts at a cost,
 * crowding out the calendar when questions about people were researched.
 * Gmail's own categories do the sorting.
 */
export const GMAIL_QUERY = '-category:promotions -category:social -category:updates -category:forums -in:spam -in:trash';

/** A page token belongs to the search that produced it; a cursor from a
 *  different search (e.g. before GMAIL_QUERY existed) starts again. */
export function pageTokenFor(cursor: Record<string, unknown>): string | undefined {
  return cursor.query === GMAIL_QUERY && typeof cursor.pageToken === 'string' && cursor.pageToken ? cursor.pageToken : undefined;
}

export function gmailListUrl(pageToken?: unknown): string {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  url.searchParams.set('maxResults', '25');
  url.searchParams.set('q', GMAIL_QUERY);
  if (typeof pageToken === 'string' && pageToken) url.searchParams.set('pageToken', pageToken);
  return url.toString();
}

export const gmailConnector: IntegrationConnector = {
  providerId: 'gmail',
  async sync(context) {
    const list = await oauthJson<MessageList>(context, gmailListUrl(pageTokenFor(context.cursor)));
    const items = [];
    for (const summary of list.messages ?? []) {
      const messageUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${summary.id}`);
      messageUrl.searchParams.set('format', 'metadata');
      for (const metadataHeader of ['Subject', 'From', 'To', 'Cc', 'Reply-To', 'Date']) {
        messageUrl.searchParams.append('metadataHeaders', metadataHeader);
      }
      const message = await oauthJson<Message>(context, messageUrl.toString());
      const subject = header(message.payload, 'Subject') || '(No subject)';
      const from = header(message.payload, 'From');
      const to = header(message.payload, 'To');
      const cc = header(message.payload, 'Cc');
      const replyTo = header(message.payload, 'Reply-To');
      const providerDate = header(message.payload, 'Date');
      const snippet = stripHtml(message.snippet ?? '');
      const occurredAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined;
      const payload = {
        message_id: message.id,
        thread_id: message.threadId,
        subject,
        from,
        to,
        cc,
        reply_to: replyTo,
        provider_date: providerDate,
        snippet,
        labels: message.labelIds ?? [],
        body_fetched: false,
        attachments_fetched: false,
      };
      items.push({
        providerObjectType: 'email_message',
        providerObjectId: message.id,
        payload,
        canonicalType: 'communication',
        canonicalText: `Email: ${subject}\nFrom: ${from}\nTo: ${to}${cc ? `\nCc: ${cc}` : ''}${replyTo ? `\nReply-To: ${replyTo}` : ''}${snippet ? `\nSnippet: ${snippet}` : ''}`,
        normalizedData: payload,
        occurredAt,
        parserVersion: 'gmail-api-v2',
        normalizerVersion: 'email-message-v2',
        contentType: 'gmail',
        // labels and sender let the trust classifier tell sent mail, people and machines apart.
        metadata: { source: 'gmail', thread_id: message.threadId, subject, labels: message.labelIds ?? [], from },
      });
    }
    return { cursorAfter: { query: GMAIL_QUERY, pageToken: list.nextPageToken ?? '', completedAt: new Date().toISOString() }, items };
  },
};
