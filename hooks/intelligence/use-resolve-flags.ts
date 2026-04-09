'use client';

/**
 * useResolveFlags — bulk-mark feed flags as resolved (addressed or dismissed).
 *
 * THIS is the destructive mutation in the SI Prompt Refinement flow. On
 * success it invalidates both the workspace flags and articles query
 * trees so any mounted list views refetch with the updated state.
 *
 * Wired to `POST /api/intelligence/workspaces/:id/flags/resolve`. Shared
 * request/response types live in `@/types/intelligence-refinement`.
 *
 * The response uses the sibling-warnings envelope — partial-success is
 * signalled by `resolved_count < requested_count` and a populated
 * `warnings` array (e.g. "flag already resolved", "flag not found"). We
 * do NOT downgrade the success toast when warnings are present; the
 * component is responsible for rendering per-flag warnings alongside
 * the aggregate success message.
 *
 * The success toast is pluralised in UK English with explicit singular
 * vs plural wording — no "flag(s)" shorthand.
 *
 * Part of S158 WP1a (SI Prompt Refinement mutation hooks).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { mutationFetchJson } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/query-keys';
import type {
  ResolveFlagsRequest,
  ResolveFlagsResponse,
} from '@/types/intelligence-refinement';

export function useResolveFlags(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ResolveFlagsRequest) =>
      mutationFetchJson<ResolveFlagsResponse>(
        `/api/intelligence/workspaces/${workspaceId}/flags/resolve`,
        body,
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.flags.all(workspaceId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.articles.all(workspaceId),
      });
      const count = data.resolved_count;
      toast.success(
        count === 1 ? '1 flag resolved' : `${count} flags resolved`,
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
