/**
 * Google Calendar, read-only.
 *
 * A member of the combined Google sign-in (backend oauth-providers.ts,
 * GOOGLE_COMBINED_MEMBERS): one consent screen, then a connection per product,
 * each synced by its own connector -- this one for calendar.
 *
 * Phase 4.1 (brief-phase-4-calendar.md): six of the 36 questions are answered
 * mainly from a calendar -- a normal week, what you reliably do and skip, when
 * you're at your best, what changed, who you spend time with.
 *
 * What it reads is chosen for those questions and no more: title, time, place,
 * attendees, busy/free, whether it recurs. It deliberately does NOT keep event
 * descriptions (often private notes, and no question needs them) or video-call
 * links.
 *
 * First sync: 90 days back to 30 days ahead, per calendar. After that, only
 * changes, using Google's per-calendar sync token. A cancelled event is reported
 * as deleted. A sync token Google has expired (HTTP 410) restarts that calendar
 * from the window.
 */

import type { IntegrationSourceItemInput } from '../types';
import type { ConnectorContext, IntegrationConnector } from './connector';
import { oauthJson } from './oauth-http';

interface CalendarListEntry { id: string; summary?: string; primary?: boolean; accessRole?: string; selected?: boolean }
interface CalendarList { items?: CalendarListEntry[]; nextPageToken?: string }
interface EventTime { dateTime?: string; date?: string; timeZone?: string }
interface Attendee { email?: string; displayName?: string; self?: boolean; organizer?: boolean; responseStatus?: string; resource?: boolean }
interface CalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  start?: EventTime;
  end?: EventTime;
  attendees?: Attendee[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  transparency?: string;
  recurringEventId?: string;
  created?: string;
  updated?: string;
  eventType?: string;
}
interface EventPage { items?: CalendarEvent[]; nextPageToken?: string; nextSyncToken?: string }

export const CALENDAR_WINDOW = { daysBack: 90, daysAhead: 30 };
/** Event pages read per calendar per sync; the rest continues next sync. */
export const MAX_PAGES_PER_CALENDAR = 4;

type FetchJson = <T>(context: ConnectorContext, url: string) => Promise<T>;

interface CalendarCursor {
  [calendarId: string]: { syncToken?: string; pageToken?: string };
}

const API = 'https://www.googleapis.com/calendar/v3';

function when(t?: EventTime): string | undefined {
  return t?.dateTime ?? (t?.date ? `${t.date}T00:00:00Z` : undefined);
}

/** The item stored for one event. Exported for tests. */
export function eventItem(calendar: CalendarListEntry, event: CalendarEvent): IntegrationSourceItemInput {
  const people = (event.attendees ?? [])
    .filter((a) => !a.self && !a.resource)
    .map((a) => ({ name: a.displayName ?? null, email: a.email ?? null, response: a.responseStatus ?? null }));
  const self = (event.attendees ?? []).find((a) => a.self);
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const payload = {
    event_id: event.id,
    calendar_id: calendar.id,
    calendar_title: calendar.summary ?? null,
    title: event.summary ?? '(No title)',
    start: when(event.start) ?? null,
    end: when(event.end) ?? null,
    all_day: allDay,
    location: event.location ?? null,
    attendees: people,
    attendee_count: people.length,
    my_response: self?.responseStatus ?? null,
    organizer_is_me: Boolean(event.organizer?.self),
    busy: event.transparency !== 'transparent',
    recurring: Boolean(event.recurringEventId),
    event_type: event.eventType ?? 'default',
  };
  const withWhom = people.map((p) => p.name ?? p.email).filter(Boolean).slice(0, 12).join(', ');
  return {
    providerObjectType: 'calendar_event',
    providerObjectId: `${calendar.id}:${event.id}`,
    payload,
    canonicalType: 'calendar_event',
    canonicalText: [
      `Calendar event: ${payload.title}`,
      `When: ${payload.start ?? '?'}${payload.end ? ` to ${payload.end}` : ''}${allDay ? ' (all day)' : ''}`,
      withWhom ? `With: ${withWhom}` : null,
      payload.location ? `Where: ${payload.location}` : null,
      payload.my_response ? `My response: ${payload.my_response}` : null,
      payload.recurring ? 'Repeats' : null,
      `Calendar: ${payload.calendar_title ?? calendar.id}`,
    ].filter(Boolean).join('\n'),
    normalizedData: { ...payload, day: (payload.start ?? '').slice(0, 10) },
    occurredAt: payload.start ?? undefined,
    providerCreatedAt: event.created,
    providerUpdatedAt: event.updated,
    parserVersion: 'google-calendar-v3',
    normalizerVersion: 'calendar-event-v1',
    contentType: 'calendar',
    metadata: { source: 'google_calendar', calendar_id: calendar.id, calendar_title: calendar.summary ?? null },
  };
}

export function createGoogleCalendarConnector(fetchJson: FetchJson = oauthJson, now: () => Date = () => new Date()): IntegrationConnector {
  return {
    providerId: 'google_calendar',
    async sync(context) {
      const cursor = { ...((context.cursor.calendars ?? {}) as CalendarCursor) };
      const items: IntegrationSourceItemInput[] = [];
      const deleted: string[] = [];

      // Every calendar the person can read, including shared ones they've selected.
      const calendars: CalendarListEntry[] = [];
      let listToken: string | undefined;
      do {
        const url = new URL(`${API}/users/me/calendarList`);
        url.searchParams.set('minAccessRole', 'reader');
        if (listToken) url.searchParams.set('pageToken', listToken);
        const page = await fetchJson<CalendarList>(context, url.toString());
        calendars.push(...(page.items ?? []).filter((c) => c.selected !== false || c.primary));
        listToken = page.nextPageToken;
      } while (listToken);

      for (const calendar of calendars) {
        const state = cursor[calendar.id] ?? {};
        let pageToken = state.pageToken;
        let syncToken = state.syncToken;
        for (let pages = 0; pages < MAX_PAGES_PER_CALENDAR; pages++) {
          const url = new URL(`${API}/calendars/${encodeURIComponent(calendar.id)}/events`);
          url.searchParams.set('singleEvents', 'true');
          url.searchParams.set('maxResults', '250');
          url.searchParams.set('showDeleted', 'true');
          if (pageToken) url.searchParams.set('pageToken', pageToken);
          if (syncToken && !pageToken) url.searchParams.set('syncToken', syncToken);
          if (!syncToken && !pageToken) {
            url.searchParams.set('timeMin', new Date(now().getTime() - CALENDAR_WINDOW.daysBack * 864e5).toISOString());
            url.searchParams.set('timeMax', new Date(now().getTime() + CALENDAR_WINDOW.daysAhead * 864e5).toISOString());
          }
          let page: EventPage;
          try {
            page = await fetchJson<EventPage>(context, url.toString());
          } catch (err) {
            // 410 Gone: Google expired the sync token. Start this calendar over.
            if (/\b410\b/.test(String((err as Error).message)) && syncToken) {
              syncToken = undefined; pageToken = undefined; pages -= 1;
              continue;
            }
            throw err;
          }
          for (const event of page.items ?? []) {
            if (event.status === 'cancelled') deleted.push(`${calendar.id}:${event.id}`);
            else items.push(eventItem(calendar, event));
          }
          if (page.nextPageToken) { pageToken = page.nextPageToken; continue; }
          pageToken = undefined;
          if (page.nextSyncToken) syncToken = page.nextSyncToken;
          break;
        }
        cursor[calendar.id] = { ...(syncToken ? { syncToken } : {}), ...(pageToken ? { pageToken } : {}) };
      }

      return {
        cursorAfter: { calendars: cursor, completedAt: now().toISOString() },
        items,
        deletedProviderObjectIds: deleted,
      };
    },
  };
}

export const googleCalendarConnector = createGoogleCalendarConnector();
