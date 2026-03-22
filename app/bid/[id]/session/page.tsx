'use client';

import { useState, useEffect, useCallback, useRef, useMemo, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Library,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { QuestionNavigator } from '@/components/question-navigator';
import { ResponseEditor } from '@/components/response-editor';
import { CitationPanel } from '@/components/citation-panel';
import { QualityScore } from '@/components/quality-score';
import { ResponseActions } from '@/components/response-actions';
import { StreamingPhaseIndicator } from '@/components/streaming-phase-indicator';
import { ContentLibraryDrawer } from '@/components/content-library-drawer';
import { ResponseVersionHistory } from '@/components/response-version-history';
import { BidContextProvider, useBidContext } from '@/components/bid-context-provider';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { BidCopilotActions } from '@/components/bid-copilot-actions';
import { BidCopilotSuggestions } from '@/components/bid-copilot-suggestions';
import { BidCopilotPageContext } from '@/components/bid-copilot-page-context';
import { useUserRole } from '@/hooks/use-user-role';
import { useModifierKey } from '@/hooks/use-modifier-key';
import { useContentLibraryDrawer } from '@/hooks/use-content-library-drawer';
import { useCitationOrphans } from '@/hooks/use-citation-orphans';
import { useStreamCoordination } from '@/hooks/use-stream-coordination';
import type { Editor } from '@/components/response-editor';

/** Syncs the active question and editor ref from useStreamCoordination into BidContext for CopilotKit */
function BidContextSync({
  questionId,
  editorInstance,
}: {
  questionId: string | null;
  editorInstance: import('@tiptap/react').Editor | null;
}) {
  const { setActiveQuestionId, editorRef } = useBidContext();
  useEffect(() => {
    setActiveQuestionId(questionId);
  }, [questionId, setActiveQuestionId]);
  useEffect(() => {
    // Sync the editor instance into the BidContext ref whenever it changes.
    // Uses a state-driven prop instead of polling a ref on an interval.
    editorRef.current = editorInstance;
  }, [editorInstance, editorRef]);
  return null;
}

function CompactQuestionBar({
  currentIndex,
  totalQuestions,
  questionText,
  onPrev,
  onNext,
  onOpenAll,
}: {
  currentIndex: number;
  totalQuestions: number;
  questionText: string;
  onPrev: () => void;
  onNext: () => void;
  onOpenAll: () => void;
}) {
  return (
    <div
      className="sticky top-0 z-10 flex items-center gap-2 rounded-lg border bg-card px-3 py-2"
      role="navigation"
      aria-label="Question navigation"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onPrev}
        disabled={currentIndex <= 0}
        aria-label="Previous question"
        type="button"
      >
        <ChevronLeft className="size-4" />
      </Button>

      <span className="shrink-0 text-sm font-medium tabular-nums">
        Q{currentIndex + 1}/{totalQuestions}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {questionText}
      </span>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onNext}
        disabled={currentIndex >= totalQuestions - 1}
        aria-label="Next question"
        type="button"
      >
        <ChevronRight className="size-4" />
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={onOpenAll}
        className="shrink-0"
        type="button"
      >
        All
      </Button>
    </div>
  );
}

export default function BidSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { canEdit } = useUserRole();

  // Platform modifier key (SSR-safe)
  const modKey = useModifierKey();

  // Content Library Drawer
  const contentLibrary = useContentLibraryDrawer();

  // Version history panel
  const [historyOpen, setHistoryOpen] = useState(false);

  // Mobile question navigator Sheet
  const [questionSheetOpen, setQuestionSheetOpen] = useState(false);

  // Tiptap editor instance — stored as state so BidContextSync re-renders on change
  const editorInstanceRef = useRef<Editor | null>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const onEditorReady = useCallback((editor: Editor) => {
    editorInstanceRef.current = editor;
    setEditorInstance(editor);
  }, []);

  // ── Stream coordination hook ──
  const {
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
  } = useStreamCoordination({
    bidId: id,
    contentLibrary,
    editorInstanceRef,
  });

  // Citation orphan detection — batch-check source IDs via RPC
  const citationSourceIds = useMemo(
    () => (response?.citations ?? []).map((c) => c.source_id),
    [response?.citations],
  );
  const orphanedSourceIds = useCitationOrphans(citationSourceIds);

  const bidName = bid?.name;

  // ── Loading state ──
  if (loading) {
    return (
      <BidContextProvider bidId={id}>
        <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
          <SessionSkeleton />
        </div>
      </BidContextProvider>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <BidContextProvider bidId={id}>
        <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
          <div className="flex flex-col items-center justify-center py-20 text-center" role="alert">
            <AlertCircle
              className="size-10 text-muted-foreground/50"
              aria-hidden="true"
            />
            <h2 className="mt-4 text-lg font-semibold text-foreground">
              Couldn&apos;t load the session
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
      </BidContextProvider>
    );
  }

  if (!bid || questions.length === 0) {
    return (
      <BidContextProvider bidId={id}>
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
      </BidContextProvider>
    );
  }

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
            <span>Back to bid</span>
          </Link>
          <h1 className="text-lg font-semibold text-foreground truncate">
            {bidName}
          </h1>
        </div>
      </div>

      {/* Mobile compact question bar */}
      {questions.length > 0 && (
        <div className="mt-4 lg:hidden">
          <CompactQuestionBar
            currentIndex={currentIndex}
            totalQuestions={questions.length}
            questionText={currentQuestion?.question_text ?? ''}
            onPrev={() => handleNavigate(currentIndex - 1)}
            onNext={() => handleNavigate(currentIndex + 1)}
            onOpenAll={() => setQuestionSheetOpen(true)}
          />

          {/* Collapsible current question — essential context for response drafting */}
          {currentQuestion && (
            <details className="mt-2 rounded-lg border border-[var(--color-highlight-border)] bg-[var(--color-highlight-bg)]">
              <summary className="cursor-pointer px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Current question
              </summary>
              <div className="px-4 pb-3">
                {currentQuestion.section_name && (
                  <p className="text-xs text-muted-foreground">
                    {currentQuestion.section_name}
                  </p>
                )}
                <p className="mt-1 text-sm text-foreground">
                  {currentQuestion.question_text}
                </p>
                {currentQuestion.word_limit && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Word limit: {currentQuestion.word_limit}
                  </p>
                )}
              </div>
            </details>
          )}

          <Sheet open={questionSheetOpen} onOpenChange={setQuestionSheetOpen}>
            <SheetContent side="left" className="w-[85vw] max-w-sm overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Questions</SheetTitle>
                <SheetDescription>
                  {questions.length} question{questions.length !== 1 ? 's' : ''}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <QuestionNavigator
                  questions={navigatorQuestions}
                  currentIndex={currentIndex}
                  onNavigate={(i) => { handleNavigate(i); setQuestionSheetOpen(false); }}
                />
                {currentQuestion && (
                  <div className="rounded-lg border border-[var(--color-highlight-border)] bg-[var(--color-highlight-bg)] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Current Question
                    </p>
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
              </div>
            </SheetContent>
          </Sheet>
        </div>
      )}

      {/* Split panel layout */}
      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:gap-6">
        {/* Left panel: Question navigator — hidden on mobile (compact bar above) */}
        <aside
          className="hidden w-full shrink-0 lg:block lg:w-72 xl:w-80"
          aria-label="Question navigation"
        >
          <h2 className="sr-only">Question Navigation</h2>
          <div className="rounded-lg border bg-card p-4">
            <QuestionNavigator
              questions={navigatorQuestions}
              currentIndex={currentIndex}
              onNavigate={handleNavigate}
            />
          </div>

          {/* Current question display */}
          {currentQuestion && (
            <div className="mt-4 rounded-lg border border-[var(--color-highlight-border)] bg-[var(--color-highlight-bg)] p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Current Question
              </p>
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
          <h2 className="sr-only">Response Editor</h2>
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
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <ResponseActions
                      onAction={handleAction}
                      reviewStatus={response?.review_status ?? null}
                      isLoading={actionLoading || isStreaming}
                      loadingAction={isStreaming ? 'regenerate' : loadingAction}
                      hasDraft={
                        !!response?.response_text || editorContent.length > 7
                      }
                    />
                  </div>
                  {response && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setHistoryOpen(true)}
                      className="shrink-0 gap-1.5"
                      title="View version history"
                    >
                      <span className="text-xs text-muted-foreground">
                        History
                      </span>
                      <Badge
                        variant="secondary"
                        className="text-xs tabular-nums"
                      >
                        v{response.version}
                      </Badge>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => contentLibrary.open(currentQuestion?.question_text)}
                    className="shrink-0 gap-1.5"
                    title={`Content Library (${modKey}L)`}
                  >
                    <Library className="size-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Library</span>
                    <kbd className="ml-1 hidden rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground sm:inline" aria-hidden="true">
                      {modKey}L
                    </kbd>
                  </Button>
                </div>
              )}

              {/* Streaming phase indicator */}
              {stream.phase !== 'idle' && (
                <StreamingPhaseIndicator
                  phase={stream.phase}
                  error={stream.error}
                  qualityScore={stream.qualityScore}
                  totalCost={stream.totalCost}
                  onCancel={stream.cancel}
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
                readOnly={!canEdit || isStreaming}
                placeholder={
                  isStreaming
                    ? 'Response is being drafted...'
                    : response
                      ? 'Edit your response...'
                      : 'No response yet. Use "Regenerate" to draft an AI response or "Author Manually" to write your own.'
                }
                onEditorReady={onEditorReady}
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
                  orphanedSourceIds={orphanedSourceIds}
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
      <BidCopilotPageContext />
      <BidContextSync questionId={currentQuestion?.id ?? null} editorInstance={editorInstance} />
      <BidCopilotActions />
      <BidCopilotSuggestions />
      {sessionContent}
      <ContentLibraryDrawer
        open={contentLibrary.isOpen}
        onOpenChange={(open) => {
          if (!open) contentLibrary.close();
        }}
        questionText={currentQuestion?.question_text}
        onInsert={handleLibraryInsert}
      />
      <ResponseVersionHistory
        bidId={id}
        responseId={response?.id ?? null}
        currentVersion={response?.version ?? 1}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestored={() => {
          void fetchResponse();
          void fetchBidData();
        }}
      />
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
