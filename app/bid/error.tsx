'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function BidError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Bid error:', error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center">
      <Briefcase className="mb-4 size-10 text-muted-foreground/50" aria-hidden="true" />
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Couldn&apos;t load this bid
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        The bid data may be temporarily unavailable. Please try again.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">Return home</Link>
        </Button>
      </div>
    </div>
  );
}
