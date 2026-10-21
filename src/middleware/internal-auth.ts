import type { Request, Response, NextFunction } from 'express';

/**
 * Guards routes that should only be called by trusted internal services
 * (e.g. the existing retrospect-api backend forwarding ingest/podcast calls).
 *
 * Pairs with the X-Internal-Secret header set by `agent-client.ts` in the
 * existing backend. The same secret must be set in both services' env vars
 * as INTERNAL_API_SECRET.
 *
 * Routes NOT protected by this middleware:
 *   - /health (uptime checks)
 * /runs uses requireInternalSecretOrLocalDev below.
 */
export function requireInternalSecret(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) {
    console.error(
      '[internal-auth] INTERNAL_API_SECRET is not set — rejecting all requests to protected routes.'
    );
    res.status(500).json({ error: 'server misconfigured: missing INTERNAL_API_SECRET' });
    return;
  }
  const provided = req.header('x-internal-secret');
  if (!provided || provided !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * For the developer /runs dashboard (per-user cost, traces). It used to be open,
 * relying on the service being private on Render; one misconfigured deploy would
 * have exposed every user's run history (M14 B0.7). Now it needs the internal
 * secret, except from the developer's own machine when not in production, where
 * the browser dashboard (src/public/runs-dashboard.html) has no way to send it.
 */
export function requireInternalSecretOrLocalDev(req: Request, res: Response, next: NextFunction): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const remote = req.socket?.remoteAddress ?? '';
  const forwarded = req.header('x-forwarded-for');
  if (!isProduction && LOOPBACK.has(remote) && !forwarded) {
    next();
    return;
  }
  requireInternalSecret(req, res, next);
}
