'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDraftStream } from '@/hooks/streaming/use-draft-stream';
import { useBidSession } from '@/hooks/bid/use-bid-session';
import { useBidResponseActions } from '@/hooks/bid/use-bid-response-actions';
import { responseToHtml } from '@/lib/markdown-to-html';
import { queryKeys } from '@/lib/query/query-keys';
import { toast } from 'sonner';
import type { useContentLibraryDrawer } from '@/hooks/use-content-library-drawer';
import type { Editor } from '@/components/bid/response-editor';
import type { ResponseAction } from '@/components/bid/response-actions';
import type { BidQuestion, BidMetadata, ConfidencePosture } from '@/types/bid';
import type { CitationEntry, QualityData } from '@/types/bid-metadata';

// ── Interfaces (exported for consumers and sub-hooks) ──

export interface NavigatorQuestion {
  id: string;
  question_text: string;
  section_name: string | null;
  confidence_posture: ConfidencePosture | string | null;
  status: string | null;
}

export interface BidResponse {
  id: string;
  question_id: string;
  response_text: string | null;
  response_text_advanced: string | null;
  version: number;
  citations: CitationEntry[];
  source_content: Array<{
    id: string;
    title: string | null;
    content_type: string | null;
    primary_domain: string | null;
    primary_subtopic: string | null;
    ai_summary: string | null;
    similarity?: number;
  }>;
  quality_check: QualityData | null;
  review_status: string;
  question: {
    question_text: string;
    word_limit: number | null;
    section_name: string | null;
    confidence_posture: string | null;
  };
}

export interface BidSummary {
  id: string;
  name: string;
  status?: string;
  domain_metadata: BidMetadata;
}

// ── Hook parameters and return type ──

interface UseStreamCoordinationParams {
  bidId: string;
  contentLibrary: ReturnType<typeof useContentLibraryDrawer>;
  editorInstanceRef: React.RefObject<Editor | null>;
}

interface UseStreamCoordinationReturn {
  // Bid data
  bid: BidSummary | null;
  questions: BidQuestion[];
  currentIndex: number;
  loading: boolean;
  error: string | null;
  // Response data
  response: BidResponse | null;
  responseLoading: boolean;
  editorContent: string;
  setEditorContent: (content: string) => void;
  // Stream state
  stream: ReturnType<typeof useDraftStream>;
  isStreaming: boolean;
  // Action state
  actionLoading: boolean;
  loadingAction: ResponseAction | null;
  // Handlers
  handleNavigate: (index: number) => void;
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
  // Derived
  navigatorQuestions: NavigatorQuestion[];
  currentQuestion: BidQuestion | null;
  fetchBidData: () => Promise<void>;
  fetchResponse: () => Promise<void>;
}

/**
 * Coordinates streaming draft generation, bid/response data fetching,
 * question navigation, and response actions for the bid session page.
 *
 * Composes three sub-hooks:
 * - `useBidSession` — TanStack Query data layer (bid, questions, response)
 * - `useDraftStream` — SSE streaming (unchanged imperative hook)
 * - `useBidResponseActions` — TanStack mutations (save, accept, flag, regenerate)
 *
 * This orchestrator manages editor content state, streaming throttle effects,
 * keyboard shortcuts, and navigation with stream cancellation.
 */
export function useStreamCoordination({
  bidId,
  contentLibrary,
  editorInstanceRef,
}: UseStreamCoordinationParams): UseStreamCoordinationReturn {
  // ── Data layer (TanStack Query) ──
  const {
    bid,
    questions,
    loading,
    error,
    currentIndex,
    setCurrentIndex,
    currentQuestion,
    response,
    responseLoading,
    navigatorQuestions,
    invalidateBidData,
    invalidateResponse,
    queryClient,
  } = useBidSession(bidId);

  // ── Streaming (SSE) ──
  const stream = useDraftStream(bidId);
  const isStreaming =
    stream.phase !== 'idle' &&
    stream.phase !== 'done' &&
    stream.phase !== 'error';

  // ── Editor content state ──
  const [editorContent, setEditorContent] = useState('');

  // lastServerContentRef tracks the last value written to the editor from
  // server data. The sync effect only overwrites when editorContent matches
  // this ref (meaning the user has not edited since the last sync).
  // This replaces a dirty-flag approach which had a flaw: streaming updates,
  // author_manually, and internal resets would permanently set the dirty flag.
  // (S129 adversarial fix)
  const lastServerContentRef = useRef('');

  // Streaming throttle refs
  const streamTextRef = useRef<string>('');
  const rafRef = useRef<number | null>(null);
  const lastEditorUpdateRef = useRef<number>(0);

  // ── Editor content sync from response query data ──
  // Guarded against overwriting user edits and streaming content.
  useEffect(() => {
    if (isStreaming) return; // Streaming updates handled by throttle effect

    if (response?.response_text) {
      const serverHtml = responseToHtml(response.response_text);
      // Only overwrite if user has not changed the content since last sync.
      // This effect synchronises server-fetched content into editor state —
      // a legitimate external-system subscription.
      if (editorContent === lastServerContentRef.current) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing server response into editor (external-system subscription)
        setEditorContent(serverHtml);
        lastServerContentRef.current = serverHtml;
      }
    } else if (!response) {
      if (editorContent === lastServerContentRef.current) {
        setEditorContent('');
        lastServerContentRef.current = '';
      }
    }
  }, [response, isStreaming, editorContent]);

  // Reset lastServerContent when navigating to a different question
  // so the sync effect can write fresh data for the new question
  useEffect(() => {
    lastServerContentRef.current = '';
  }, [currentQuestion?.id]);

  // ── Mutation layer ──
  const {
    handleAction,
    handleLibraryInsert,
    handleCitationClick,
    actionLoading,
    loadingAction,
  } = useBidResponseActions({
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
  });

  // ── Throttled editor update during streaming (~60ms intervals) ──
  useEffect(() => {
    if (stream.phase !== 'drafting') return;
    if (stream.text === streamTextRef.current) return;

    streamTextRef.current = stream.text;

    const now = Date.now();
    const elapsed = now - lastEditorUpdateRef.current;

    // If enough time has passed, update immediately.
    // This effect subscribes to the streaming response external system and
    // writes its current text into editor state — a legitimate subscription.
    if (elapsed >= 60) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- throttled sync of streamed text into editor state (external-system subscription)
      setEditorContent(responseToHtml(stream.text));
      lastEditorUpdateRef.current = now;
      return;
    }

    // Otherwise schedule an update
    if (rafRef.current !== null) return; // Already scheduled
    rafRef.current = window.requestAnimationFrame(() => {
      setEditorContent(responseToHtml(streamTextRef.current));
      lastEditorUpdateRef.current = Date.now();
      rafRef.current = null;
    });
  }, [stream.phase, stream.text]);

  // Clean up RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // ── Stream completion — final sync + cache invalidation ──
  useEffect(() => {
    if (stream.phase === 'done') {
      // Final content sync — convert Markdown from AI to HTML for TipTap.
      // This is the terminal flush of a streamed external-system response
      // into editor state, so setState here is the documented exception.
      if (stream.text) {
        const streamedHtml = responseToHtml(stream.text);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- final flush of streamed text into editor state (external-system subscription)
        setEditorContent(streamedHtml);
        // Update lastServerContent so the sync effect can overwrite when
        // the invalidated response query returns
        lastServerContentRef.current = streamedHtml;
      }
      // Invalidate cached data — TanStack refetches in the background
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.responseByQuestion(
          bidId,
          currentQuestion?.id ?? '',
        ),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.detail(bidId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.questions(bidId),
      });
      const costMsg = stream.totalCost
        ? ` (cost: $${stream.totalCost.toFixed(4)})`
        : '';
      toast.success(`Response drafted successfully${costMsg}`);
    }
  }, [
    stream.phase,
    stream.text,
    stream.totalCost,
    queryClient,
    bidId,
    currentQuestion?.id,
  ]);

  // ── Stream error toast ──
  useEffect(() => {
    if (stream.phase === 'error' && stream.error) {
      toast.error(stream.error);
    }
  }, [stream.phase, stream.error]);

  // ── Cmd+L / Ctrl+L — open Content Library with current question context ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        contentLibrary.toggle(currentQuestion?.question_text);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [contentLibrary, currentQuestion?.question_text]);

  // ── Navigation with stream cancellation ──
  const handleNavigate = useCallback(
    (index: number) => {
      if (index >= 0 && index < questions.length) {
        if (isStreaming) {
          stream.cancel();
        }
        setCurrentIndex(index);
      }
    },
    [questions.length, isStreaming, stream, setCurrentIndex],
  );

  // ── Imperative refetch wrappers (exposed for version history restore) ──
  const fetchBidData = useCallback(async () => {
    await invalidateBidData();
  }, [invalidateBidData]);

  const fetchResponse = useCallback(async () => {
    await invalidateResponse();
  }, [invalidateResponse]);

  return {
    bid,
    questions,
    currentIndex,
    loading,
    error,
    response,
    responseLoading,
    editorContent,
    setEditorContent,
    stream,
    isStreaming,
    actionLoading,
    loadingAction,
    handleNavigate,
    handleAction,
    handleLibraryInsert,
    handleCitationClick,
    navigatorQuestions,
    currentQuestion,
    fetchBidData,
    fetchResponse,
  };
}
