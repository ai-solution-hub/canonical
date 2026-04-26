'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ReviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Review error:', error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center"
    >
      <ClipboardCheck
        className="mb-4 size-10 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Couldn&apos;t load the review queue
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        The review queue may be temporarily unavailable. Please try again.
      </p>
      <Button onClick={reset} variant="outline">
        Try again
      </Button>
    </div>
  );
}
