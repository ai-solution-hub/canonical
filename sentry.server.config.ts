import * as Sentry from '@sentry/nextjs';

// Read DSN directly from process.env rather than via lib/env-client. Same
// decoupling rationale as sentry.client.config.ts: a future env-client
// failure on a different field should not silence Sentry on the server.
// On the Node runtime `process.env` is the real object so the substitution
// concern that affected the client doesn't apply, but consistency with the
// client config keeps the three Sentry init sites identical and avoids
// re-introducing the coupling during future cleanups.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: dsn || undefined,
  tracesSampleRate: 0.1,
  debug: false,
  enabled: !!dsn,
});
