'use client';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { logger } from '@/lib/logger/client';

/** Shared error-boundary reporting effect: logs + captures to Sentry.
 *  Replaces the byte-identical useEffect inlined in every app error boundary. */
export function useErrorReport(
  error: Error & { digest?: string },
  message: string,
): void {
  useEffect(() => {
    logger.error({ err: error }, message);
    Sentry.captureException(error);
  }, [error, message]);
}
