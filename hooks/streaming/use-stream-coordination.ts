'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDraftStream } from '@/hooks/streaming/use-draft-stream';
import { useProcurementSession } from '@/hooks/procurement/use-procurement-session';
import { useFormResponseActions } from '@/hooks/procurement/use-procurement-response-actions';
import { queryKeys } from '@/lib/query/query-keys';
import { toast } from 'sonner';
import type { useContentLibraryDrawer } from '@/hooks/use-content-library-drawer';
import type { Editor } from '@/components/procurement/response-editor';
import type { ResponseAction } from '@/components/procurement/response-actions';
import type {
  ProcurementQuestion,
  ProcurementMetadata,
  ConfidencePosture,
} from '@/types/procurement';
import type { CitationEntry, QualityData } from '@/types/procurement-metadata';

// ── Content comparison helper (exported for tests) ──

/**
 * Normalises content (markdown or legacy HTML) for equality comparison
 * by stripping any residual markup and collapsing whitespace. Used to
 * detect whether the user has genuinely edited the editor content versus
 * whether the difference between `editorContent` and
 * `lastServerContentRef.current` is just cosmetic (Tiptap serialisation
 * differences, whitespace normalisation, etc.).
 *
 * Since WP4A (S182), the editor stores and transmits markdown — the HTML
 * stripping regexes are retained as a no-op safety net for any legacy
 * content that may still flow through the sync path.
 *
 * Trade-off: a pure text comparison cannot detect formatting-only
 * edits (e.g. user bolds a word without changing the text). In the
 * bid response editor, substantive text edits are the only kind we
 * need to protect — a formatting-only edit being overwritten by a
 * server sync is a minor, acceptable regression, whereas a missed
 * text edit is catastrophic. S152B WP14 tried a structural regex
 * approach first and found it too brittle against the serialisation
 * gap between `marked.parse` output and Tiptap's `getHTML()` output.
 *
 * This is the S152B fix for the sync guard bug (S152A WP2 audit bugs
 * #17/#18): the previous strict-equality guard broke after Tiptap's
 * first `onUpdate` because the normalised `getHTML()` output never
 * matched the raw HTML we stored in `lastServerContentRef`, leaving
 * every subsequent server update permanently blocked — and the initial
 * hydration on reload likewise failed.
 */
export function normaliseForComparison(content: string): string {
  let text = content
    // Replace block-level closing tags with a space to preserve word boundaries
    .replace(/<\/(p|div|h[1-6]|li|br)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ');

  // Strip all remaining tags to a fixed point to avoid incomplete
  // multi-character sanitization where tag-like content can reappear
  // after a single replacement pass.
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]+>/g, '');
  } while (text !== previous);

  text = text
    // Decode common HTML entities so marked vs Tiptap output matches.
    // Important: decode ampersand last to avoid double-unescaping
    // (e.g. "&amp;lt;" -> "&lt;" -> "<").
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    // Collapse whitespace runs and trim
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

// ── Interfaces (exported for consumers and sub-hooks) ──

export interface NavigatorQuestion {
  id: string;
  question_text: string;
  section_name: string | null;
  confidence_posture: ConfidencePosture | string | null;
  status: string | null;
}

export interface ProcurementResponse {
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
    summary: string | null;
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

export interface ProcurementSummary {
  id: string;
  name: string;
  status?: string;
  domain_metadata: ProcurementMetadata;
}

// ── Hook parameters and return type ──

interface UseStreamCoordinationParams {
  procurementId: string;
  contentLibrary: ReturnType<typeof useContentLibraryDrawer>;
  editorInstanceRef: React.RefObject<Editor | null>;
}

interface UseStreamCoordinationReturn {
  // Procurement data
  bid: ProcurementSummary | null;
  questions: ProcurementQuestion[];
  currentIndex: number;
  loading: boolean;
  error: string | null;
  // Response data
  response: ProcurementResponse | null;
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
  currentQuestion: ProcurementQuestion | null;
  fetchProcurementData: () => Promise<void>;
  fetchResponse: () => Promise<void>;
}

/**
 * Coordinates streaming draft generation, bid/response data fetching,
 * question navigation, and response actions for the bid session page.
 *
 * Composes three sub-hooks:
 * - `useProcurementSession` — TanStack Query data layer (bid, questions, response)
 * - `useDraftStream` — SSE streaming (unchanged imperative hook)
 * - `useFormResponseActions` — TanStack mutations (save, accept, flag, regenerate)
 *
 * This orchestrator manages editor content state, streaming throttle effects,
 * keyboard shortcuts, and navigation with stream cancellation.
 */
export function useStreamCoordination({
  procurementId,
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
    invalidateProcurementData,
    invalidateResponse,
    queryClient,
  } = useProcurementSession(procurementId);

  // ── Streaming (SSE) ──
  const stream = useDraftStream(procurementId);
  const isStreaming =
    stream.phase !== 'idle' &&
    stream.phase !== 'done' &&
    stream.phase !== 'error';

  // ── Editor content state ──
  const [editorContent, setEditorContent] = useState('');

  // lastServerContentRef tracks the last value written to the editor from
  // server data. The sync effect uses it (via normalised comparison) to
  // detect whether the user has edited since the last sync.
  // (S129 adversarial fix; S152B normalised comparison, see WP14 #17/#18.)
  const lastServerContentRef = useRef('');

  // lastSyncedServerTextRef tracks the raw `response.response_text` we last
  // synced from. The sync effect early-returns when the server text has not
  // changed, preventing a render loop caused by Tiptap's `onUpdate` writing
  // back a normalised version of the HTML we just set. (S152B WP14 #17.)
  const lastSyncedServerTextRef = useRef<string | null>(null);

  // Streaming throttle refs
  const streamTextRef = useRef<string>('');
  const rafRef = useRef<number | null>(null);
  const lastEditorUpdateRef = useRef<number>(0);

  // ── Editor content sync from response query data ──
  // Server-text-keyed sync with normalised-HTML user-edit detection. Fixes
  // S152A WP2 audit bugs #17 (sync guard equality check) and #18 (editor
  // reload hydration). Both had the same root cause: strict equality between
  // `editorContent` and `lastServerContentRef.current` fails after Tiptap's
  // first `onUpdate` because Tiptap serialises HTML with whitespace and
  // self-closing differences that our stored raw HTML lacks, permanently
  // blocking every subsequent sync.
  const expectedResponseId = currentQuestion?.response?.id ?? null;
  useEffect(() => {
    if (isStreaming) return; // Streaming updates handled by throttle effect

    // No response loaded
    if (!response) {
      // If the current question is expected to have a response, we're in a
      // navigation/refetch gap — keep the editor stable until it arrives.
      // If the question has no expected response (no `response.id` in the
      // question record), clear the editor immediately.
      if (expectedResponseId && responseLoading) return;
      if (editorContent !== '' || lastSyncedServerTextRef.current !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing editor state for a question with no server response (external-system subscription)
        setEditorContent('');
        lastServerContentRef.current = '';
        lastSyncedServerTextRef.current = null;
      }
      return;
    }

    const serverText = response.response_text ?? null;

    // Early-return if the server text has not changed since the last sync.
    // This breaks the render loop caused by Tiptap's `onUpdate` firing after
    // `setContent` and writing a normalised HTML string back into
    // `editorContent` — without this guard the effect would re-run on every
    // normalised re-render.
    if (serverText === lastSyncedServerTextRef.current) return;

    // Server has new content — detect whether the user has edited since the
    // last sync. We compare via `normaliseForComparison` because the raw
    // HTML we previously stored in `lastServerContentRef` differs from the
    // normalised HTML Tiptap produces via its `onUpdate` callback.
    if (
      normaliseForComparison(editorContent) !==
      normaliseForComparison(lastServerContentRef.current)
    ) {
      // User has edits — skip the sync to preserve them. Leave
      // `lastSyncedServerTextRef` stale so the next response change retries.
      return;
    }

    // Safe to sync — feed markdown directly (no HTML bridge).
    const serverMarkdown = serverText ?? '';
    setEditorContent(serverMarkdown);
    lastServerContentRef.current = serverMarkdown;
    lastSyncedServerTextRef.current = serverText;
  }, [
    response,
    responseLoading,
    isStreaming,
    editorContent,
    expectedResponseId,
  ]);

  // ── Mutation layer ──
  const {
    handleAction,
    handleLibraryInsert,
    handleCitationClick,
    actionLoading,
    loadingAction,
  } = useFormResponseActions({
    procurementId,
    response,
    currentQuestion,
    editorContent,
    setEditorContent,
    lastServerContentRef,
    streamTextRef,
    lastEditorUpdateRef,
    stream,
    editorInstanceRef,
    invalidateProcurementData,
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
      setEditorContent(stream.text);
      lastEditorUpdateRef.current = now;
      return;
    }

    // Otherwise schedule an update
    if (rafRef.current !== null) return; // Already scheduled
    rafRef.current = window.requestAnimationFrame(() => {
      setEditorContent(streamTextRef.current);
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
      // Final content sync — feed markdown directly to editor state.
      // This is the terminal flush of a streamed external-system response
      // into editor state, so setState here is the documented exception.
      if (stream.text) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- final flush of streamed text into editor state (external-system subscription)
        setEditorContent(stream.text);
        // Update lastServerContent so the sync effect can overwrite when
        // the invalidated response query returns with the server's stored
        // version of the streamed content. lastSyncedServerTextRef is left
        // as-is so the next response change (post-invalidation) triggers
        // a fresh sync via `serverText !== lastSyncedServerTextRef`.
        lastServerContentRef.current = stream.text;
      }
      // Invalidate cached data — TanStack refetches in the background
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.responseByQuestion(
          procurementId,
          currentQuestion?.id ?? '',
        ),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.detail(procurementId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.questions(procurementId),
      });
      toast.success('Response drafted successfully');
    }
  }, [
    stream.phase,
    stream.text,
    queryClient,
    procurementId,
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
  const fetchProcurementData = useCallback(async () => {
    await invalidateProcurementData();
  }, [invalidateProcurementData]);

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
    fetchProcurementData,
    fetchResponse,
  };
}
