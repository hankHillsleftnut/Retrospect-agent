/** The gate test sets parse and every case states its expected answer (they are judged against later). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, 'fixtures', 'gates');

test('every gate file has cases, each with an id and an expected answer', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const d = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    assert.ok(Array.isArray(d.cases) && d.cases.length > 0, f);
    const ids = new Set<string>();
    for (const c of d.cases) {
      assert.ok(c.id && !ids.has(c.id), `${f}: unique id`);
      ids.add(c.id);
      assert.ok('expect' in c || 'expect_class' in c || 'expect_selected' in c, `${f} ${c.id}: has an expected answer`);
    }
  }
});
