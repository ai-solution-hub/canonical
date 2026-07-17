'use client';

import { useState, useCallback, useRef, useMemo, useEffect, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Library,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { QuestionNavigator } from '@/components/procurement/question-navigator';
import { ResponseEditor } from '@/components/procurement/response-editor';
import { StreamingAnswerPreview } from '@/components/procurement/streaming-answer-preview';
import { CitationPanel } from '@/components/content/citation-panel';
import { QualityScore } from '@/components/shared/quality-score';
import { ResponseActions } from '@/components/procurement/response-actions';
import { StreamingPhaseIndicator } from '@/components/shared/streaming-phase-indicator';
import { ContentLibraryDrawer } from '@/components/content/content-library-drawer';
import { ResponseVersionHistory } from '@/components/procurement/response-version-history';
import { ProcurementContextProvider } from '@/components/procurement/procurement-context-provider';
import { DraftRecoveryDialog } from '@/components/procurement/draft-recovery-dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { useUserRole } from '@/hooks/use-user-role';
import { useModifierKey } from '@/hooks/ui/use-modifier-key';
import { useContentLibraryDrawer } from '@/hooks/use-content-library-drawer';
import { useCitationOrphans } from '@/hooks/use-citation-orphans';
import { useDraftRecovery } from '@/hooks/streaming/use-draft-recovery';
import { useStreamCoordination } from '@/hooks/streaming/use-stream-coordination';
import { deriveProcurementStatus } from '@/lib/domains/procurement/procurement-detail-shape';
import { cn } from '@/lib/utils';
import type { Editor } from '@/components/procurement/response-editor';
import type { ProcurementWorkflowState } from '@/types/procurement';

/** Procurement states at or after review — used for citation panel default-expanded (P1-4). */
const REVIEW_OR_LATER_STATES: ProcurementWorkflowState[] = [
  'in_review',
  'ready_for_export',
  'submitted',
  'won',
  'lost',
  'withdrawn',
];

/** Displays word count alongside word limit with colour-coded feedback */
function WordCountIndicator({
  wordCount,
  wordLimit,
}: {
  wordCount: number;
  wordLimit: number;
}) {
  const ratio = wordCount / wordLimit;
  const isOver = ratio > 1;
  const isNearLimit = ratio > 0.8 && ratio <= 1;

  return (
    <span
      className={cn(
        'text-xs tabular-nums',
        isOver && 'font-semibold text-destructive',
        isNearLimit && 'text-status-warning',
        !isOver && !isNearLimit && 'text-muted-foreground',
      )}
      role="status"
      aria-live="polite"
    >
      {wordCount} / {wordLimit} words
      {isOver && ' — over limit'}
    </span>
  );
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

export default function ProcurementSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { canEdit, role } = useUserRole();

  // Platform modifier key (SSR-safe)
  const modKey = useModifierKey();

  // Content Library Drawer
  const contentLibrary = useContentLibraryDrawer();

  // Version history panel
  const [historyOpen, setHistoryOpen] = useState(false);

  // Mobile question navigator Sheet
  const [questionSheetOpen, setQuestionSheetOpen] = useState(false);

  // Tiptap editor instance ref — used by useStreamCoordination
  const editorInstanceRef = useRef<Editor | null>(null);
  const onEditorReady = useCallback((editor: Editor) => {
    editorInstanceRef.current = editor;
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
    fetchProcurementData,
    fetchResponse,
  } = useStreamCoordination({
    procurementId: id,
    contentLibrary,
    editorInstanceRef,
  });

  // ── Draft recovery (localStorage crash protection) ──
  const draftRecovery = useDraftRecovery(
    id,
    currentQuestion?.id ?? null,
    response?.version ?? null,
  );

  // Destructure for React Compiler memoisation compatibility (S114 gotcha)
  const { saveDraft, clearDraft, draftContent } = draftRecovery;

  // Persist editor content to localStorage on change (debounced)
  useEffect(() => {
    // Only save when there is meaningful content and not during streaming
    if (editorContent.length > 7 && !isStreaming) {
      saveDraft(editorContent);
    }
  }, [editorContent, isStreaming, saveDraft]);

  // Handle restoring a recovered draft
  const handleRestoreDraft = useCallback(() => {
    if (draftContent) {
      setEditorContent(draftContent);
      clearDraft();
    }
  }, [draftContent, clearDraft, setEditorContent]);

  // Handle discarding a recovered draft
  const handleDiscardDraft = useCallback(() => {
    clearDraft();
  }, [clearDraft]);

  // Wrap handleAction to clear draft only after successful save/accept
  const handleActionWithRecovery = useCallback(
    async (
      action: Parameters<typeof handleAction>[0],
      instructions?: string,
    ) => {
      try {
        if (instructions !== undefined) {
          await handleAction(action, instructions);
        } else {
          await handleAction(action);
        }

        // Clear draft only after successful save or accept
        if (action === 'save' || action === 'accept') {
          clearDraft();
        }
      } catch {
        // On failure, keep the draft as a safety net
      }
    },
    [handleAction, clearDraft],
  );

  // Citation orphan detection — batch-check source IDs via RPC
  const citationSourceIds = useMemo(
    () => (response?.citations ?? []).map((c) => c.source_id),
    [response?.citations],
  );
  const orphanedSourceIds = useCitationOrphans(citationSourceIds);

  // Citation panel default-expanded for admin role or review-or-later bid states (P1-4)
  // {130.13} re-point: the umbrella state now derives from the primary child
  // form's workflow_state ({130.11} removed `bid.status`).
  const procurementState = deriveProcurementStatus(bid);
  const citationDefaultExpanded =
    role === 'admin' ||
    (procurementState != null &&
      (REVIEW_OR_LATER_STATES as readonly string[]).includes(procurementState));

  const procurementName = bid?.name;

  // ── Next unanswered question index ──
  // A question is "unanswered" if it has no response (status is not_started)
  const nextUnansweredIndex = useMemo(() => {
    // Search forward from the current position first, then wrap around
    for (let i = currentIndex + 1; i < questions.length; i++) {
      if (questions[i].status === 'not_started') return i;
    }
    for (let i = 0; i < currentIndex; i++) {
      if (questions[i].status === 'not_started') return i;
    }
    return -1;
  }, [questions, currentIndex]);

  const handleNextUnanswered = useCallback(() => {
    if (nextUnansweredIndex >= 0) {
      handleNavigate(nextUnansweredIndex);
    }
  }, [nextUnansweredIndex, handleNavigate]);

  // ── Cmd+S / Ctrl+S — page-level save shortcut ──
  useEffect(() => {
    if (!canEdit) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (response?.id && editorContent.length > 7) {
          handleActionWithRecovery('save');
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [canEdit, response?.id, editorContent.length, handleActionWithRecovery]);

  // ── Current word count from editor content ──
  const currentWordCount = useMemo(() => {
    // Strip HTML tags and count words
    const text = editorContent.replace(/<[^>]+>/g, ' ').trim();
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
  }, [editorContent]);

  // ── Loading state ──
  if (loading) {
    return (
      <ProcurementContextProvider procurementId={id}>
        <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
          <SessionSkeleton />
        </div>
      </ProcurementContextProvider>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <ProcurementContextProvider procurementId={id}>
        <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
          <div
            className="flex flex-col items-center justify-center py-20 text-center"
            role="alert"
          >
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
              onClick={fetchProcurementData}
              className="mt-4"
            >
              Try again
            </Button>
          </div>
        </div>
      </ProcurementContextProvider>
    );
  }

  if (!bid || questions.length === 0) {
    return (
      <ProcurementContextProvider procurementId={id}>
        <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
          <Link
            href={`/procurement/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to Procurement
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
              <Link href={`/procurement/${id}`}>Go to Procurement Detail</Link>
            </Button>
          </div>
        </div>
      </ProcurementContextProvider>
    );
  }

  // ── Main session layout ──
  const sessionContent = (
    <div
      className="mx-auto max-w-screen-2xl px-4 py-4 sm:px-6"
      aria-label="Procurement drafting session"
    >
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/procurement/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>Back to bid</span>
          </Link>
          <h1 className="text-lg font-semibold text-foreground truncate">
            {procurementName}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <Link href={`/browse?from_bid=${id}`}>
              <Search className="size-3.5" aria-hidden="true" />
              Browse for content
            </Link>
          </Button>
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
            <details className="mt-2 rounded-lg border border-[var(--highlight-border)] bg-[var(--highlight-bg)]">
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
                {currentQuestion.word_limit ? (
                  <div className="mt-1">
                    <WordCountIndicator
                      wordCount={currentWordCount}
                      wordLimit={currentQuestion.word_limit}
                    />
                  </div>
                ) : null}
              </div>
            </details>
          )}

          <Sheet open={questionSheetOpen} onOpenChange={setQuestionSheetOpen}>
            <SheetContent
              side="left"
              className="w-[85vw] max-w-sm overflow-y-auto"
            >
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
                  onNavigate={(i) => {
                    handleNavigate(i);
                    setQuestionSheetOpen(false);
                  }}
                />
                {currentQuestion && (
                  <div className="rounded-lg border border-[var(--highlight-border)] bg-[var(--highlight-bg)] p-4">
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
                    {currentQuestion.word_limit ? (
                      <div className="mt-2">
                        <WordCountIndicator
                          wordCount={currentWordCount}
                          wordLimit={currentQuestion.word_limit}
                        />
                      </div>
                    ) : null}
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
            <div className="mt-4 rounded-lg border border-[var(--highlight-border)] bg-[var(--highlight-bg)] p-4">
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
              {currentQuestion.word_limit ? (
                <div className="mt-2">
                  <WordCountIndicator
                    wordCount={currentWordCount}
                    wordLimit={currentQuestion.word_limit}
                  />
                </div>
              ) : null}
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
                      onAction={handleActionWithRecovery}
                      reviewStatus={response?.review_status ?? null}
                      isLoading={actionLoading || isStreaming}
                      loadingAction={isStreaming ? 'regenerate' : loadingAction}
                      hasDraft={
                        !!response?.response_text || editorContent.length > 7
                      }
                      nextUnansweredIndex={nextUnansweredIndex}
                      onNextUnanswered={handleNextUnanswered}
                    />
                  </div>

                  {/* ── Tools group: History / Library ── */}
                  <Separator orientation="vertical" className="h-5" />
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
                    onClick={() =>
                      contentLibrary.open(currentQuestion?.question_text)
                    }
                    className="shrink-0 gap-1.5"
                    title={`Content Library (${modKey}L)`}
                  >
                    <Library className="size-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Library</span>
                    <kbd
                      className="ml-1 hidden rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground sm:inline"
                      aria-hidden="true"
                    >
                      {modKey}L
                    </kbd>
                  </Button>
                </div>
              )}

              {/* Draft recovery banner */}
              <DraftRecoveryDialog
                hasDraft={draftRecovery.hasDraft}
                lastSavedAt={draftRecovery.lastSavedAt}
                onRestore={handleRestoreDraft}
                onDiscard={handleDiscardDraft}
              />

              {/* Streaming phase indicator */}
              {stream.phase !== 'idle' && (
                <StreamingPhaseIndicator
                  phase={stream.phase}
                  error={stream.error}
                  qualityScore={stream.qualityScore}
                  onCancel={stream.cancel}
                />
              )}

              {/* §I4 — the streamed answer renders natively via Streamdown
                  (streaming caret + clean partial/unterminated markdown),
                  DR-040 new-surface case. Shown only while a draft is
                  actively streaming in; the editor below receives the FINAL
                  text once the stream completes. */}
              {isStreaming && (
                <StreamingAnswerPreview
                  text={stream.text}
                  isStreaming={isStreaming}
                />
              )}

              {/* Editor */}
              <ResponseEditor
                content={editorContent}
                wordLimit={currentQuestion?.word_limit ?? null}
                onChange={setEditorContent}
                onSave={(markdown) => {
                  setEditorContent(markdown);
                  if (response?.id) {
                    handleActionWithRecovery('save');
                  }
                }}
                readOnly={!canEdit || isStreaming}
                placeholder={
                  isStreaming
                    ? 'Response is being drafted...'
                    : response
                      ? 'Edit your response...'
                      : 'No response yet. Use "Redraft" to draft a response or "Author Manually" to write your own.'
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
                  key={currentQuestion?.id}
                  citations={response.citations ?? []}
                  sourceContent={response.source_content ?? []}
                  orphanedSourceIds={orphanedSourceIds}
                  onCitationClick={handleCitationClick}
                  defaultExpanded={citationDefaultExpanded}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );

  return (
    <ProcurementContextProvider procurementId={id}>
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
        procurementId={id}
        responseId={response?.id ?? null}
        currentVersion={response?.version ?? 1}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestored={() => {
          void fetchResponse();
          void fetchProcurementData();
        }}
      />
    </ProcurementContextProvider>
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
