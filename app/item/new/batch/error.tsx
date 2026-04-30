'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger/client';

export default function BatchCreateError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error({ err: error }, 'Batch creation error');
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center"
    >
      <ClipboardList
        className="mb-4 size-10 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Couldn&apos;t load batch creation
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Please check your permissions and try again.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
        <Button asChild variant="ghost">
          <Link href="/item/new">Back to Create</Link>
        </Button>
      </div>
    </div>
  );
}
