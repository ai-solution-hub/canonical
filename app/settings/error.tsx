'use client';
import { Settings } from 'lucide-react';
import { ErrorBoundaryShell } from '@/components/errors/error-boundary-shell';

export default function SettingsError({
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
      logMessage="Settings error"
      icon={Settings}
      heading="Couldn't load settings"
      body="Your preferences are safe. Please try refreshing the page."
      showHome={true}
    />
  );
}
