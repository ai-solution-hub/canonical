import * as Sentry from '@sentry/nextjs';

// Read DSN directly from process.env rather than via lib/env-client. P0
// archaeology kh-prod-readiness-S9 found that importing clientEnv here
// silenced Sentry for a ~15h prod window: the env-client Zod parse threw
// at module load on the client (separate bug fixed in `0a0ed235`), which
// crashed this import chain BEFORE Sentry.init() ran. Decoupling DSN
// resolution means a future env-client failure on a different field still
// lets Sentry initialise and capture the failure. Next.js statically
// substitutes literal `process.env.NEXT_PUBLIC_X` reads at build time.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: dsn || undefined,
  tracesSampleRate: 0.1,
  debug: false,
  enabled: !!dsn,
});
