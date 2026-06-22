'use client';

import Link from 'next/link';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useErrorReport } from '@/components/errors/use-error-report';

export default function DiffError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useErrorReport(error, 'Diff review error');

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center"
    >
      <FileText
        className="mb-4 size-10 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Couldn&apos;t load the diff review
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        The document comparison may be temporarily unavailable. Please try
        again.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
        <Button asChild variant="ghost">
          <Link href="/browse">Back to Browse</Link>
        </Button>
      </div>
    </div>
  );
}
