import type { IntegrationConnector } from './connector';
import { oauthJson, stripHtml } from './oauth-http';

interface MessageList { messages?: { id: string; threadId: string }[]; nextPageToken?: string }
interface Part { headers?: { name: string; value: string }[] }
interface Message { id: string; threadId: string; internalDate?: string; labelIds?: string[]; payload?: Part; snippet?: string }

function header(part: Part | undefined, name: string): string {
  return part?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}
export const gmailConnector: IntegrationConnector = {
  providerId: 'gmail',
  async sync(context) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('maxResults', '25');
    if (typeof context.cursor.pageToken === 'string' && context.cursor.pageToken) url.searchParams.set('pageToken', context.cursor.pageToken);
    const list = await oauthJson<MessageList>(context, url.toString());
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
        metadata: { source: 'gmail', thread_id: message.threadId, subject },
      });
    }
    return { cursorAfter: { pageToken: list.nextPageToken ?? '', completedAt: new Date().toISOString() }, items };
  },
};
