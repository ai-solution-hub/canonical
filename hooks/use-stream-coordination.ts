'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useDraftStream } from '@/hooks/use-draft-stream';
import { insertLibraryContent } from '@/lib/drawer-insert';
import { responseToHtml } from '@/lib/markdown-to-html';
import { toast } from 'sonner';
import type { useContentLibraryDrawer } from '@/hooks/use-content-library-drawer';
import type { Editor } from '@/components/bid/response-editor';
import type { ResponseAction } from '@/components/bid/response-actions';
import type { BidQuestion, BidMetadata, ConfidencePosture } from '@/types/bid';
import type { CitationEntry, QualityData } from '@/types/bid-metadata';

// ── Interfaces ──

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
  handleAction: (action: ResponseAction, instructions?: string) => void;
  handleLibraryInsert: (html: string, sourceId: string, sourceTitle: string) => Promise<void>;
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
 * Extracts all non-rendering logic from the session page into a single
 * composable hook so the page component focuses solely on layout and JSX.
 */
export function useStreamCoordination({
  bidId,
  contentLibrary,
  editorInstanceRef,
}: UseStreamCoordinationParams): UseStreamCoordinationReturn {
  const router = useRouter();

  // ── Bid data state ──
  const [bid, setBid] = useState<BidSummary | null>(null);
  const [questions, setQuestions] = useState<BidQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Response data for current question ──
  const [response, setResponse] = useState<BidResponse | null>(null);
  const [responseLoading, setResponseLoading] = useState(false);
  const [editorContent, setEditorContent] = useState('');

  // ── Action states ──
  const [actionLoading, setActionLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<ResponseAction | null>(null);

  // ── Streaming draft ──
  const stream = useDraftStream(bidId);
  const streamTextRef = useRef<string>('');
  const rafRef = useRef<number | null>(null);
  const lastEditorUpdateRef = useRef<number>(0);
  const fetchResponseRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const fetchBidDataRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Track whether we are actively streaming to lock the editor
  const isStreaming =
    stream.phase !== 'idle' && stream.phase !== 'done' && stream.phase !== 'error';

  const currentQuestion = questions[currentIndex] ?? null;

  // ── Fetch bid and questions ──
  const fetchBidData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [bidRes, questionsRes] = await Promise.all([
        fetch(`/api/bids/${bidId}`),
        fetch(`/api/bids/${bidId}/questions`),
      ]);

      if (!bidRes.ok) {
        if (bidRes.status === 404) {
          toast.error('Bid not found');
          router.push('/bid');
          return;
        }
        throw new Error('Failed to fetch bid');
      }

      const bidData = await bidRes.json();
      setBid(bidData);

      if (questionsRes.ok) {
        const questionsData = await questionsRes.json();
        setQuestions(questionsData.questions ?? []);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load bid data';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [bidId, router]);

  useEffect(() => {
    fetchBidData();
  }, [fetchBidData]);

  // ── Fetch response for current question ──
  const fetchResponse = useCallback(async () => {
    if (!currentQuestion) {
      setResponse(null);
      setEditorContent('');
      return;
    }

    // Check if the question has a response via the response summary
    const responseSummary = currentQuestion.response;
    if (!responseSummary?.id) {
      setResponse(null);
      setEditorContent('');
      return;
    }

    setResponseLoading(true);
    try {
      const res = await fetch(
        `/api/bids/${bidId}/responses/${responseSummary.id}`,
      );
      if (!res.ok) {
        setResponse(null);
        setEditorContent('');
        return;
      }

      const data: BidResponse = await res.json();
      setResponse(data);
      setEditorContent(responseToHtml(data.response_text));
    } catch (err) {
      console.error('Failed to fetch response:', err);
      setResponse(null);
      setEditorContent('');
    } finally {
      setResponseLoading(false);
    }
  }, [currentQuestion, bidId]);

  useEffect(() => {
    fetchResponse();
  }, [fetchResponse]);

  // Keep refs in sync so completion effect always calls latest versions
  fetchResponseRef.current = fetchResponse;
  fetchBidDataRef.current = fetchBidData;

  // ── Throttled editor update: accumulate text in ref, push to editor at ~60ms intervals ──
  useEffect(() => {
    if (stream.phase !== 'drafting') return;
    if (stream.text === streamTextRef.current) return;

    streamTextRef.current = stream.text;

    const now = Date.now();
    const elapsed = now - lastEditorUpdateRef.current;

    // If enough time has passed, update immediately
    if (elapsed >= 60) {
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

  // Handle stream completion
  useEffect(() => {
    if (stream.phase === 'done') {
      // Final content sync — convert Markdown from AI to HTML for TipTap
      if (stream.text) {
        setEditorContent(responseToHtml(stream.text));
      }
      // Refresh data from database
      void fetchResponseRef.current();
      void fetchBidDataRef.current();
      const costMsg = stream.totalCost
        ? ` (cost: $${stream.totalCost.toFixed(4)})`
        : '';
      toast.success(`Response drafted successfully${costMsg}`);
    }
  }, [stream.phase, stream.text, stream.totalCost]);

  // Handle stream error
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

  // ── Navigation ──
  const handleNavigate = useCallback(
    (index: number) => {
      if (index >= 0 && index < questions.length) {
        // Cancel any in-flight stream when navigating away
        if (isStreaming) {
          stream.cancel();
        }
        setCurrentIndex(index);
      }
    },
    [questions.length, isStreaming, stream],
  );

  // ── Response actions ──
  const handleAction = useCallback(
    async (action: ResponseAction, instructions?: string) => {
      if (!currentQuestion) return;

      setActionLoading(true);
      setLoadingAction(action);

      try {
        switch (action) {
          case 'save': {
            if (!response?.id) {
              toast.error('No response to save');
              break;
            }
            const saveRes = await fetch(
              `/api/bids/${bidId}/responses/${response.id}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  response_text: editorContent,
                }),
              },
            );
            if (!saveRes.ok) throw new Error('Failed to save response');
            toast.success('Response saved');
            await fetchResponse();
            break;
          }

          case 'accept': {
            if (!response?.id) {
              toast.error('No response to accept');
              break;
            }
            // Save current content first, then mark as approved
            const acceptRes = await fetch(`/api/bids/${bidId}/responses/${response.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                response_text: editorContent,
                review_status: 'approved',
              }),
            });
            if (!acceptRes.ok) throw new Error('Failed to approve response');
            toast.success('Response approved');
            await fetchResponse();
            await fetchBidData();
            break;
          }

          case 'regenerate': {
            if (response?.id) {
              // Regenerate existing response (non-streaming, uses instructions)
              const regenRes = await fetch(
                `/api/bids/${bidId}/responses/${response.id}/regenerate`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    instructions: instructions ?? 'Improve this response',
                  }),
                },
              );
              if (!regenRes.ok) {
                const err = await regenRes.json().catch(() => ({}));
                throw new Error(
                  (err as Record<string, string>).error ?? 'Regeneration failed',
                );
              }
              toast.success('Response regenerated');
              await fetchResponse();
              await fetchBidData();
            } else {
              // Draft new response via SSE streaming
              // Clear editor and reset streaming refs
              setEditorContent('');
              streamTextRef.current = '';
              lastEditorUpdateRef.current = 0;
              // startDraft is async but completion is handled by the
              // stream.phase effects above, so we don't await here
              void stream.startDraft(currentQuestion.id);
              // Don't await fetchResponse — the done effect handles that
            }
            break;
          }

          case 'author_manually': {
            // Create an empty response for manual authoring
            setEditorContent('<p></p>');
            toast.info(
              'Start typing your response. Save when ready.',
            );
            break;
          }

          case 'flag_for_review': {
            if (!response?.id) {
              toast.error('No response to flag');
              break;
            }
            const flagRes = await fetch(`/api/bids/${bidId}/responses/${response.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                review_status: 'needs_review',
              }),
            });
            if (!flagRes.ok) throw new Error('Failed to flag response for review');
            toast.success('Response flagged for review');
            await fetchResponse();
            break;
          }
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Action failed',
        );
      } finally {
        setActionLoading(false);
        setLoadingAction(null);
      }
    },
    [currentQuestion, response, editorContent, bidId, fetchResponse, fetchBidData, stream],
  );

  // ── Content Library insert ──
  const handleLibraryInsert = useCallback(
    async (html: string, sourceId: string, sourceTitle: string) => {
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

      if (isMobile || !editorInstanceRef.current) {
        // Mobile / no editor fallback — copy to clipboard
        try {
          // Strip HTML tags for plain text clipboard
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

      // PATCH source_content_ids on the response to track provenance
      if (response?.id) {
        try {
          const existingIds = (response.source_content ?? []).map((s) => s.id);
          if (!existingIds.includes(sourceId)) {
            const res = await fetch(`/api/bids/${bidId}/responses/${response.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source_content_ids: [...existingIds, sourceId],
              }),
            });
            if (!res.ok) {
              console.error('Failed to update provenance:', res.status);
            }
            // Refresh response to pick up new source_content
            void fetchResponse();
          }
        } catch (err) {
          // Non-blocking — content was already inserted, but log for audit trail
          console.error('Failed to update source_content_ids for provenance tracking:', err);
        }
      }
    },
    [response, bidId, fetchResponse, editorInstanceRef],
  );

  // ── Citation click ──
  const handleCitationClick = useCallback((contentId: string) => {
    window.open(`/item/${contentId}`, '_blank');
  }, []);

  // ── Transform questions for navigator ──
  const navigatorQuestions: NavigatorQuestion[] = useMemo(
    () =>
      questions.map((q) => ({
        id: q.id,
        question_text: q.question_text,
        section_name: q.section_name,
        confidence_posture: q.confidence_posture,
        status: q.status,
      })),
    [questions],
  );

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
