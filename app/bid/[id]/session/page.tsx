'use client';

import { useState, useEffect, useCallback, useRef, useMemo, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
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
import { BidCopilotActions } from '@/components/bid-copilot-actions';
import { BidCopilotSuggestions } from '@/components/bid-copilot-suggestions';
import { BidCopilotSidebar } from '@/components/bid-copilot-sidebar';
import { CopilotKitProvider } from '@/components/copilotkit-provider';
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
    editorRef.current = editorInstance;
  }, [editorInstance, editorRef]);
  return null;
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

  // Tiptap editor instance ref for Content Library insert
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

  // Editor ref for CopilotKit integration
  const editorContentRef = useRef<string>('');

  // Keep editor content ref in sync
  useEffect(() => {
    editorContentRef.current = editorContent;
  }, [editorContent]);

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
                      <Badge variant="secondary" className="text-[10px] tabular-nums">
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
    <CopilotKitProvider>
      <BidContextProvider bidId={id}>
        <BidContextSync questionId={currentQuestion?.id ?? null} editorInstance={editorInstanceRef.current} />
        <BidCopilotActions />
        <BidCopilotSuggestions />
        <BidCopilotSidebar bidName={bidName} buyerName={buyerName}>
          {sessionContent}
        </BidCopilotSidebar>
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
    </CopilotKitProvider>
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
