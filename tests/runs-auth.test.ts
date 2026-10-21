import assert from 'node:assert/strict';
import test from 'node:test';
import { requireInternalSecretOrLocalDev } from '../src/middleware/internal-auth';

function run(opts: { env?: string; remote: string; header?: Record<string, string> }) {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.INTERNAL_API_SECRET;
  process.env.NODE_ENV = opts.env ?? 'development';
  process.env.INTERNAL_API_SECRET = 's3cret';
  let status = 0;
  let passed = false;
  const req = { socket: { remoteAddress: opts.remote }, header: (h: string) => opts.header?.[h.toLowerCase()] } as any;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as any;
  requireInternalSecretOrLocalDev(req, res, () => { passed = true; });
  process.env.NODE_ENV = prevEnv;
  process.env.INTERNAL_API_SECRET = prevSecret;
  return { passed, status };
}

test('localhost in development can open the dashboard without the secret', () => {
  assert.equal(run({ remote: '127.0.0.1' }).passed, true);
});

test('a remote caller without the secret is refused', () => {
  const r = run({ remote: '10.0.0.5' });
  assert.equal(r.passed, false);
  assert.equal(r.status, 401);
});

test('production never trusts localhost alone', () => {
  assert.equal(run({ env: 'production', remote: '127.0.0.1' }).passed, false);
});

test('a proxied request is not treated as local', () => {
  assert.equal(run({ remote: '127.0.0.1', header: { 'x-forwarded-for': '203.0.113.9' } }).passed, false);
});

test('the right secret works anywhere', () => {
  assert.equal(run({ env: 'production', remote: '10.0.0.5', header: { 'x-internal-secret': 's3cret' } }).passed, true);
});
