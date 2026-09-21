import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.RETROSPECT_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.RENDER_GIT_COMMIT,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
  });
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(error, { extra: context });
}
