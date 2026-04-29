'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error({ err: error }, 'Workspace error');
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <AlertTriangle
        className="mb-4 size-8 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h2 className="mb-2 text-base font-semibold text-foreground">
        Something went wrong
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Your data is safe. Please try again.
      </p>
      <Button onClick={reset} variant="outline" size="sm">
        Try again
      </Button>
    </div>
  );
}
