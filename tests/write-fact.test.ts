import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFact, writeObservedAssertion, type FactDb } from '../src/pipelines/graph-v2';

/** Records every upsert so a test can assert on the exact rows written. */
function fakeDb() {
  const calls: { table: string; rows: any; opts: any }[] = [];
  const db = {
    from(table: string) {
      return {
        upsert(rows: any, opts: any) {
          calls.push({ table, rows, opts });
          const chain = {
            select() {
              return { single: async () => ({ data: { id: 'assertion-1' }, error: null }) };
            },
            then(res: any) { return Promise.resolve({ error: null }).then(res); },
          };
          return chain as any;
        },
      };
    },
  } as unknown as FactDb;
  return { db, calls };
}

test('writes a fact whose only evidence is a raw_content row', async () => {
  const { db, calls } = fakeDb();
  const id = await writeFact({
    userId: 'u1',
    subjectEntityId: 'self',
    predicate: 'skipped_or_avoided',
    objectValue: { label: 'standup' },
    originKey: 'journal:raw-9:skipped_or_avoided:standup',
    evidence: [{ rawContentId: 'raw-9', excerpt: 'I skipped Thursday standup', charStart: 0, charEnd: 26 }],
  }, db);

  assert.equal(id, 'assertion-1');
  const ev = calls.find((c) => c.table.includes('evidence'))!.rows[0];
  assert.equal(ev.raw_content_id, 'raw-9');
  assert.equal(ev.source_item_id, null, 'journal facts carry no source_item_id');
  assert.equal(ev.analysis_unit_id, null);
  assert.equal(ev.excerpt, 'I skipped Thursday standup');
  assert.equal(ev.char_start, 0);
  assert.equal(ev.char_end, 26);
});

test('origin key is caller-supplied and used verbatim', async () => {
  const { db, calls } = fakeDb();
  await writeFact({
    userId: 'u1', subjectEntityId: 'self', predicate: 'p',
    objectValue: { v: 1 }, originKey: 'journal:raw-1:p:x', evidence: [],
  }, db);
  assert.equal(calls[0].rows.origin_key, 'journal:raw-1:p:x');
  assert.deepEqual(calls[0].opts, { onConflict: 'user_id,origin_key' });
});

test('refuses to write without an origin key', async () => {
  const { db } = fakeDb();
  await assert.rejects(
    () => writeFact({ userId: 'u1', subjectEntityId: 's', predicate: 'p', objectValue: { v: 1 }, originKey: '', evidence: [] }, db),
    /originKey is required/
  );
});

test('refuses a fact with neither an object entity nor an object value', async () => {
  const { db } = fakeDb();
  await assert.rejects(
    () => writeFact({ userId: 'u1', subjectEntityId: 's', predicate: 'p', originKey: 'k', evidence: [] }, db),
    /objectEntityId or objectValue/
  );
});

test('carries lineage: source_run_id reaches the row', async () => {
  const { db, calls } = fakeDb();
  await writeFact({
    userId: 'u1', subjectEntityId: 's', predicate: 'p', objectValue: { v: 1 },
    originKey: 'k', sourceRunId: 'run-42', modelVersion: 'm1', evidence: [],
  }, db);
  assert.equal(calls[0].rows.source_run_id, 'run-42');
  assert.equal(calls[0].rows.model_version, 'm1');
});

// --- regression: the integration path must write exactly what it wrote before ---

const record = {
  id: 'si-1',
  provider_object_type: 'event',
  provider_object_id: 'p1',
  canonical_type: 'calendar_event',
  canonical_text: 'Standup',
  normalized_data: {},
  occurred_at: '2026-02-12T09:00:00.000Z',
  normalizer_version: 'v3',
  integration_connections: { provider_id: 'google_calendar' },
  analysis_units: [{ id: 'au-1' }],
} as any;

test('integration mapper writes exactly what it wrote before the extraction', async () => {
  const { db, calls } = fakeDb();
  await writeObservedAssertion({
    userId: 'u1', record, providerId: 'google_calendar',
    subjectEntityId: 'self', predicate: 'attended', objectEntityId: 'e-1',
  }, db);

  const a = calls[0].rows;
  assert.equal(a.origin_key, 'source_item:si-1:attended:primary', 'origin key format must not drift');
  assert.equal(a.assertion_kind, 'observed');
  assert.equal(a.confidence, 1);
  assert.equal(a.event_time, '2026-02-12T09:00:00.000Z');
  assert.equal(a.normalizer_version, 'v3');
  assert.equal(a.metadata.source_item_id, 'si-1');
  assert.equal(a.metadata.provider_id, 'google_calendar');

  const ev = calls.find((c) => c.table.includes('evidence'))!.rows[0];
  assert.equal(ev.analysis_unit_id, 'au-1');
  assert.equal(ev.source_item_id, 'si-1');
  assert.equal(ev.raw_content_id, null);
  assert.equal(ev.excerpt, 'Standup');
});

test('integration mapper with no analysis units still writes one evidence row', async () => {
  const { db, calls } = fakeDb();
  await writeObservedAssertion({
    userId: 'u1', record: { ...record, analysis_units: [] }, providerId: 'google_calendar',
    subjectEntityId: 'self', predicate: 'attended', objectEntityId: 'e-1',
    originSuffix: 'secondary',
  }, db);
  assert.equal(calls[0].rows.origin_key, 'source_item:si-1:attended:secondary');
  const ev = calls.find((c) => c.table.includes('evidence'))!.rows;
  assert.equal(ev.length, 1);
  assert.equal(ev[0].analysis_unit_id, null);
  assert.equal(ev[0].source_item_id, 'si-1');
});

test('integration evidence keeps analysis_unit and source_item, never raw_content', async () => {
  const { db, calls } = fakeDb();
  await writeFact({
    userId: 'u1', subjectEntityId: 'self', predicate: 'attended', objectEntityId: 'e-1',
    originKey: `source_item:${record.id}:attended:primary`,
    kind: 'observed', confidence: 1,
    eventTime: record.occurred_at, normalizerVersion: record.normalizer_version,
    metadata: { source_item_id: record.id, provider_id: 'google_calendar' },
    evidence: [{ analysisUnitId: 'au-1', sourceItemId: record.id, excerpt: 'Standup' }],
  }, db);

  const a = calls[0].rows;
  assert.equal(a.origin_key, 'source_item:si-1:attended:primary');
  assert.equal(a.assertion_kind, 'observed');
  assert.equal(a.event_time, '2026-02-12T09:00:00.000Z');
  assert.equal(a.normalizer_version, 'v3');

  const ev = calls.find((c) => c.table.includes('evidence'))!.rows[0];
  assert.equal(ev.analysis_unit_id, 'au-1');
  assert.equal(ev.source_item_id, 'si-1');
  assert.equal(ev.raw_content_id, null, 'integration facts never carry raw_content_id');
});
