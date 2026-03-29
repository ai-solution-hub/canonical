'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GuideDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Guide detail error:', error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center"
    >
      <BookOpen className="mb-4 size-10 text-muted-foreground/50" aria-hidden="true" />
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Couldn&apos;t load this guide
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        The guide content may be temporarily unavailable.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
        <Button asChild variant="ghost">
          <Link href="/guide">Back to Guides</Link>
        </Button>
      </div>
    </div>
  );
}
