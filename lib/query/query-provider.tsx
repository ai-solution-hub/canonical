'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

/**
 * TanStack Query provider for the application.
 *
 * Creates a new QueryClient per component instance (standard pattern for
 * Next.js App Router) so that server-side and client-side state never leak
 * between requests.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is fresh for 30 seconds — prevents refetch on rapid navigation
            staleTime: 30 * 1000,
            // Cache entries live for 5 minutes after last subscriber unmounts
            gcTime: 5 * 60 * 1000,
            // Refetch when window regains focus (replaces manual refresh patterns)
            refetchOnWindowFocus: true,
            // Don't refetch on mount if data is still fresh
            refetchOnMount: true,
            // Retry once on failure
            retry: 1,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} position="bottom" />
      )}
    </QueryClientProvider>
  );
}
