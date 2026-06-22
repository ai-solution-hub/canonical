'use client';
import { Newspaper } from 'lucide-react';
import { ErrorBoundaryShell } from '@/components/errors/error-boundary-shell';

export default function IntelligenceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorBoundaryShell
      error={error}
      reset={reset}
      logMessage="Intelligence error"
      icon={Newspaper}
      heading="Couldn't load this page"
      body="Your data is safe. Please try refreshing the page."
      showHome={false}
    />
  );
}
