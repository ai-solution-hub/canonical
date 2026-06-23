'use client';
import { Newspaper } from 'lucide-react';
import { ErrorBoundaryShell } from '@/components/errors/error-boundary-shell';

export default function ChangeReportError({
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
      logMessage="Digest error"
      icon={Newspaper}
      heading="Couldn't load your change report"
      body="The report may still be generating. Please try again shortly."
      showHome={false}
    />
  );
}
