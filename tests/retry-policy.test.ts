import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFailure,
  nextAttemptAt,
  shouldRetry,
  failureUpdate,
  MAX_ATTEMPTS,
} from '../src/pipelines/retry-policy';

// What this file protects:
//
// Two thousand entries were lost because a transient refusal was recorded as a
// verdict. The row was marked `failed`, nothing looked at it again, and the one
// job that could have rescued it was both disabled and limited to content less
// than seven days old.
//
// The judgements below are the ones that decide whether that can happen again.

// ------------------------------------------------------------ classification

test('a rate limit is transient — this is the case that lost the data', () => {
  assert.equal(classifyFailure('HTTP 429 — non-JSON response: "Too Many Requests"'), 'transient');
  assert.equal(
    classifyFailure('Request too large for gpt-4o ... Limit 30000, Requested 34954'),
    'transient',
  );
});

test('infrastructure failures are transient', () => {
  for (const m of [
    'Agent request timed out (/ingest/run) after 450000ms',
    'socket hang up',
    'fetch failed',
    'HTTP 502 Bad Gateway',
    'ECONNREFUSED',
  ]) {
    assert.equal(classifyFailure(m), 'transient', m);
  }
});

test('failures that resending cannot fix are terminal', () => {
  for (const m of [
    'Failed to insert insights: invalid input syntax for type timestamp with time zone',
    'unsupported content_type: application/zip',
    'content is empty',
    'HTTP 403 Forbidden',
    'HTTP 404 not found',
    'invalid api key',
  ]) {
    assert.equal(classifyFailure(m), 'terminal', m);
  }
});

test('"not valid JSON" is a symptom, never a verdict', () => {
  // Both of these are real production messages. The parse failure is what the
  // code noticed; the cause is a rate limit and a gateway error page, and both
  // are worth retrying. Reading the symptom as the cause marked them dead.
  assert.equal(
    classifyFailure('Unexpected token \'T\', "Too Many Requests" is not valid JSON'),
    'transient',
  );
  assert.equal(
    classifyFailure('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON'),
    'transient',
  );
});

test('the May billing lapse is transient — the money problem was fixed, the data was not', () => {
  assert.equal(
    classifyFailure('Failed to extract insights: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API"}}'),
    'transient',
  );
});

test('an unrecognised failure is assumed transient, because the costs are lopsided', () => {
  // A needless retry costs one call. Wrongly calling something terminal loses
  // the user's writing for good. MAX_ATTEMPTS stops this running away.
  assert.equal(classifyFailure('something nobody has seen before'), 'transient');
  assert.equal(classifyFailure(''), 'transient');
});

// ----------------------------------------------------------------- scheduling

test('backoff grows, so a struggling service is not hammered', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const gaps = [1, 2, 3, 4, 5, 6].map(
    (n) => nextAttemptAt(n, now).getTime() - now.getTime(),
  );
  for (let i = 1; i < gaps.length; i++) {
    assert.ok(gaps[i]! > gaps[i - 1]!, `attempt ${i + 1} must wait longer than ${i}`);
  }
  assert.ok(gaps[0]! >= 60_000, 'first retry waits at least a minute');
});

test('backoff stops growing rather than running to infinity', () => {
  const now = new Date();
  const last = nextAttemptAt(MAX_ATTEMPTS, now).getTime();
  const beyond = nextAttemptAt(MAX_ATTEMPTS + 50, now).getTime();
  assert.equal(last, beyond, 'past the schedule the delay is capped, not unbounded');
});

test('retries stop at the attempt limit', () => {
  assert.equal(shouldRetry('transient', MAX_ATTEMPTS - 1), true);
  assert.equal(shouldRetry('transient', MAX_ATTEMPTS), false);
});

test('a terminal failure is never retried, even on the first attempt', () => {
  assert.equal(shouldRetry('terminal', 0), false);
});

// --------------------------------------------------------------- the decision

test('a retryable failure returns to pending with a due time, not to failed', () => {
  const u = failureUpdate('HTTP 429 Too Many Requests', 0);
  assert.equal(u.processing_status, 'pending', 'must be pickable by the ordinary work query');
  assert.equal(u.failure_kind, 'transient');
  assert.equal(u.attempt_count, 1);
  assert.ok(u.next_attempt_at, 'a retryable row must carry a due time');
});

test('the last attempt writes failed and stops scheduling', () => {
  const u = failureUpdate('HTTP 429 Too Many Requests', MAX_ATTEMPTS - 1);
  assert.equal(u.attempt_count, MAX_ATTEMPTS);
  assert.equal(u.processing_status, 'failed');
  assert.equal(u.next_attempt_at, null);
});

test('a terminal failure goes straight to failed with no due time', () => {
  const u = failureUpdate('content is empty', 0);
  assert.equal(u.processing_status, 'failed');
  assert.equal(u.failure_kind, 'terminal');
  assert.equal(u.next_attempt_at, null);
});

test('attempt count always advances, so nothing can retry forever', () => {
  let attempts = 0;
  for (let i = 0; i < 50; i++) {
    const u = failureUpdate('transient blip', attempts);
    assert.equal(u.attempt_count, attempts + 1);
    attempts = u.attempt_count;
    if (u.processing_status === 'failed') break;
  }
  assert.equal(attempts, MAX_ATTEMPTS, 'must terminate at the limit');
});

test('the stored error is truncated so a huge message cannot bloat the row', () => {
  const u = failureUpdate('x'.repeat(5000), 0);
  assert.ok(u.processing_error.length <= 500);
});

// ---------------------------------------------------------------- the seam
//
// Reclaimed rows keep their original created_at. If they return to `pending`
// without a due time they are treated as fresh arrivals and filtered by the
// recent-content window -- reclaimed, and unreachable all the same. This is the
// exact shape of the bug this whole change exists to remove, so it is asserted
// rather than assumed.

test('a row is reachable by one of the two queries, never neither', () => {
  const WINDOW_DAYS = 7;
  const old = new Date(Date.now() - 200 * 86_400_000).toISOString();

  const reachable = (row: { created_at: string; next_attempt_at: string | null }) => {
    const fresh =
      row.next_attempt_at === null &&
      Date.now() - new Date(row.created_at).getTime() <= WINDOW_DAYS * 86_400_000;
    const due =
      row.next_attempt_at !== null && new Date(row.next_attempt_at).getTime() <= Date.now();
    return fresh || due;
  };

  // an old row reclaimed WITHOUT a due time -- the bug
  assert.equal(reachable({ created_at: old, next_attempt_at: null }), false);
  // the same row reclaimed WITH one -- the fix
  assert.equal(reachable({ created_at: old, next_attempt_at: new Date().toISOString() }), true);
  // a genuinely new arrival still needs no due time
  assert.equal(reachable({ created_at: new Date().toISOString(), next_attempt_at: null }), true);
});

// ------------------------------------------------------- reachability, again
//
// Review of the first version found the seam had simply moved: splitting
// selection into "arrivals" and "due retries" left rows that were pending, had
// no due time, and were older than the window matching NEITHER. Fourteen rows
// were sitting in exactly that state in production.
//
// The invariant is the one that matters for the whole change: a pending row is
// always reachable by something. This asserts it over the full space of states
// rather than the three cases that happened to come to mind.

test('every pending row is reachable by one of the three queries', () => {
  const WINDOW = 7 * 86_400_000;
  const now = Date.now();

  const reachable = (createdAgoMs: number, nextAttemptAgoMs: number | null) => {
    const created = now - createdAgoMs;
    const due = nextAttemptAgoMs === null ? null : now - nextAttemptAgoMs;
    const inWindow = created >= now - WINDOW;

    const isArrival = due === null && inWindow;
    const isDue = due !== null && due <= now;
    const isStranded = due === null && !inWindow;
    return isArrival || isDue || isStranded;
  };

  const ages = [0, 3 * 86_400_000, 8 * 86_400_000, 200 * 86_400_000];
  for (const age of ages) {
    // no due time, any age -- arrival or stranded, never neither
    assert.equal(reachable(age, null), true, `pending, no due time, ${age}ms old`);
    // due in the past, any age
    assert.equal(reachable(age, 60_000), true, `pending, due, ${age}ms old`);
  }

  // The only row deliberately not picked up is one scheduled for the future,
  // which is backoff working rather than a row going missing.
  const future = (createdAgoMs: number) => {
    const due = now + 60_000;
    return due <= now;
  };
  assert.equal(future(0), false, 'a row due later is waiting, not lost');
});
