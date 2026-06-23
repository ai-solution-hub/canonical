'use client';
import { RefreshCw } from 'lucide-react';
import { ErrorBoundaryShell } from '@/components/errors/error-boundary-shell';

export default function Error({
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
      logMessage="Page error"
      icon={RefreshCw}
      heading="Couldn't load this page"
      body="This is usually temporary. Check your connection and try again."
      showHome={false}
    />
  );
}
