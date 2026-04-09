'use client';

/**
 * useRescoringPreview — re-score the last N articles against a candidate
 * feed prompt without persisting anything.
 *
 * Non-destructive: the preview endpoint is a pure read of the candidate
 * prompt against a sample of existing articles. Exposed as `useMutation`
 * because it is a user-initiated action, not a mount-time fetch.
 *
 * Wired to `POST /api/intelligence/workspaces/:id/prompts/preview`. Shared
 * request/response types live in `@/types/intelligence-refinement`.
 *
 * The response uses the sibling-warnings envelope shape — the `warnings`
 * field is omitted when empty. Warnings are NOT surfaced from this hook;
 * the component reads `data.warnings` directly and decides how to render
 * them alongside the score diff.
 *
 * No cache invalidation, no success toast, error toast on failure.
 *
 * Part of S158 WP1a (SI Prompt Refinement mutation hooks).
 */

import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { mutationFetchJson } from '@/lib/query/fetchers';
import type {
  RescoringPreviewRequest,
  RescoringPreviewResponse,
} from '@/types/intelligence-refinement';

export function useRescoringPreview(workspaceId: string) {
  return useMutation({
    mutationFn: (body: RescoringPreviewRequest) =>
      mutationFetchJson<RescoringPreviewResponse>(
        `/api/intelligence/workspaces/${workspaceId}/prompts/preview`,
        body,
      ),
    onError: (err: Error) => toast.error(err.message),
  });
}
