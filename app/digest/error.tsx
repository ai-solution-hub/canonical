'use client';

import { useEffect } from 'react';
import { Newspaper } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function DigestError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Digest error:', error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center">
      <Newspaper className="mb-4 size-10 text-muted-foreground/50" aria-hidden="true" />
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Couldn&apos;t load your digest
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        The digest may still be generating. Please try again shortly.
      </p>
      <Button onClick={reset} variant="outline">
        Try again
      </Button>
    </div>
  );
}
