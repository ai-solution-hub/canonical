'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function SearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Search error:', error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center">
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Search encountered an error
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Something went wrong with your search. Please try again.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">Go back</Link>
        </Button>
      </div>
    </div>
  );
}
