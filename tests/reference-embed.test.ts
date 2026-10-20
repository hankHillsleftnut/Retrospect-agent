/** R1.5: saved links get a meaning vector from what they are and why they were kept. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedText } from '../src/reference/embed';

test('the vector text carries the title, summary and the reason', () => {
  const t = savedText({ title: 'Cold exposure protocol', summary: 'Dose and timing.', intent: 'maybe try it', url: 'https://x.test' });
  assert.match(t, /Cold exposure protocol\nDose and timing\.\nSaved because: maybe try it\nhttps:\/\/x\.test/);
  assert.equal(savedText({ title: null, summary: null, intent: null, url: 'https://x.test' }), 'https://x.test');
});
