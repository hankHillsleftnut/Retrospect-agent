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
 *   - /runs (developer-only dashboard; the service is deployed as a Render
 *           private service so this isn't reachable from the public internet anyway)
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
