'use client';
import { ClipboardCheck } from 'lucide-react';
import { ErrorBoundaryShell } from '@/components/errors/error-boundary-shell';

export default function ReviewError({
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
      logMessage="Review error"
      icon={ClipboardCheck}
      heading="Couldn't load the review queue"
      body="The review queue may be temporarily unavailable. Please try again."
      showHome={false}
    />
  );
}
