'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';

/**
 * Checks whether the user has an active OAuth grant connecting
 * Knowledge Hub to Claude (Claude.ai, Claude Desktop, or CoWork).
 *
 * Returns `null` while loading, `true` if connected, `false` otherwise.
 *
 * Migrated from useState+useEffect to TanStack Query.
 */
export function useClaudeConnected(): boolean | null {
  const { data } = useQuery({
    queryKey: queryKeys.user.claudeConnected,
    queryFn: async (): Promise<boolean> => {
      const result = await fetchJson<{
        grants: Array<{ client?: { name?: string } }>;
      }>('/api/oauth/grants').catch(() => ({
        grants: [] as Array<{ client?: { name?: string } }>,
      }));

      const grants = result.grants ?? [];
      return grants.some(
        (g) =>
          g.client?.name?.toLowerCase().includes('claude') ||
          g.client?.name?.toLowerCase().includes('knowledge hub'),
      );
    },
    staleTime: 5 * 60 * 1000, // OAuth grants change rarely
  });

  // Return null while loading (matches original behaviour), boolean once resolved
  return data ?? null;
}
