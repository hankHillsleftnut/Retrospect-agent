import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonBlock } from '../src/services/anthropic';

test('a plain JSON reply is returned as is', () => {
  assert.equal(extractJsonBlock('{"a":1}'), '{"a":1}');
});

test('when the model corrects itself, its final answer is used -- not a merge', () => {
  const reply = '{"answers":[{"question":6}]}\n\nWait -- I must return all five. Corrected full output:\n\n{"answers":[{"question":6},{"question":7}]}';
  assert.deepEqual(JSON.parse(extractJsonBlock(reply)).answers.length, 2);
});

test('braces inside strings do not confuse it', () => {
  assert.deepEqual(JSON.parse(extractJsonBlock('Here: {"q":"a } in text { here"} done')), { q: 'a } in text { here' });
});

test('a truncated final object falls back to the last complete one', () => {
  assert.deepEqual(JSON.parse(extractJsonBlock('{"x":1} then {"x":2, "y": [1,')), { x: 1 });
});

test('no JSON at all is still an error', () => {
  assert.throws(() => extractJsonBlock('I could not do that.'), /No JSON object/);
});
