import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Creates a fresh QueryClient and wrapper for testing.
 * Disables retries and refetch-on-focus to make tests deterministic.
 *
 * Defaults use `gcTime: 0` and the implicit `staleTime: 0` because most tests
 * want a fresh cache between assertions. Tests that need to verify
 * production-like cache behaviour (e.g. cache-hit on navigation) should pass
 * `{ staleTime, gcTime }` overrides that match the production
 * `lib/query/query-provider.tsx` configuration.
 */
export function createQueryWrapper(
  opts: {
    staleTime?: number;
    gcTime?: number;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        gcTime: opts.gcTime ?? 0,
        staleTime: opts.staleTime ?? 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return { queryClient, Wrapper };
}
