'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { apiMutationFetcher } from '@/lib/query/query-fetchers';
import type { DiffReviewEntry } from '@/components/source-document/source-document-diff-review';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatusChangePayload {
  entryIds: string[];
  newStatus: string;
}

interface StatusChangeResponse {
  updated: { id: string; status: string; updated_at?: string }[];
  summary: { pending_review: number; applied: number; dismissed: number };
}

interface SendToReviewPayload {
  item_ids: string[];
}

interface SendToReviewResponse {
  sent: number;
  already_pending: number;
  skipped_draft: number;
  review_url: string;
}

interface ReviewSummary {
  pending_review: number;
  applied: number;
  dismissed: number;
}

export interface UseDiffReviewReturn {
  /** Current entries (with optimistic updates applied) */
  localEntries: DiffReviewEntry[];
  /** Current review summary counts */
  localSummary: ReviewSummary;
  /** IDs of entries currently being updated */
  loadingIds: Set<string>;
  /** Error message from last failed update, or null */
  updateError: string | null;
  /** Clear the update error */
  clearUpdateError: () => void;
  /** Per-entry pending notes (typed but not yet saved) */
  pendingNotes: Record<string, string>;
  /** Update a reviewer note for an entry */
  handleNoteChange: (id: string, note: string) => void;
  /** Change status of a single entry */
  handleSingleStatusChange: (id: string, status: string) => void;
  /** Change status of multiple entries */
  handleBulkStatusChange: (ids: string[], status: string) => void;
  /** Send affected items to the review queue */
  handleSendToReview: () => void;
  /** Current state of the send-to-review action */
  sendToReviewState: 'idle' | 'loading' | 'success' | 'error';
  /** Result from a successful send-to-review action */
  sendToReviewResult: SendToReviewResponse | null;
  /** IDs of affected KB items across all actionable entries */
  affectedItemIds: string[];
  /** Whether any affected items exist */
  hasAffectedItems: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages mutation state and optimistic updates for the diff review workflow.
 *
 * Extracts all status-change, bulk-action, note, and send-to-review logic
 * from the SourceDocumentDiffReview component into TanStack Query mutations.
 */
export function useDiffReview(
  documentId: string,
  initialEntries: DiffReviewEntry[],
): UseDiffReviewReturn {
  const queryClient = useQueryClient();

  // -------------------------------------------------------------------------
  // Local state
  // -------------------------------------------------------------------------

  const [localEntries, setLocalEntries] = useState(initialEntries);

  const [localSummary, setLocalSummary] = useState<ReviewSummary>(() => {
    const counts = { pending_review: 0, applied: 0, dismissed: 0 };
    for (const e of initialEntries) {
      const s = e.status as keyof typeof counts;
      if (s in counts) counts[s]++;
    }
    return counts;
  });

  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});

  // Send-to-review state
  const [sendToReviewState, setSendToReviewState] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [sendToReviewResult, setSendToReviewResult] =
    useState<SendToReviewResponse | null>(null);

  // -------------------------------------------------------------------------
  // Computed values
  // -------------------------------------------------------------------------

  const affectedItemIds = [
    ...new Set(
      localEntries
        .filter((e) => e.diff_type !== 'unchanged' && e.affected_item)
        .map((e) => e.affected_item!.id),
    ),
  ];

  const hasAffectedItems = affectedItemIds.length > 0;

  // -------------------------------------------------------------------------
  // Status change mutation
  // -------------------------------------------------------------------------

  const statusMutation = useMutation<
    StatusChangeResponse,
    Error,
    StatusChangePayload,
    { previousEntries: DiffReviewEntry[]; previousSummary: ReviewSummary }
  >({
    mutationFn: ({ entryIds, newStatus }) => {
      // Build the entries payload, attaching pending notes where applicable
      const patchEntries = entryIds.map((id) => {
        const note = pendingNotes[id];
        const payload: { id: string; status: string; note?: string } = {
          id,
          status: newStatus,
        };
        if (note !== undefined) {
          payload.note = note;
        }
        return payload;
      });

      return apiMutationFetcher<StatusChangeResponse>(
        `/api/source-documents/${documentId}/diff`,
        {
          method: 'PATCH',
          body: { entries: patchEntries },
        },
      );
    },

    onMutate: async ({ entryIds, newStatus }) => {
      const previousEntries = [...localEntries];
      const previousSummary = { ...localSummary };

      // Optimistic update — set new statuses immediately
      setLocalEntries((prev) =>
        prev.map((e) =>
          entryIds.includes(e.id) ? { ...e, status: newStatus } : e,
        ),
      );
      setLoadingIds((prev) => new Set([...prev, ...entryIds]));

      // Recompute summary optimistically
      const newSummaryCounts: ReviewSummary = {
        pending_review: 0,
        applied: 0,
        dismissed: 0,
      };
      localEntries.forEach((e) => {
        const s = entryIds.includes(e.id) ? newStatus : e.status;
        if (s in newSummaryCounts)
          newSummaryCounts[s as keyof ReviewSummary]++;
      });
      setLocalSummary(newSummaryCounts);

      setUpdateError(null);

      return { previousEntries, previousSummary };
    },

    onSuccess: (data, { entryIds }) => {
      // Use server-authoritative summary
      setLocalSummary(data.summary);

      // Clear saved notes from pending state and persist to local entries
      const savedNoteIds = entryIds.filter(
        (id) => pendingNotes[id] !== undefined,
      );
      if (savedNoteIds.length > 0) {
        setLocalEntries((prev) =>
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
      // Rollback to pre-mutation state
      if (context) {
        setLocalEntries(context.previousEntries);
        setLocalSummary(context.previousSummary);
      }
      setUpdateError('Failed to update review status. Please try again.');
    },

    onSettled: (_data, _error, { entryIds }) => {
      // Clear loading state for the affected entries
      setLoadingIds((prev) => {
        const next = new Set(prev);
        entryIds.forEach((id) => next.delete(id));
        return next;
      });

      // Invalidate the diff cache so a refetch picks up authoritative data
      queryClient.invalidateQueries({
        queryKey: queryKeys.sourceDocuments.diff(documentId),
      });
    },
  });

  // -------------------------------------------------------------------------
  // Send-to-review mutation
  // -------------------------------------------------------------------------

  const sendToReviewMutation = useMutation<
    SendToReviewResponse,
    Error,
    SendToReviewPayload
  >({
    mutationFn: (payload) =>
      apiMutationFetcher<SendToReviewResponse>(
        `/api/source-documents/${documentId}/send-to-review`,
        {
          method: 'POST',
          body: payload,
        },
      ),

    onMutate: () => {
      setSendToReviewState('loading');
    },

    onSuccess: (data) => {
      setSendToReviewResult(data);
      setSendToReviewState('success');
    },

    onError: () => {
      setSendToReviewState('error');
    },
  });

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleNoteChange = useCallback((id: string, note: string) => {
    setPendingNotes((prev) => ({ ...prev, [id]: note }));
  }, []);

  const handleSingleStatusChange = useCallback(
    (id: string, status: string) => {
      statusMutation.mutate({ entryIds: [id], newStatus: status });
    },
    [statusMutation],
  );

  const handleBulkStatusChange = useCallback(
    (ids: string[], status: string) => {
      if (ids.length === 0) return;
      statusMutation.mutate({ entryIds: ids, newStatus: status });
    },
    [statusMutation],
  );

  const handleSendToReview = useCallback(() => {
    if (affectedItemIds.length === 0) return;
    sendToReviewMutation.mutate({ item_ids: affectedItemIds });
  }, [affectedItemIds, sendToReviewMutation]);

  const clearUpdateError = useCallback(() => {
    setUpdateError(null);
  }, []);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    localEntries,
    localSummary,
    loadingIds,
    updateError,
    clearUpdateError,
    pendingNotes,
    handleNoteChange,
    handleSingleStatusChange,
    handleBulkStatusChange,
    handleSendToReview,
    sendToReviewState,
    sendToReviewResult,
    affectedItemIds,
    hasAffectedItems,
  };
}
