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
    objectValue: { v: 1 }, originKey: 'journal:raw-1:p:x',
    evidence: [{ rawContentId: 'raw-1' }],
  }, db);
  assert.equal(calls[0].rows.origin_key, 'journal:raw-1:p:x');
  assert.deepEqual(calls[0].opts, { onConflict: 'user_id,origin_key' });
});

test('refuses to write without an origin key', async () => {
  const { db } = fakeDb();
  await assert.rejects(
    () => writeFact({ userId: 'u1', subjectEntityId: 's', predicate: 'p', objectValue: { v: 1 }, originKey: '', evidence: [{ rawContentId: 'r1' }] }, db),
    /originKey is required/
  );
});

test('refuses a fact with neither an object entity nor an object value', async () => {
  const { db } = fakeDb();
  await assert.rejects(
    () => writeFact({ userId: 'u1', subjectEntityId: 's', predicate: 'p', originKey: 'k', evidence: [{ rawContentId: 'r1' }] }, db),
    /objectEntityId or objectValue/
  );
});

test('carries lineage: source_run_id reaches the row', async () => {
  const { db, calls } = fakeDb();
  await writeFact({
    userId: 'u1', subjectEntityId: 's', predicate: 'p', objectValue: { v: 1 },
    originKey: 'k', sourceRunId: 'run-42', modelVersion: 'm1',
    evidence: [{ rawContentId: 'r1' }],
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

// --- review fixes: the write path must not create what lint calls a bug ---

test('refuses to write a Fact with no evidence at all', async () => {
  const { db } = fakeDb();
  await assert.rejects(
    () => writeFact({
      userId: 'u1', subjectEntityId: 's', predicate: 'p',
      objectValue: { v: 1 }, originKey: 'k', evidence: [],
    }, db),
    /at least one evidence row/,
    'an evidence-less fact cannot show its receipts, and is exactly lint check F2'
  );
});

test('refuses evidence that points at no source', async () => {
  const { db } = fakeDb();
  await assert.rejects(
    () => writeFact({
      userId: 'u1', subjectEntityId: 's', predicate: 'p', objectValue: { v: 1 },
      originKey: 'k', evidence: [{ excerpt: 'orphaned' }],
    }, db),
    /rawContentId, sourceItemId or analysisUnitId/,
    'better a readable error than an opaque CHECK violation from Postgres'
  );
});

test('omits columns the caller did not supply, so an upsert cannot null them', async () => {
  const { db, calls } = fakeDb();
  await writeFact({
    userId: 'u1', subjectEntityId: 's', predicate: 'p', objectValue: { v: 1 },
    originKey: 'k', evidence: [{ rawContentId: 'r1' }],
  }, db);
  const row = calls[0].rows;
  assert.ok(!('model_version' in row), 'an upsert overwrites every column in the payload');
  assert.ok(!('source_run_id' in row));
});

test('still writes them when they ARE supplied', async () => {
  const { db, calls } = fakeDb();
  await writeFact({
    userId: 'u1', subjectEntityId: 's', predicate: 'p', objectValue: { v: 1 },
    originKey: 'k', modelVersion: 'm1', sourceRunId: 'run-1',
    evidence: [{ rawContentId: 'r1' }],
  }, db);
  assert.equal(calls[0].rows.model_version, 'm1');
  assert.equal(calls[0].rows.source_run_id, 'run-1');
});

test('the integration path is unaffected: no null model_version written', async () => {
  const { db, calls } = fakeDb();
  await writeObservedAssertion({
    userId: 'u1', record, providerId: 'google_calendar',
    subjectEntityId: 'self', predicate: 'attended', objectEntityId: 'e-1',
  }, db);
  assert.ok(!('model_version' in calls[0].rows), 'byte-identical to the pre-refactor payload');
});

test('a re-save never re-stamps when a fact was first observed', async () => {
  // Every write used to send observed_at = now. origin_key only collides when
  // the same source is processed again, so each replay made old facts look
  // freshly seen -- which broke changedSince() ("what changed since June?") and
  // let a replayed old fact outrank genuinely newer ones in supersession.
  //
  // The column defaults to NOW() on insert, and an upsert only overwrites what
  // it is sent. So the fix is to send nothing: first sight is kept forever.
  const { db, calls } = fakeDb();
  await writeFact({
    userId: 'u1',
    subjectEntityId: 'self',
    predicate: 'skipped_or_avoided',
    objectValue: { label: 'standup' },
    originKey: 'journal:raw-9:skipped_or_avoided:standup',
    evidence: [{ rawContentId: 'raw-9', excerpt: 'I skipped Thursday standup', charStart: 0, charEnd: 26 }],
  }, db);

  const assertionRow = calls.find((c) => c.table === 'assertions')!.rows;
  assert.equal(
    'observed_at' in assertionRow,
    false,
    'observed_at must be left to the database default, never sent on upsert',
  );
});

test('if the evidence cannot be saved, no older fact is retired', async () => {
  // Supersession retires older facts this one contradicts. It used to run
  // between saving the fact and saving its evidence -- so a failed evidence
  // write left a fact with no evidence that had ALREADY displaced an older,
  // properly evidenced one. Good knowledge replaced by an unsupported claim.
  //
  // Supersession works by reading the user's other facts, so whether it ran is
  // visible as whether anything read the assertions table.
  let supersessionLookedAtOtherFacts = false;
  const db = {
    from(table: string) {
      return {
        upsert() {
          const failing = table.includes('evidence');
          return {
            select: () => ({ single: async () => ({ data: { id: 'new-fact' }, error: null }) }),
            then: (res: any) =>
              Promise.resolve({ error: failing ? { message: 'connection reset' } : null }).then(res),
          } as any;
        },
        select() {
          supersessionLookedAtOtherFacts = true;
          const chain: any = { eq: () => chain, is: () => chain, neq: () => chain, then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) };
          return chain;
        },
      };
    },
  } as unknown as FactDb;

  await assert.rejects(
    writeFact({
      userId: 'u1',
      subjectEntityId: 'self',
      predicate: 'quit_or_stopped',
      objectValue: { label: 'marathon', normalized: 'marathon' },
      originKey: 'journal:raw-9:quit_or_stopped:marathon',
      evidence: [{ rawContentId: 'raw-9', excerpt: 'I quit training for the marathon' }],
    }, db),
    /Write assertion evidence failed/,
  );

  assert.equal(supersessionLookedAtOtherFacts, false, 'nothing was retired on the strength of an unevidenced fact');
});

// ── The atomic path (migration 119) ─────────────────────────────────────────
// Ordered deliberately: the last test teaches writeFact the function is
// missing, which it then remembers for the rest of the process.

function rpcDb(rpcResult: { data: unknown; error: { code?: string; message: string } | null }) {
  const base = fakeDb();
  const rpcCalls: { fn: string; args: any }[] = [];
  const db = Object.assign(base.db, {
    rpc: async (fn: string, args: any) => { rpcCalls.push({ fn, args }); return rpcResult; },
  }) as unknown as FactDb;
  return { db, rpcCalls, calls: base.calls };
}

const atomicFact = {
  userId: 'u1', subjectEntityId: 'self', predicate: 'p', objectValue: { v: 1 },
  originKey: 'journal:raw-1:p:x', applySupersession: false,
  evidence: [{ rawContentId: 'raw-1', excerpt: 'quote' }],
};

test('saves fact and evidence in one database call when it can', async () => {
  const { db, rpcCalls, calls } = rpcDb({ data: 'fact-7', error: null });
  const id = await writeFact(atomicFact, db);
  assert.equal(id, 'fact-7');
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0]!.fn, 'write_fact');
  assert.equal(rpcCalls[0]!.args.p.evidence[0].raw_content_id, 'raw-1');
  assert.equal(calls.length, 0, 'nothing written through the old two-call path');
});

test('leaves out model version and run when not given, so a re-save keeps them', async () => {
  const { db, rpcCalls } = rpcDb({ data: 'fact-7', error: null });
  await writeFact(atomicFact, db);
  assert.equal('model_version' in rpcCalls[0]!.args.p, false);
  assert.equal('source_run_id' in rpcCalls[0]!.args.p, false);
});

test('a real failure is reported, not retried the old way', async () => {
  // Falling back on any error would hide the database refusing a bad fact
  // (no evidence, someone else's data) by writing it another way.
  const { db, calls } = rpcDb({ data: null, error: { code: '42501', message: 'evidence must come from the same user' } });
  await assert.rejects(() => writeFact(atomicFact, db), /same user/);
  assert.equal(calls.length, 0);
});

test('falls back to the two-call path only when the function is not deployed', async () => {
  const { db, calls } = rpcDb({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
  const id = await writeFact(atomicFact, db);
  assert.equal(id, 'assertion-1');
  assert.deepEqual(calls.map((c) => c.table), ['assertions', 'assertion_evidence']);
});
