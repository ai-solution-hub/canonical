'use client';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useErrorReport } from '@/components/errors/use-error-report';

/** Standard error-boundary panel shell shared by the app error boundaries
 *  whose markup byte-matches the canonical template (e.g. app/library, app/procurement).
 *  Boundaries that deviate keep bespoke markup and call useErrorReport directly. */
export function ErrorBoundaryShell({
  error,
  reset,
  logMessage,
  icon: Icon,
  heading,
  body,
  showHome = true,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  logMessage: string;
  icon: LucideIcon;
  heading: ReactNode;
  body: ReactNode;
  showHome?: boolean;
}) {
  useErrorReport(error, logMessage);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-7xl flex-col items-center justify-center px-4 py-24 text-center"
    >
      <Icon
        className="mb-4 size-10 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h2 className="mb-2 text-lg font-semibold text-foreground">{heading}</h2>
      <p className="mb-6 text-sm text-muted-foreground">{body}</p>
      {showHome ? (
        <div className="flex gap-3">
          <Button onClick={reset} variant="outline">
            Try again
          </Button>
          <Button asChild variant="ghost">
            <Link href="/">Return home</Link>
          </Button>
        </div>
      ) : (
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
      )}
    </div>
  );
}
