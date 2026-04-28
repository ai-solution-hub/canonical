import * as Sentry from '@sentry/nextjs';

// Read DSN directly from process.env rather than via lib/env-client. Same
// decoupling rationale as sentry.client.config.ts and sentry.server.config.ts.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: dsn || undefined,
  tracesSampleRate: 0.1,
  debug: false,
  enabled: !!dsn,
});
