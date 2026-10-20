/** Goal 22 first guess: the safety rails are code, not the model. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRails, seedFromWords } from '../src/appetite/seed';

const many = (t: string) => [t, t, t, t];
test('too little to read: 0, whatever the model says', () => assert.equal(applyRails(3, ['one', 'two']).level, 0));
test('a first guess never goes above 2', () => assert.equal(applyRails(3, many('I want to be challenged hard.')).level, 2));
test('distress in their words caps it at 1', () => {
  assert.equal(applyRails(2, [...many('Work is fine.'), 'My dad passed away last month.']).level, 1);
  assert.equal(applyRails(2, many('I have been so exhausted lately.')).level, 1);
});
test('within the rails the model decides', () => assert.equal(applyRails(1, many('Work is fine.')).level, 1));
test('a reply that fails twice starts at 0', async () => {
  const r = await seedFromWords(many('I keep noticing I avoid hard calls.'), { model: async () => { throw new Error('bad json'); } });
  assert.equal(r.level, 0);
});
