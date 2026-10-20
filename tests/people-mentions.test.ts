import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddress, resolveMention, type KnownPerson } from '../src/people/run-resolution';

test('addresses parse with and without a display name', () => {
  assert.deepEqual(parseAddress('Dana Reyes <Dana@Studio.example>'), { name: 'Dana Reyes', email: 'dana@studio.example' });
  assert.deepEqual(parseAddress('"Kim, Alex" <alex@x.com>'), { name: 'Kim, Alex', email: 'alex@x.com' });
  assert.deepEqual(parseAddress('sam@x.com'), { name: null, email: 'sam@x.com' });
});

const people: KnownPerson[] = [
  { id: 'priya', name: 'Priya', emails: [] },
  { id: 'samO', name: 'Sam Ortiz', emails: ['sam.o@example.com'] },
  { id: 'samL', name: 'Sam Lee', emails: [] },
];

test('a known email is known; a unique first name links; an ambiguous one is held; a stranger is new', () => {
  assert.equal(resolveMention({ name: 'S. Ortiz', email: 'sam.o@example.com' }, people).decision, 'known');
  assert.deepEqual([resolveMention({ name: 'Priya Raman', email: 'priya@example.com' }, people).decision, resolveMention({ name: 'Priya Raman', email: 'priya@example.com' }, people).personId], ['link', 'priya']);
  assert.equal(resolveMention({ name: 'Sam', email: null }, people).decision, 'hold');
  assert.equal(resolveMention({ name: 'Nina Park', email: 'nina@x.com' }, people).decision, 'separate');
});

test('a different person with a shared first name is never linked', () => {
  const o = resolveMention({ name: 'Sam Lee', email: 'samlee@example.com' }, [{ id: 'samO', name: 'Sam Ortiz', emails: ['sam.o@example.com'] }]);
  assert.notEqual(o.decision, 'link');
});
