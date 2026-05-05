'use client';

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { mutationFetchJson } from '@/lib/query/fetchers';
import { insertLibraryContent } from '@/lib/drawer-insert';
import { toast } from 'sonner';
import type { BidQuestion } from '@/types/bid';
import type { Editor } from '@/components/bid/response-editor';
import type { ResponseAction } from '@/components/bid/response-actions';
import type { BidResponse } from '@/hooks/streaming/use-stream-coordination';
import type { useDraftStream } from '@/hooks/streaming/use-draft-stream';

// ── Parameters ──

interface UseBidResponseActionsParams {
  bidId: string;
  response: BidResponse | null;
  currentQuestion: BidQuestion | null;
  editorContent: string;
  setEditorContent: (content: string) => void;
  lastServerContentRef: React.MutableRefObject<string>;
  streamTextRef: React.MutableRefObject<string>;
  lastEditorUpdateRef: React.MutableRefObject<number>;
  stream: ReturnType<typeof useDraftStream>;
  editorInstanceRef: React.RefObject<Editor | null>;
  invalidateBidData: () => Promise<void>;
  invalidateResponse: () => Promise<void>;
}

// ── Return type ──

/** @public */
export interface UseBidResponseActionsReturn {
  handleAction: (
    action: ResponseAction,
    instructions?: string,
  ) => Promise<void>;
  handleLibraryInsert: (
    html: string,
    sourceId: string,
    sourceTitle: string,
  ) => Promise<void>;
  handleCitationClick: (contentId: string) => void;
  actionLoading: boolean;
  loadingAction: ResponseAction | null;
}

/**
 * Mutation layer for bid response actions.
 * Handles save, accept, regenerate, flag, and library insert.
 */
export function useBidResponseActions({
  bidId,
  response,
  currentQuestion,
  editorContent,
  setEditorContent,
  lastServerContentRef,
  streamTextRef,
  lastEditorUpdateRef,
  stream,
  editorInstanceRef,
  invalidateBidData,
  invalidateResponse,
}: UseBidResponseActionsParams): UseBidResponseActionsReturn {
  const queryClient = useQueryClient();

  // ── Response mutation (save / accept / flag / regenerate-existing) ──
  const responseMutation = useMutation({
    mutationFn: async ({
      action,
      payload,
    }: {
      action: ResponseAction;
      payload: Record<string, unknown>;
    }) => {
      if (action === 'regenerate' && response?.id) {
        return mutationFetchJson(
          `/api/bids/${bidId}/responses/${response.id}/regenerate`,
          { instructions: payload.instructions ?? 'Improve this response' },
        );
      }

      // save, accept, flag_for_review — all PATCH the same endpoint
      return mutationFetchJson(
        `/api/bids/${bidId}/responses/${response!.id}`,
        payload,
        { method: 'PATCH' },
      );
    },
    onSuccess: (_data, { action }) => {
      const msgs: Record<string, string> = {
        save: 'Response saved',
        accept: 'Response approved',
        regenerate: 'Response regenerated',
        flag_for_review: 'Response flagged for review',
      };
      toast.success(msgs[action] ?? 'Action completed');

      // Invalidate response cache
      if (currentQuestion) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.bids.responseByQuestion(
            bidId,
            currentQuestion.id,
          ),
        });
      }

      // Accept and regenerate also affect bid-level data (status changes)
      if (action === 'accept' || action === 'regenerate') {
        void invalidateBidData();
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    },
  });

  // ── Provenance mutation (library insert tracking) ──
  const provenanceMutation = useMutation({
    mutationFn: async ({
      responseId,
      sourceContentIds,
    }: {
      responseId: string;
      sourceContentIds: string[];
    }) => {
      return mutationFetchJson(
        `/api/bids/${bidId}/responses/${responseId}`,
        { source_content_ids: sourceContentIds },
        { method: 'PATCH' },
      );
    },
    onSuccess: () => {
      // Refresh response to pick up new source_content
      void invalidateResponse();
    },
    onError: (err) => {
      // Non-blocking — content was already inserted
      console.error(
        'Failed to update source_content_ids for provenance tracking:',
        err,
      );
    },
  });

  // ── Destructure stable mutate/mutateAsync from mutation objects ──
  const { mutateAsync: responseMutateAsync } = responseMutation;
  const { mutate: provenanceMutate } = provenanceMutation;

  // ── Unified action handler ──
  // MUST remain async returning Promise<void> — the session page's
  // handleActionWithRecovery awaits this (S126 item 1, Section 9).
  const handleAction = useCallback(
    async (action: ResponseAction, instructions?: string): Promise<void> => {
      if (!currentQuestion) return;

      if (action === 'author_manually') {
        setEditorContent('<p></p>');
        // Reset lastServerContent so the sync effect does not overwrite
        // the empty editor with stale response data (S129 adversarial fix)
        lastServerContentRef.current = '';
        toast.info('Start typing your response. Save when ready.');
        return;
      }

      if (action === 'regenerate' && !response?.id) {
        // New draft via SSE streaming — not a mutation
        setEditorContent('');
        streamTextRef.current = '';
        lastEditorUpdateRef.current = 0;
        void stream.startDraft(currentQuestion.id);
        return;
      }

      if (action === 'save' && !response?.id) {
        toast.error('No response to save');
        return;
      }

      if (action === 'accept' && !response?.id) {
        toast.error('No response to accept');
        return;
      }

      if (action === 'flag_for_review' && !response?.id) {
        toast.error('No response to flag');
        return;
      }

      const payload: Record<string, unknown> = {};
      if (action === 'save') payload.response_text = editorContent;
      if (action === 'accept') {
        payload.response_text = editorContent;
        payload.review_status = 'approved';
      }
      if (action === 'flag_for_review') payload.review_status = 'needs_review';
      if (action === 'regenerate')
        payload.instructions = instructions ?? 'Improve this response';

      // CRITICAL: mutateAsync (not mutate) — returns a Promise that the session
      // page's handleActionWithRecovery awaits. Using mutate() would return void,
      // silently breaking draft recovery (S126 item 1, Section 9).
      await responseMutateAsync({ action, payload });

      // After successful save, update lastServerContent so the sync effect
      // can write again when new server data arrives (S129 adversarial fix)
      if (action === 'save' || action === 'accept') {
        lastServerContentRef.current = editorContent;
      }
    },
    [
      currentQuestion,
      response,
      editorContent,
      stream,
      responseMutateAsync,
      setEditorContent,
      lastServerContentRef,
      streamTextRef,
      lastEditorUpdateRef,
    ],
  );

  // ── Content Library insert ──
  const handleLibraryInsert = useCallback(
    async (html: string, sourceId: string, sourceTitle: string) => {
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

      if (isMobile || !editorInstanceRef.current) {
        // Mobile / no editor fallback — copy to clipboard
        try {
          const plainText = html.replace(/<[^>]+>/g, '');
          await navigator.clipboard.writeText(plainText);
          toast.success('Copied to clipboard — paste into your response');
        } catch {
          toast.error('Failed to copy to clipboard');
        }
      } else {
        const inserted = insertLibraryContent({
          editor: editorInstanceRef.current,
          html,
          sourceId,
          sourceTitle,
        });
        if (inserted) {
          toast.success(`Inserted content from "${sourceTitle}"`);
        } else {
          toast.error('Failed to insert content');
          return;
        }
      }

      // Track provenance on the response
      if (response?.id) {
        const existingIds = (response.source_content ?? []).map((s) => s.id);
        if (!existingIds.includes(sourceId)) {
          provenanceMutate({
            responseId: response.id,
            sourceContentIds: [...existingIds, sourceId],
          });
        }
      }
    },
    [response, editorInstanceRef, provenanceMutate],
  );

  // ── Citation click ──
  const handleCitationClick = useCallback((contentId: string) => {
    window.open(`/item/${contentId}`, '_blank');
  }, []);

  // ── Derived loading state ──
  const actionLoading = responseMutation.isPending;
  const loadingAction = responseMutation.isPending
    ? (responseMutation.variables?.action ?? null)
    : null;

  return {
    handleAction,
    handleLibraryInsert,
    handleCitationClick,
    actionLoading,
    loadingAction,
  };
}
