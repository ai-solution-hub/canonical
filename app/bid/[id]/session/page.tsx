'use client';

import { useState, useEffect, useCallback, useRef, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QuestionNavigator } from '@/components/question-navigator';
import { ResponseEditor } from '@/components/response-editor';
import { CitationPanel } from '@/components/citation-panel';
import { QualityScore } from '@/components/quality-score';
import { ResponseActions, type ResponseAction } from '@/components/response-actions';
import { BidContextProvider } from '@/components/bid-context-provider';
import { BidCopilotActions } from '@/components/bid-copilot-actions';
import { BidCopilotSuggestions } from '@/components/bid-copilot-suggestions';
import { BidCopilotSidebar } from '@/components/bid-copilot-sidebar';
import { useUserRole } from '@/hooks/use-user-role';
import { cn } from '@/lib/utils';
import { getOrphanedSourceIds } from '@/lib/citations';
import { toast } from 'sonner';
import type { BidQuestion, BidMetadata, ConfidencePosture } from '@/types/bid';
import type { CitationEntry, QualityData, BidResponseMetadata } from '@/types/bid-metadata';

interface NavigatorQuestion {
  id: string;
  question_text: string;
  section_name: string | null;
  confidence_posture: ConfidencePosture | string | null;
  status: string | null;
}

interface BidResponse {
  id: string;
  question_id: string;
  response_text: string | null;
  response_text_advanced: string | null;
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

interface BidSummary {
  id: string;
  name: string;
  domain_metadata: BidMetadata;
}

export default function BidSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { canEdit } = useUserRole();

  // Bid data
  const [bid, setBid] = useState<BidSummary | null>(null);
  const [questions, setQuestions] = useState<BidQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Response data for current question
  const [response, setResponse] = useState<BidResponse | null>(null);
  const [responseLoading, setResponseLoading] = useState(false);
  const [editorContent, setEditorContent] = useState('');

  // Action states
  const [actionLoading, setActionLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<ResponseAction | null>(null);

  // Editor ref for CopilotKit integration
  const editorContentRef = useRef<string>('');

  const currentQuestion = questions[currentIndex] ?? null;

  // ── Fetch bid and questions ──
  const fetchBidData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [bidRes, questionsRes] = await Promise.all([
        fetch(`/api/bids/${id}`),
        fetch(`/api/bids/${id}/questions`),
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
  }, [id, router]);

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
        `/api/bids/${id}/responses/${responseSummary.id}`,
      );
      if (!res.ok) {
        setResponse(null);
        setEditorContent('');
        return;
      }

      const data: BidResponse = await res.json();
      setResponse(data);
      setEditorContent(data.response_text ?? '');
    } catch {
      setResponse(null);
      setEditorContent('');
    } finally {
      setResponseLoading(false);
    }
  }, [currentQuestion, id]);

  useEffect(() => {
    fetchResponse();
  }, [fetchResponse]);

  // Keep editor content ref in sync
  useEffect(() => {
    editorContentRef.current = editorContent;
  }, [editorContent]);

  // ── Navigation ──
  function handleNavigate(index: number) {
    if (index >= 0 && index < questions.length) {
      setCurrentIndex(index);
    }
  }

  // ── Response actions ──
  async function handleAction(action: ResponseAction, instructions?: string) {
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
            `/api/bids/${id}/responses/${response.id}`,
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
          await fetch(`/api/bids/${id}/responses/${response.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              response_text: editorContent,
              review_status: 'approved',
            }),
          });
          toast.success('Response approved');
          await fetchResponse();
          await fetchBidData();
          break;
        }

        case 'regenerate': {
          if (response?.id) {
            // Regenerate existing response
            const regenRes = await fetch(
              `/api/bids/${id}/responses/${response.id}/regenerate`,
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
              throw new Error(err.error ?? 'Regeneration failed');
            }
            toast.success('Response regenerated');
          } else {
            // Draft new response
            const draftRes = await fetch(
              `/api/bids/${id}/responses/draft`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  question_ids: [currentQuestion.id],
                }),
              },
            );
            if (!draftRes.ok) {
              const err = await draftRes.json().catch(() => ({}));
              throw new Error(err.error ?? 'Drafting failed');
            }
            toast.success('Response drafted');
          }
          await fetchResponse();
          await fetchBidData();
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
          await fetch(`/api/bids/${id}/responses/${response.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              review_status: 'needs_review',
            }),
          });
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
  }

  // ── Citation click ──
  function handleCitationClick(contentId: string) {
    window.open(`/item/${contentId}`, '_blank');
  }

  // ── Transform questions for navigator ──
  const navigatorQuestions: NavigatorQuestion[] = questions.map((q) => ({
    id: q.id,
    question_text: q.question_text,
    section_name: q.section_name,
    confidence_posture: q.confidence_posture,
    status: q.status,
  }));

  // ── Loading state ──
  if (loading) {
    return (
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
        <SessionSkeleton />
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle
            className="size-10 text-destructive"
            aria-hidden="true"
          />
          <h2 className="mt-4 text-lg font-semibold">
            Failed to load session
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            onClick={fetchBidData}
            className="mt-4"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!bid || questions.length === 0) {
    return (
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
        <Link
          href={`/bid/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Bid
        </Link>
        <div className="mt-8 flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle
            className="size-10 text-muted-foreground/50"
            aria-hidden="true"
          />
          <h2 className="mt-4 text-lg font-semibold">No questions yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a tender document and extract questions before starting a
            session.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href={`/bid/${id}`}>Go to Bid Detail</Link>
          </Button>
        </div>
      </div>
    );
  }

  const metadata = bid.domain_metadata;
  const bidName = bid.name;
  const buyerName = metadata?.buyer ?? undefined;

  // ── Main session layout ──
  const sessionContent = (
    <div className="mx-auto max-w-screen-2xl px-4 py-4 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/bid/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="sr-only">Back to bid</span>
          </Link>
          <h1 className="text-lg font-semibold text-foreground truncate">
            {bidName}
          </h1>
        </div>
      </div>

      {/* Split panel layout */}
      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:gap-6">
        {/* Left panel: Question navigator */}
        <aside
          className="w-full shrink-0 lg:w-72 xl:w-80"
          aria-label="Question navigation"
        >
          <div className="rounded-lg border bg-card p-4">
            <QuestionNavigator
              questions={navigatorQuestions}
              currentIndex={currentIndex}
              onNavigate={handleNavigate}
            />
          </div>

          {/* Current question display */}
          {currentQuestion && (
            <div className="mt-4 rounded-lg border bg-card p-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Current Question
              </h3>
              {currentQuestion.section_name && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {currentQuestion.section_name}
                </p>
              )}
              <p className="mt-2 text-sm text-foreground">
                {currentQuestion.question_text}
              </p>
              {currentQuestion.word_limit && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Word limit: {currentQuestion.word_limit}
                </p>
              )}
            </div>
          )}
        </aside>

        {/* Right panel: Response editor */}
        <main className="min-w-0 flex-1" aria-label="Response editor">
          {responseLoading ? (
            <div className="flex items-center justify-center rounded-lg border py-20">
              <Loader2
                className="size-6 animate-spin text-muted-foreground"
                aria-label="Loading response"
              />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Response actions */}
              {canEdit && (
                <ResponseActions
                  onAction={handleAction}
                  reviewStatus={response?.review_status ?? null}
                  isLoading={actionLoading}
                  loadingAction={loadingAction}
                  hasDraft={
                    !!response?.response_text || editorContent.length > 7
                  }
                />
              )}

              {/* Editor */}
              <ResponseEditor
                content={editorContent}
                wordLimit={currentQuestion?.word_limit ?? null}
                onChange={setEditorContent}
                onSave={(html) => {
                  setEditorContent(html);
                  if (response?.id) {
                    handleAction('save');
                  }
                }}
                readOnly={!canEdit}
                placeholder={
                  response
                    ? 'Edit your response...'
                    : 'No response yet. Use "Regenerate" to draft an AI response or "Author Manually" to write your own.'
                }
              />

              {/* Quality score */}
              {response?.quality_check && (
                <QualityScore quality={response.quality_check} />
              )}

              {/* Citations */}
              {response && (
                <CitationPanel
                  citations={response.citations ?? []}
                  sourceContent={response.source_content ?? []}
                  orphanedSourceIds={getOrphanedSourceIds(
                    response.citations ?? [],
                    response.source_content ?? [],
                  )}
                  onCitationClick={handleCitationClick}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );

  return (
    <BidContextProvider bidId={id}>
      <BidCopilotActions />
      <BidCopilotSuggestions />
      <BidCopilotSidebar bidName={bidName} buyerName={buyerName}>
        {sessionContent}
      </BidCopilotSidebar>
    </BidContextProvider>
  );
}

function SessionSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-4 w-4 rounded bg-muted" />
        <div className="h-5 w-48 rounded bg-muted" />
      </div>
      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:gap-6">
        <div className="w-full lg:w-72 xl:w-80 space-y-4">
          <div className="h-48 rounded-lg border bg-card" />
          <div className="h-32 rounded-lg border bg-card" />
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="h-10 rounded bg-muted" />
          <div className="h-64 rounded-lg border bg-card" />
          <div className="h-12 rounded-lg border bg-card" />
        </div>
      </div>
    </div>
  );
}
