'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger/client';

export default function LibraryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error({ err: error }, 'Q&A Library error');
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center"
    >
      <BookOpen
        className="mb-4 size-10 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Couldn&apos;t load the Q&amp;A Library
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Your Q&amp;A pairs are safe. Please try refreshing the page.
      </p>
      <Button onClick={reset} variant="outline">
        Try again
      </Button>
    </div>
  );
}
