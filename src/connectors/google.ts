/**
 * One Google sign-in, all of the person's Google data.
 *
 * Founder's direction: Google sources should be "all from all google data (cal,
 * email, docs, everything)", with Google Calendar "part of the Google
 * integration" (18 October 2026). One connection runs each Google connector in
 * turn under the same sign-in, each keeping its own cursor, so a person grants
 * access once instead of once per product.
 *
 * The single-product providers (google_docs, gmail) stay registered, so
 * existing connections keep working.
 */

import type { ConnectorResult, IntegrationConnector } from './connector';
import { googleDocsConnector } from './google-docs';
import { gmailConnector } from './gmail';
import { googleCalendarConnector } from './google-calendar';

export const GOOGLE_PARTS: IntegrationConnector[] = [googleDocsConnector, gmailConnector, googleCalendarConnector];

export function createGoogleConnector(parts: IntegrationConnector[] = GOOGLE_PARTS): IntegrationConnector {
  return {
    providerId: 'google',
    async sync(context) {
      const cursors = (context.cursor.parts ?? {}) as Record<string, Record<string, unknown>>;
      const nextCursors: Record<string, Record<string, unknown>> = {};
      const result: ConnectorResult = { cursorAfter: {}, items: [], deletedProviderObjectIds: [] };
      const failures: Record<string, string> = {};
      for (const part of parts) {
        try {
          const r = await part.sync({ ...context, cursor: cursors[part.providerId] ?? {} });
          nextCursors[part.providerId] = r.cursorAfter;
          result.items.push(...r.items);
          result.deletedProviderObjectIds!.push(...(r.deletedProviderObjectIds ?? []));
        } catch (err) {
          // One Google product failing (a permission not granted, an API
          // outage) must not stop the others; it keeps its old cursor and is
          // retried next sync.
          nextCursors[part.providerId] = cursors[part.providerId] ?? {};
          failures[part.providerId] = (err as Error).message.slice(0, 300);
        }
      }
      if (Object.keys(failures).length === parts.length) {
        throw new Error(`every Google part failed: ${JSON.stringify(failures)}`);
      }
      result.cursorAfter = { parts: nextCursors, failures, completedAt: new Date().toISOString() };
      return result;
    },
  };
}

export const googleConnector = createGoogleConnector();
