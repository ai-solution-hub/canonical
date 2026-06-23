'use client';

import { useErrorReport } from '@/components/errors/use-error-report';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useErrorReport(error, 'Global error');

  return (
    <html lang="en-GB">
      <body>
        <h2>Something went wrong</h2>
        <button type="button" onClick={() => reset()}>
          Try again
        </button>
      </body>
    </html>
  );
}
