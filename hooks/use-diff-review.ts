'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';
import type { DiffReviewEntry } from '@/components/source-document/source-document-diff-review';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SendToReviewResult {
  sent: number;
  already_pending: number;
  skipped_draft: number;
  review_url: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages review state and mutations for the diff review component.
 *
 * Receives data as props (entries come from the parent page via server fetch)
 * and provides optimistic status changes, bulk updates, reviewer notes, and
 * send-to-review functionality.
 *
 * Bug fixes (Tasks 1 & 2):
 * - useEffect sync: when `initialEntries` changes (e.g. parent refetch),
 *   local state is updated so stale data is never displayed.
 * - Send-to-review errors are stored and surfaced via `sendToReviewError`
 *   instead of being silently swallowed.
 *
 * P4 minor:
 * - `affectedItemIds` is memoised to avoid recomputing on every render.
 */
export function useDiffReview(
  documentId: string,
  initialEntries: DiffReviewEntry[],
) {
  const queryClient = useQueryClient();

  // Local state for entries (optimistic updates applied here)
  const [entries, setEntries] = useState(initialEntries);
  const [localSummary, setLocalSummary] = useState<{
    pending_review: number;
    applied: number;
    dismissed: number;
  }>(() => computeSummary(initialEntries));

  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Per-entry note state — tracks notes that have been typed but not yet saved
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});

  // Send-to-review state
  const [sendToReviewState, setSendToReviewState] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [sendToReviewResult, setSendToReviewResult] =
    useState<SendToReviewResult | null>(null);
  // Task 2: Store and surface send-to-review error instead of swallowing it
  const [sendToReviewError, setSendToReviewError] = useState<string | null>(
    null,
  );

  // Task 1: Sync local state when initialEntries changes (e.g. parent refetch)
  useEffect(() => {
    setEntries(initialEntries);
    setLocalSummary(computeSummary(initialEntries));
  }, [initialEntries]);

  // P4 minor: Memoise affectedItemIds to avoid recomputing on every render
  const affectedItemIds = useMemo(
    () => [
      ...new Set(
        entries
          .filter((e) => e.diff_type !== 'unchanged' && e.affected_item)
          .map((e) => e.affected_item!.id),
      ),
    ],
    [entries],
  );

  const hasAffectedItems = affectedItemIds.length > 0;

  // ─── Status change mutation (single or bulk) ───
  const statusMutation = useMutation({
    mutationFn: async ({
      entryIds,
      status,
    }: {
      entryIds: string[];
      status: string;
    }) => {
      const patchEntries = entryIds.map((id) => {
        const note = pendingNotes[id];
        const payload: { id: string; status: string; note?: string } = {
          id,
          status,
        };
        if (note !== undefined) {
          payload.note = note;
        }
        return payload;
      });

      return mutationFetchJson<{ summary: typeof localSummary }>(
        `/api/source-documents/${documentId}/diff`,
        { entries: patchEntries },
        { method: 'PATCH' },
      );
    },
    onMutate: async ({ entryIds, status }) => {
      const previousEntries = [...entries];
      const previousSummary = { ...localSummary };

      // Optimistic update
      setEntries((prev) =>
        prev.map((e) =>
          entryIds.includes(e.id) ? { ...e, status } : e,
        ),
      );
      setLoadingIds((prev) => new Set([...prev, ...entryIds]));

      // Recompute summary optimistically
      const newSummaryCounts = { pending_review: 0, applied: 0, dismissed: 0 };
      entries.forEach((e) => {
        const s = entryIds.includes(e.id) ? status : e.status;
        if (s in newSummaryCounts)
          newSummaryCounts[s as keyof typeof newSummaryCounts]++;
      });
      setLocalSummary(newSummaryCounts);
      setUpdateError(null);

      return { previousEntries, previousSummary };
    },
    onSuccess: (data, { entryIds }) => {
      // Use server summary
      setLocalSummary(data.summary);

      // Clear saved notes from pending state and persist to local entries
      const savedNoteIds = entryIds.filter(
        (id) => pendingNotes[id] !== undefined,
      );
      if (savedNoteIds.length > 0) {
        setEntries((prev) =>
          prev.map((e) =>
            savedNoteIds.includes(e.id) && pendingNotes[e.id] !== undefined
              ? { ...e, reviewer_note: pendingNotes[e.id] }
              : e,
          ),
        );
        setPendingNotes((prev) => {
          const next = { ...prev };
          for (const id of savedNoteIds) {
            delete next[id];
          }
          return next;
        });
      }
    },
    onError: (_error, _variables, context) => {
      // Rollback
      if (context) {
        setEntries(context.previousEntries);
        setLocalSummary(context.previousSummary);
      }
      setUpdateError('Failed to update review status. Please try again.');
    },
    onSettled: (_data, _error, { entryIds }) => {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        entryIds.forEach((id) => next.delete(id));
        return next;
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.sourceDocuments.diff(documentId),
      });
    },
  });

  // ─── Send-to-review mutation ───
  const sendToReviewMutation = useMutation({
    mutationFn: async (itemIds: string[]) => {
      return mutationFetchJson<SendToReviewResult>(
        `/api/source-documents/${documentId}/send-to-review`,
        { item_ids: itemIds },
      );
    },
    onMutate: () => {
      setSendToReviewState('loading');
      setSendToReviewError(null);
    },
    onSuccess: (data) => {
      setSendToReviewResult(data);
      setSendToReviewState('success');
    },
    onError: (error) => {
      setSendToReviewState('error');
      // Task 2: Store error message instead of swallowing
      setSendToReviewError(
        error instanceof Error ? error.message : 'Failed to send to review',
      );
      toast.error('Failed to send items to review queue');
    },
  });

  // ─── Handlers ───

  const handleNoteChange = useCallback((id: string, note: string) => {
    setPendingNotes((prev) => ({ ...prev, [id]: note }));
  }, []);

  const handleStatusChange = useCallback(
    (id: string, status: string) => {
      statusMutation.mutate({ entryIds: [id], status });
    },
    [statusMutation],
  );

  const handleBulkStatusChange = useCallback(
    (ids: string[], status: string) => {
      if (ids.length === 0) return;
      statusMutation.mutate({ entryIds: ids, status });
    },
    [statusMutation],
  );

  const handleSendToReview = useCallback(() => {
    if (affectedItemIds.length === 0) return;
    sendToReviewMutation.mutate(affectedItemIds);
  }, [affectedItemIds, sendToReviewMutation]);

  const dismissError = useCallback(() => {
    setUpdateError(null);
  }, []);

  return {
    entries,
    localSummary,
    loadingIds,
    updateError,
    dismissError,
    isAnyLoading: loadingIds.size > 0,
    handleStatusChange,
    handleBulkStatusChange,
    handleNoteChange,
    pendingNotes,
    affectedItemIds,
    hasAffectedItems,
    sendToReviewState,
    sendToReviewResult,
    sendToReviewError,
    handleSendToReview,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeSummary(entries: DiffReviewEntry[]) {
  const counts = { pending_review: 0, applied: 0, dismissed: 0 };
  for (const e of entries) {
    const s = e.status as keyof typeof counts;
    if (s in counts) counts[s]++;
  }
  return counts;
}
