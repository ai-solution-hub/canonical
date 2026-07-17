'use client';
import { Briefcase } from 'lucide-react';
import { ErrorBoundaryShell } from '@/components/errors/error-boundary-shell';

export default function ProcurementError({
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
      logMessage="Procurement error"
      icon={Briefcase}
      heading="Couldn't load this procurement"
      body="The procurement data may be temporarily unavailable. Please try again."
      showHome={true}
    />
  );
}
