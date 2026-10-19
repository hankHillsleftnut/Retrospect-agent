import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drift, itemsFromOpenApi, signatureOf, verdictFor } from '../src/health/schema-diff';

const set = (...items: string[]) => new Set(items);

test('a migration is "applied" only when everything it adds is in production', () => {
  const sig = signatureOf('117.sql', set('relation:raw_content'), set('relation:raw_content', 'column:raw_content.dedup_key'),
    set('relation:raw_content', 'column:raw_content.dedup_key'));
  assert.deepEqual(sig.adds, ['column:raw_content.dedup_key']);
  assert.equal(verdictFor(sig, set('column:raw_content.dedup_key')).status, 'applied');
  assert.deepEqual(verdictFor(sig, set()), { file: '117.sql', status: 'not_applied', missing: ['column:raw_content.dedup_key'], unexpected: [] });
});

test('half of a migration in production is reported as partly applied, with what is missing', () => {
  const sig = { file: 'x.sql', adds: ['column:t.a', 'column:t.b'], removes: [] };
  const v = verdictFor(sig, set('column:t.a'));
  assert.equal(v.status, 'partial');
  assert.deepEqual(v.status === 'partial' && v.missing, ['column:t.b']);
});

test('a migration that only adds constraints or indexes is "can\'t tell", never guessed', () => {
  assert.equal(verdictFor({ file: '118.sql', adds: [], removes: [] }, set()).status, 'cannot_tell');
});

test('something a later migration removes is not held against the earlier one', () => {
  const sig = signatureOf('a.sql', set(), set('column:t.old'), set());
  assert.equal(verdictFor(sig, set()).status, 'cannot_tell');
});

test('a removal is checked too: the column must be gone', () => {
  const sig = signatureOf('drop.sql', set('column:t.old'), set(), set());
  assert.equal(verdictFor(sig, set('column:t.old')).status, 'not_applied');
  assert.equal(verdictFor(sig, set()).status, 'applied');
});

test("production's API description becomes the same kind of items", () => {
  const items = itemsFromOpenApi({
    definitions: { users: { properties: { id: {}, email: {} } } },
    paths: { '/': {}, '/users': {}, '/rpc/write_fact': {} },
  });
  assert.deepEqual([...items].sort(), ['column:users.email', 'column:users.id', 'function:write_fact', 'relation:users']);
});

test('drift lists both directions, ignoring functions production has extra', () => {
  const d = drift(set('column:users.voice_persona', 'relation:users'), set('relation:users', 'column:raw_content.authorship', 'function:pg_whatever'));
  assert.deepEqual(d.inCodeNotProduction, ['column:users.voice_persona']);
  assert.deepEqual(d.inProductionNotCode, ['column:raw_content.authorship']);
});
