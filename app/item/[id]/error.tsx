'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function ItemError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Item error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
      <h2 className="text-lg font-semibold">Failed to load item</h2>
      <p className="text-sm text-muted-foreground">
        Something went wrong. Please try again.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
