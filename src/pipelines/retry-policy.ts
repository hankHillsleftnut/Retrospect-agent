/**
 * When is a failure worth trying again, and when is it over?
 *
 * Ingestion had no answer to this. Every failure was written as `failed` and
 * nothing ever looked at it again, so a rate limit lasting ninety seconds and a
 * genuinely unprocessable row were recorded identically and treated identically
 * -- which is to say, both were abandoned. That is how 2,000 entries died.
 *
 * Two judgements live here, both pure so they can be tested without a network:
 * whether a failure is transient, and when to look at it next.
 */

export type FailureKind = 'transient' | 'terminal';

/** Give up on a row after this many attempts and stop spending money on it. */
export const MAX_ATTEMPTS = 6;

/** First retry after a minute; doubling to a day. Full schedule is explicit so
 *  the total lifetime of a retry is obvious rather than emergent. */
const BACKOFF_MINUTES = [1, 5, 20, 90, 360, 1440];

/**
 * Anything that is the environment's fault rather than the content's.
 *
 * The default is deliberately `transient`. An unrecognised error is far more
 * likely to be a network blip or a service restart than a permanently
 * unprocessable entry, and the cost of being wrong is asymmetric: a needless
 * retry costs one call, while wrongly calling something terminal loses the
 * user's writing forever. MAX_ATTEMPTS stops an unknown error retrying without
 * end.
 */
export function classifyFailure(message: string): FailureKind {
  const m = (message ?? '').toLowerCase();

  // Order matters. The first rules catch causes that a later, blunter rule
  // would otherwise mis-read.
  //
  // In particular: "is not valid JSON" is a symptom, never a cause. It means
  // something upstream returned a rate-limit notice or an HTML error page where
  // JSON was expected. Treating the parse failure as the verdict marked 42
  // gateway errors terminal -- never to be retried -- when the request had
  // simply hit a bad minute.

  // 1. Rate limits and quota, however they arrive. Always worth retrying.
  if (
    /429|rate limit|too many requests|quota|overloaded|capacity|credit balance|billing/.test(m)
  ) {
    return 'transient';
  }

  // 2. An HTML body where JSON was expected is a proxy or gateway error page.
  if (/<!doctype|<html|bad gateway|service unavailable|gateway time-?out/.test(m)) {
    return 'transient';
  }

  // 3. Network and timing.
  if (
    /timed out|timeout|socket hang up|econnreset|econnrefused|enotfound|fetch failed|network|abort/.test(m)
  ) {
    return 'transient';
  }

  // 4. 5xx is the server's problem, not the content's.
  if (/\b5\d\d\b|internal server error/.test(m)) return 'transient';

  // 5. Deterministic faults. Sending the same bytes again produces the same
  //    failure, so retrying only spends money to fail identically.
  if (
    /invalid input syntax|violates (check|not-null|foreign key) constraint|duplicate key/.test(m)
  ) {
    return 'terminal';
  }
  if (/unsupported content_type|content is empty|no content|malformed/.test(m)) return 'terminal';
  if (/\b(401|403|404)\b|unauthorized|forbidden|not found|invalid api key|authentication/.test(m)) {
    return 'terminal';
  }

  // 6. Unknown. Assume transient: a needless retry costs one call, while
  //    wrongly declaring something terminal loses the user's writing for good.
  //    MAX_ATTEMPTS stops this running away.
  return 'transient';
}

/** When to look at this row again, given how many times it has already failed. */
export function nextAttemptAt(attemptCount: number, now = new Date()): Date {
  const idx = Math.min(Math.max(attemptCount - 1, 0), BACKOFF_MINUTES.length - 1);
  return new Date(now.getTime() + BACKOFF_MINUTES[idx]! * 60_000);
}

/** False once a row has had its run of attempts, or its failure is terminal. */
export function shouldRetry(kind: FailureKind, attemptCount: number): boolean {
  if (kind === 'terminal') return false;
  return attemptCount < MAX_ATTEMPTS;
}

/**
 * What to write on a row that just failed.
 *
 * A row still worth retrying goes back to `pending` rather than staying
 * `failed`, so the ordinary "work to do" query picks it up and no separate
 * recovery path has to exist. `failed` comes to mean what it says: we are done
 * trying.
 */
export function failureUpdate(
  message: string,
  previousAttempts: number,
  now = new Date(),
): {
  processing_status: 'pending' | 'failed';
  processing_error: string;
  attempt_count: number;
  failure_kind: FailureKind;
  next_attempt_at: string | null;
} {
  const attempt_count = previousAttempts + 1;
  const failure_kind = classifyFailure(message);
  const retry = shouldRetry(failure_kind, attempt_count);

  return {
    processing_status: retry ? 'pending' : 'failed',
    processing_error: message.slice(0, 500),
    attempt_count,
    failure_kind,
    next_attempt_at: retry ? nextAttemptAt(attempt_count, now).toISOString() : null,
  };
}
