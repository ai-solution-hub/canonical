'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function LibraryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Q&A Library error:', error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center">
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Failed to load Q&amp;A Library
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Something went wrong. Please try again.
      </p>
      <Button onClick={reset} variant="outline">
        Try again
      </Button>
    </div>
  );
}
