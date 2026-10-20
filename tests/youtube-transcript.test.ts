/** R1: a saved YouTube video is read by what is said in it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTranscript, youtubeVideoUrl } from '../src/reference/youtube-transcript';

test('every kind of YouTube link becomes one watch URL; others are not videos', () => {
  for (const u of ['https://www.youtube.com/watch?v=abc123XYZ&t=40', 'https://youtu.be/abc123XYZ?si=x', 'https://m.youtube.com/watch?v=abc123XYZ', 'https://youtube.com/shorts/abc123XYZ']) {
    assert.equal(youtubeVideoUrl(u), 'https://www.youtube.com/watch?v=abc123XYZ', u);
  }
  assert.equal(youtubeVideoUrl('https://www.youtube.com/@channel'), null);
  assert.equal(youtubeVideoUrl('https://example.com/watch?v=abc123XYZ'), null);
});

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test('no key: nothing is fetched', async () => {
  let called = false;
  assert.equal(await fetchTranscript('https://www.youtube.com/watch?v=abc123XYZ', { key: '', fetcher: (async () => { called = true; return res(200, {}); }) as typeof fetch }), null);
  assert.equal(called, false);
});

test('captions come back as text; no captions or a private video is null', async () => {
  assert.equal(await fetchTranscript('u', { key: 'k', fetcher: (async () => res(200, { content: 'hello there', lang: 'en' })) as typeof fetch }), 'hello there');
  assert.equal(await fetchTranscript('u', { key: 'k', fetcher: (async () => res(206, {})) as typeof fetch }), null);
  assert.equal(await fetchTranscript('u', { key: 'k', fetcher: (async () => res(404, {})) as typeof fetch }), null);
});

test('a long video is a job, waited on until it completes', async () => {
  const replies = [res(202, { jobId: 'j1' }), res(200, { status: 'active' }), res(200, { status: 'completed', content: 'the whole talk' })];
  const r = await fetchTranscript('u', { key: 'k', fetcher: (async () => replies.shift()!) as typeof fetch, sleep: async () => {} });
  assert.equal(r, 'the whole talk');
});
