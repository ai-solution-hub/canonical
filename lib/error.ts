/**
 * Returns a safe error message for API responses.
 * In development, includes the real error for debugging convenience.
 * In production, returns only the generic fallback message.
 */
export function safeErrorMessage(err: unknown, fallback: string): string {
  console.error(fallback, err);
  if (process.env.NEXT_PUBLIC_OBSERVABILITY_SENTRY_DSN) {
    import('@sentry/nextjs')
      .then(({ captureException }) => captureException(err))
      .catch((_err) => undefined);
  }
  if (process.env.NODE_ENV === 'development' && err instanceof Error) {
    return `${fallback}: ${err.message}`;
  }
  return fallback;
}
