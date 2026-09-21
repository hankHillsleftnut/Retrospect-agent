import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as remediation from '../src/brain/remediation';
import { AVAILABLE_CAPABILITIES, REMEDIATION_FOR_CHECK } from '../src/brain/remediation';
import { CHECKS } from '../src/brain/lint-catalog';

// ── The rule that must not be quietly broken ────────────────────────────────

test('there is NO mergePatterns capability, and that is deliberate', () => {
  assert.ok(!('mergePatterns' in remediation),
    'merging patterns is the exact failure the promoter guards against; remediation must not be a back door to it');
  assert.ok(!AVAILABLE_CAPABILITIES.includes('merge_patterns' as never));
});

test('every pattern-duplication finding escalates to a human instead', () => {
  assert.equal(REMEDIATION_FOR_CHECK['P4'], 'escalate');
});

// ── Safety findings never get an automatic fix ──────────────────────────────

test('both safety checks route to a human, never to an automatic repair', () => {
  const safety = CHECKS.filter((c) => c.severity === 'safety').map((c) => c.id);
  for (const id of safety) {
    assert.equal(REMEDIATION_FOR_CHECK[id], 'escalate',
      `${id} could narrate a crisis at someone; a script must not decide it`);
  }
});

// ── Coverage ────────────────────────────────────────────────────────────────

test('every check in the catalog has a remediation mapped', () => {
  for (const c of CHECKS) {
    assert.ok(REMEDIATION_FOR_CHECK[c.id], `${c.id} has no remediation route`);
  }
});

test('every mapped remediation is a capability that exists', () => {
  for (const [checkId, cap] of Object.entries(REMEDIATION_FOR_CHECK)) {
    assert.ok(AVAILABLE_CAPABILITIES.includes(cap), `${checkId} -> ${cap} does not exist`);
  }
});

// ── Machine repairs must not look like human feedback ───────────────────────

/** Records every table operation so a test can assert on real behaviour
 *  rather than inspecting source text. */
function fakeDb(rows: Record<string, any[]> = {}) {
  const ops: { table: string; op: string; payload?: any; filters: any[] }[] = [];
  const db = {
    from(table: string) {
      const filters: any[] = [];
      const chain: any = {
        select: () => chain,
        update: (payload: any) => { ops.push({ table, op: 'update', payload, filters }); return chain; },
        insert: (payload: any) => { ops.push({ table, op: 'insert', payload, filters }); return chain; },
        in: (col: string, vals: any) => { filters.push(['in', col, vals]); return chain; },
        eq: (col: string, v: any) => { filters.push(['eq', col, v]); return chain; },
        neq: (col: string, v: any) => { filters.push(['neq', col, v]); return chain; },
        is: (col: string, v: any) => { filters.push(['is', col, v]); return chain; },
        not: (col: string, op: string, v: any) => { filters.push(['not', col, v]); return chain; },
        order: () => chain,
        then: (res: any) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(res),
      };
      return chain;
    },
  } as any;
  return { db, ops };
}

const ctx = { userId: 'u1', reason: 'lint finding F1', checkId: 'F1' };

test('a system retirement is stamped distinctly from user feedback', async () => {
  const { db, ops } = fakeDb({ assertions: [{ id: 'a1' }] });
  await remediation.machineRetire(ctx, { table: 'assertions', ids: ['a1'] }, db);
  const update = ops.find((o) => o.table === 'assertions' && o.op === 'update')!;
  assert.match(update.payload.retired_by, /^system:/);
  assert.equal(update.payload.retirement_reason, 'lint finding F1');
  assert.ok(!('assertion_kind' in update.payload),
    'a repair must never masquerade as user_confirmed or contradicted');
});

test('retirement is idempotent -- already-retired rows are excluded', async () => {
  const { db, ops } = fakeDb({ assertions: [{ id: 'a1' }] });
  await remediation.machineRetire(ctx, { table: 'assertions', ids: ['a1'] }, db);
  const update = ops.find((o) => o.table === 'assertions' && o.op === 'update')!;
  assert.ok(
    update.filters.some((f: any[]) => f[0] === 'neq' && f[2] === 'retired'),
    'applying a repair twice must change nothing the second time'
  );
});

test('merging moves evidence to the survivor rather than dropping it', async () => {
  const { db, ops } = fakeDb({
    assertions: [{ id: 'a1', observed_at: '2026-01-01', origin_key: 'k1' },
                 { id: 'a2', observed_at: '2026-02-01', origin_key: 'k2' }],
  });
  await remediation.mergeAssertions({ ...ctx, checkId: 'F6' }, ['a1', 'a2'], db);
  const moved = ops.find((o) => o.table === 'assertion_evidence' && o.op === 'update');
  assert.ok(moved, 'evidence must be reassigned, never deleted');
  assert.equal(moved!.payload.assertion_id, 'a1', 'the oldest row survives, keeping its observation date');
});

test('merging also moves pattern links so counts stay honest', async () => {
  const { db, ops } = fakeDb({
    assertions: [{ id: 'a1', observed_at: '2026-01-01' }, { id: 'a2', observed_at: '2026-02-01' }],
  });
  await remediation.mergeAssertions({ ...ctx, checkId: 'F6' }, ['a1', 'a2'], db);
  assert.ok(ops.some((o) => o.table === 'behavior_pattern_facts' && o.op === 'update'));
});

test('every capability writes an audit row', async () => {
  const cases: [string, () => Promise<unknown>][] = [];
  const mk = () => fakeDb({ assertions: [{ id: 'a1', observed_at: '2026-01-01' }, { id: 'a2', observed_at: '2026-02-01' }] });

  for (const [name, run] of [
    ['reprocessSource', (d: any) => remediation.reprocessSource(ctx, ['r1'], d)],
    ['machineRetire', (d: any) => remediation.machineRetire(ctx, { table: 'assertions', ids: ['a1'] }, d)],
    ['structuralRepair', (d: any) => remediation.structuralRepair(ctx, { kind: 'valid_to_without_status', ids: ['a1'] }, d)],
    ['mergeAssertions', (d: any) => remediation.mergeAssertions(ctx, ['a1', 'a2'], d)],
    ['escalate', (d: any) => remediation.escalate(ctx, { table: 'behavior_patterns', ids: ['p1'], question: 'same loop?' }, d)],
  ] as [string, (d: any) => Promise<unknown>][]) {
    const { db, ops } = mk();
    await run(db);
    assert.ok(
      ops.some((o) => o.table === 'remediation_log' && o.op === 'insert'),
      `${name} mutates the bank; without an audit row it is an unaccountable path into it`
    );
  }
  void cases;
});

test('escalation changes nothing and says so', async () => {
  const { db, ops } = fakeDb();
  const r = await remediation.escalate(ctx, { table: 'behavior_patterns', ids: ['p1', 'p2'], question: 'same loop?' }, db);
  assert.equal(r.changed, 0);
  assert.match(r.note!, /human/);
  assert.ok(!ops.some((o) => o.table === 'behavior_patterns' && o.op === 'update'),
    'escalation must never quietly apply the change it is asking about');
});

test('merging refuses on fewer than two rows', async () => {
  const r = await remediation.mergeAssertions(
    { userId: 'u', reason: 'test' }, ['only-one']
  );
  assert.equal(r.changed, 0);
});

// ── Nothing mutates without an audit row ────────────────────────────────────

test('a broken supersession chain is recorded as lost, not invented', async () => {
  const { db, ops } = fakeDb({ assertions: [{ id: 'a1' }] });
  await remediation.structuralRepair(
    { ...ctx, checkId: 'F5' }, { kind: 'broken_supersession_chain', ids: ['a1'] }, db
  );
  const update = ops.find((o) => o.table === 'assertions' && o.op === 'update')!;
  assert.match(update.payload.retirement_reason, /chain lost/,
    'guessing a successor would fabricate history to tidy a report');
});
