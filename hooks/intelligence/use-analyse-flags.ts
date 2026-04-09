'use client';

/**
 * useAnalyseFlags — trigger Claude-backed analysis of feed flags.
 *
 * Non-destructive: the analyse endpoint returns a synthesis of the supplied
 * flags without mutating server state, but it is exposed as a `useMutation`
 * because it is a user-initiated action rather than a mount-time fetch.
 *
 * Wired to `POST /api/intelligence/workspaces/:id/flags/analyse`. Shared
 * request/response types live in `@/types/intelligence-refinement` so this
 * hook and the WP1b refinement UI components stay in lockstep.
 *
 * No cache invalidation — nothing changed server-side. No success toast —
 * the component renders the analysis result directly, a toast would be
 * redundant noise. Errors are surfaced via `sonner` using the scrubbed
 * message already produced by the route's `errorEnvelope`.
 *
 * Part of S158 WP1a (SI Prompt Refinement mutation hooks).
 */

import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { mutationFetchJson } from '@/lib/query/fetchers';
import type {
  AnalyseFlagsRequest,
  AnalyseFlagsResponse,
} from '@/types/intelligence-refinement';

export function useAnalyseFlags(workspaceId: string) {
  return useMutation({
    mutationFn: (body: AnalyseFlagsRequest) =>
      mutationFetchJson<AnalyseFlagsResponse>(
        `/api/intelligence/workspaces/${workspaceId}/flags/analyse`,
        body,
      ),
    onError: (err: Error) => toast.error(err.message),
  });
}
