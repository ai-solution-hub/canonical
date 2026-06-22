'use client';
import { Library } from 'lucide-react';
import { ErrorBoundaryShell } from '@/components/errors/error-boundary-shell';

export default function BrowseError({
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
      logMessage="Browse error"
      icon={Library}
      heading="Couldn't load the knowledge base"
      body="Your content is safe. Please try refreshing the page."
      showHome={true}
    />
  );
}
