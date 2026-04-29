'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error({ err: error }, 'Page error');
    Sentry.captureException(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center">
      <RefreshCw className="mb-4 size-10 text-muted-foreground/50" aria-hidden="true" />
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Couldn&apos;t load this page
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        This is usually temporary. Check your connection and try again.
      </p>
      <Button onClick={reset} variant="outline">
        Try again
      </Button>
    </div>
  );
}
