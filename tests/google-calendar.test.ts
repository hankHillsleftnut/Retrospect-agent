import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleCalendarConnector, eventItem } from '../src/connectors/google-calendar';

const ctx = (cursor: Record<string, unknown> = {}) => ({ userId: 'u', connectionId: 'c', providerId: 'google_calendar', cursor, payload: {} });
const NOW = new Date('2026-10-18T12:00:00Z');

function fakeGoogle(pages: Record<string, unknown>, opts: { expire?: boolean } = {}) {
  const calls: string[] = [];
  const fetchJson = async <T>(_c: unknown, url: string): Promise<T> => {
    calls.push(url);
    if (url.includes('/calendarList')) return { items: [{ id: 'primary@x', summary: 'Me', primary: true }] } as T;
    if (opts.expire && url.includes('syncToken=')) throw new Error('Google API 410 Gone');
    return pages[url.includes('syncToken=') ? 'incremental' : 'initial'] as T;
  };
  return { calls, connector: createGoogleCalendarConnector(fetchJson as any, () => NOW) };
}

const standup = {
  id: 'e1', summary: 'Design standup', start: { dateTime: '2026-10-15T16:00:00Z' }, end: { dateTime: '2026-10-15T16:30:00Z' },
  description: 'PRIVATE NOTES: feeling burnt out, talk to Wendy about leaving',
  attendees: [{ email: 'me@x', self: true, responseStatus: 'accepted' }, { email: 'wendy@x', displayName: 'Wendy' }, { email: 'room@x', resource: true }],
  recurringEventId: 'r1', hangoutLink: 'https://meet.google.com/abc',
};

test('keeps what the questions need, never the private description or call link', () => {
  const item = eventItem({ id: 'primary@x', summary: 'Me' }, standup);
  const all = JSON.stringify(item);
  assert.equal(all.includes('PRIVATE NOTES'), false, 'description never stored');
  assert.equal(all.includes('meet.google.com'), false, 'call link never stored');
  assert.deepEqual((item.payload as any).attendees, [{ name: 'Wendy', email: 'wendy@x', response: null }], 'other people, not me or the room');
  assert.equal((item.payload as any).recurring, true);
  assert.match(item.canonicalText, /With: Wendy/);
  assert.equal(item.contentType, 'calendar');
});

test('first sync reads the 90-days-back / 30-ahead window, then only changes', async () => {
  const { calls, connector } = fakeGoogle({
    initial: { items: [standup], nextSyncToken: 'tok1' },
    incremental: { items: [{ id: 'e1', status: 'cancelled' }], nextSyncToken: 'tok2' },
  });
  const first = await connector.sync(ctx());
  assert.match(calls[1]!, /timeMin=2026-07-20/);
  assert.match(calls[1]!, /timeMax=2026-11-17/);
  assert.equal(first.items.length, 1);

  const second = await connector.sync(ctx(first.cursorAfter));
  assert.match(calls.at(-1)!, /syncToken=tok1/);
  assert.equal(calls.at(-1)!.includes('timeMin'), false);
  assert.deepEqual(second.deletedProviderObjectIds, ['primary@x:e1'], 'a cancelled event is removed');
  assert.equal((second.cursorAfter as any).calendars['primary@x'].syncToken, 'tok2');
});

test('an expired sync token restarts that calendar from the window', async () => {
  const { calls, connector } = fakeGoogle({ initial: { items: [standup], nextSyncToken: 'fresh' } }, { expire: true });
  const r = await connector.sync(ctx({ calendars: { 'primary@x': { syncToken: 'stale' } } }));
  assert.ok(calls.some((u) => u.includes('timeMin')), 'restarted from the window');
  assert.equal(r.items.length, 1);
  assert.equal((r.cursorAfter as any).calendars['primary@x'].syncToken, 'fresh');
});
