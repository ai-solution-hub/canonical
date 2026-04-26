import * as Sentry from '@sentry/nextjs';
import { clientEnv } from '@/lib/env-client';

Sentry.init({
  dsn: clientEnv.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  debug: false,
  enabled: !!clientEnv.NEXT_PUBLIC_SENTRY_DSN,
});
