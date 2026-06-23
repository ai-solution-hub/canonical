'use client';
import { FileSearch } from 'lucide-react';
import { ErrorBoundaryShell } from '@/components/errors/error-boundary-shell';

export default function ProvenanceError({
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
      logMessage="Provenance error"
      icon={FileSearch}
      heading="Couldn't load provenance"
      body="Something went wrong loading the provenance dashboard. Please try again."
      showHome={true}
    />
  );
}
