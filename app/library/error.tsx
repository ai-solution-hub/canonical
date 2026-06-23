'use client';
import { BookOpen } from 'lucide-react';
import { ErrorBoundaryShell } from '@/components/errors/error-boundary-shell';

export default function LibraryError({
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
      logMessage="Q&A Library error"
      icon={BookOpen}
      heading="Couldn't load the Q&A Library"
      body="Your Q&A pairs are safe. Please try refreshing the page."
      showHome={false}
    />
  );
}
