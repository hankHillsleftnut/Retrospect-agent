import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gmailListUrl, GMAIL_QUERY, pageTokenFor } from '../src/connectors/gmail';

test('Gmail is asked for real conversations and sent mail, not marketing', () => {
  const q = new URL(gmailListUrl()).searchParams.get('q') ?? '';
  for (const left of ['category:promotions', 'category:social', 'category:updates', 'category:forums', 'in:spam', 'in:trash']) {
    assert.ok(q.includes(`-${left}`), `leaves out ${left}`);
  }
  assert.equal(q, GMAIL_QUERY);
});

test('paging carries on where the last sync stopped', () => {
  const url = new URL(gmailListUrl('next-page'));
  assert.equal(url.searchParams.get('pageToken'), 'next-page');
  assert.equal(url.searchParams.get('maxResults'), '25');
});

test('no page token on the first sync', () => {
  assert.equal(new URL(gmailListUrl('')).searchParams.has('pageToken'), false);
});

test('a page token from an older, unfiltered search is not reused', () => {
  assert.equal(pageTokenFor({ pageToken: 'old-token' }), undefined);
  assert.equal(pageTokenFor({ pageToken: 'tok', query: 'something else' }), undefined);
  assert.equal(pageTokenFor({ pageToken: 'tok', query: GMAIL_QUERY }), 'tok');
});
