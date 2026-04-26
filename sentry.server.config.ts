import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_OBSERVABILITY_SENTRY_DSN,
  tracesSampleRate: 0.1,
  debug: false,
  enabled: !!process.env.NEXT_PUBLIC_OBSERVABILITY_SENTRY_DSN,
});
