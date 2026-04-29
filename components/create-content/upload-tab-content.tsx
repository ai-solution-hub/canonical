'use client';

import { useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Upload,
  Layers,
  Check,
  ChevronDown,
  Loader2,
  CheckCircle,
  XCircle,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileUpload } from '@/components/create-content/file-upload';
import { IngestionProgress } from '@/components/create-content/ingestion-progress';
import { DedupWarning } from '@/components/shared/dedup-warning';
import { ReuploadBanner } from '@/components/source-document/reupload-banner';
import { UploadReviewStep } from '@/components/create-content/upload-review-step';
import { QAPreviewList } from '@/components/qa/qa-preview-list';
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';
import { MarkdownAnalysisTable } from '@/components/ingest/markdown-analysis-table';
import { ImportSummaryCard } from '@/components/ingest/import-summary-card';
import { generateIngestDocumentPrompt } from '@/lib/claude-prompts';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { useFileUploadPipeline } from '@/hooks/use-file-upload-pipeline';
import {
  analyseMarkdownBatch,
  importMarkdownBatch,
  fetchPipelineRun,
  type MarkdownPerFileOverrideWire,
} from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/query-keys';
import type { QACreateInput } from '@/lib/quality/qa-detection';
import type { DedupCheckResult } from '@/components/qa/qa-preview-list';
import type {
  MarkdownIngestAnalysis,
  MarkdownPerFileOverride,
  MarkdownBatchResultsSummary,
} from '@/types/ingest';

// Stable empty defaults per G14 — avoid recreating per render.
const EMPTY_OVERRIDES: MarkdownPerFileOverride[] = [];
const EMPTY_ANALYSES: MarkdownIngestAnalysis[] = [];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UploadTabContentProps {
  /** Navigate to another tab (e.g. 'write' or 'url') */
  onSwitchTab?: (tab: string) => void;
  /** Pre-detected Q&A pairs to show in the preview list. */
  detectedQAPairs?: QACreateInput[];
  /** Source document ID to link batch-created items to. */
  sourceDocumentId?: string;
  /**
   * Caller's role — gates admin-only controls inside the markdown-batch
   * surface (per-row skip-dedup checkbox + batch-wide auto-supersede toggle).
   * Defaults to 'editor' so admin-only controls stay hidden until the
   * caller plumbs the role through.
   */
  userRole?: 'admin' | 'editor' | 'viewer';
}

/** Sub-state for the markdown-batch surface (spec §6.1). */
type MarkdownBatchPhase =
  | 'idle'
  | 'analysing'
  | 'reviewing'
  | 'importing'
  | 'done';

/** Result of the markdown-batch import phase, surfaced in the summary card. */
interface MarkdownBatchResult {
  pipeline_run_id: string;
  results_summary: MarkdownBatchResultsSummary;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UploadTabContent({
  onSwitchTab,
  detectedQAPairs,
  sourceDocumentId,
  userRole = 'editor',
}: UploadTabContentProps) {
  const { layers, getLayerLabel } = useLayerVocabulary();

  const pipeline = useFileUploadPipeline();

  const {
    phase,
    files,
    fileStates,
    isUploading,
    reviewItems,
    handleFilesAdded,
    handleFileRemoved,
    handleUpload: rawHandleUpload,
    reset,
    setPhase,
    setReviewItems,
    handleSetLayerMode,
    handleSetSelectedLayer,
    handleDismissDedupWarning,
    pendingCount,
    hasResults,
    hasActiveUploads,
  } = pipeline;

  // ---------------------------------------------------------------------------
  // Markdown-batch sub-mode (spec §6.1, EP2 §1.11 Phase 2)
  // ---------------------------------------------------------------------------
  // Detection: every dropped file has a `.md` extension AND there is more
  // than one file. Single-`.md` drops continue to flow through EP3 (the
  // user-toggle preview flag is post-EP2 and is NOT wired in this session).

  /** Whether the dropped files trigger the markdown-batch surface. */
  const isMarkdownBatch = useMemo(
    () =>
      files.length > 1 &&
      files.every((f) => f.file.name.toLowerCase().endsWith('.md')),
    [files],
  );

  /**
   * Whether the dropped batch is a mixed type set (some `.md` + some non-md).
   * Surfaces the §4.1 fall-back banner.
   */
  const isMixedBatch = useMemo(
    () =>
      files.length > 1 &&
      files.some((f) => f.file.name.toLowerCase().endsWith('.md')) &&
      files.some((f) => !f.file.name.toLowerCase().endsWith('.md')),
    [files],
  );

  const [mdPhase, setMdPhase] = useState<MarkdownBatchPhase>('idle');
  const [mdAnalyses, setMdAnalyses] = useState<MarkdownIngestAnalysis[]>(
    EMPTY_ANALYSES,
  );
  const [mdOverrides, setMdOverrides] = useState<MarkdownPerFileOverride[]>(
    EMPTY_OVERRIDES,
  );
  const [mdAutoSupersede, setMdAutoSupersede] = useState<boolean>(false);
  const [mdResult, setMdResult] = useState<MarkdownBatchResult | null>(null);

  // Pattern E (S212 W2): client generates pipeline_run_id BEFORE the import
  // mutation fires so the polling query can target /api/pipeline-runs/[id]
  // immediately. Cleared when the mutation settles or the surface resets.
  const [importPipelineRunId, setImportPipelineRunId] = useState<string | null>(
    null,
  );

  const safeMdAnalyses = useMemo(
    () => mdAnalyses ?? EMPTY_ANALYSES,
    [mdAnalyses],
  );
  const safeMdOverrides = useMemo(
    () => mdOverrides ?? EMPTY_OVERRIDES,
    [mdOverrides],
  );

  /** Reset markdown-batch substate. */
  const resetMarkdownBatch = useCallback(() => {
    setMdPhase('idle');
    setMdAnalyses(EMPTY_ANALYSES);
    setMdOverrides(EMPTY_OVERRIDES);
    setMdAutoSupersede(false);
    setMdResult(null);
    setImportPipelineRunId(null);
  }, []);

  const analyseMutation = useMutation({
    mutationFn: async (rawFiles: File[]) => analyseMarkdownBatch(rawFiles),
    onMutate: () => {
      setMdPhase('analysing');
    },
    onSuccess: (data) => {
      setMdAnalyses(data.analysis);
      setMdPhase('reviewing');
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'Markdown analysis failed';
      toast.error(message);
      setMdPhase('idle');
    },
  });

  const importMutation = useMutation({
    mutationFn: async (args: {
      rawFiles: File[];
      options: {
        per_file_overrides?: MarkdownPerFileOverrideWire[];
        batch?: { auto_supersede?: boolean };
        pipeline_run_id: string;
      };
    }) =>
      importMarkdownBatch({ files: args.rawFiles, options: args.options }),
    onMutate: () => {
      setMdPhase('importing');
    },
    onSuccess: (data) => {
      setMdResult({
        pipeline_run_id: data.pipeline_run_id,
        results_summary: data.results_summary,
      });
      setMdPhase('done');
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'Markdown import failed';
      toast.error(message);
      setMdPhase('reviewing');
    },
    onSettled: () => {
      // Stop polling once the mutation resolves (success OR error). The
      // final summary card consumes the resolved `data` payload directly,
      // so we no longer need /api/pipeline-runs/[id] data after settle.
      setImportPipelineRunId(null);
    },
  });

  // Pattern E (S212 W2) — poll the pipeline_runs row mid-flight so the
  // importing-phase UI can surface the running detail string +
  // files_completed/files_total without waiting for the mutation to resolve.
  // Polling is gated on `mdPhase === 'importing'` and a non-null id; the
  // fetcher tolerates 404 (returns null) for the racy at-start window
  // where the server's INSERT hasn't landed yet (~sub-100ms after send).
  // 1500 ms refetch cadence — fast enough for ~80-100 s imports to feel
  // alive without hammering the API.
  const { data: pipelineRun } = useQuery({
    queryKey: queryKeys.pipelineRuns.detail(importPipelineRunId ?? ''),
    queryFn: () =>
      importPipelineRunId
        ? fetchPipelineRun(importPipelineRunId).catch(() => null)
        : null,
    enabled: !!importPipelineRunId && mdPhase === 'importing',
    refetchInterval: 1500,
  });

  // Destructure mutate functions to keep useCallback dep arrays referentially
  // stable (TanStack Query mutation objects are NOT stable per render — see
  // ESLint rule @tanstack/query/no-unstable-deps).
  const { mutate: analyseMutate, isPending: analyseIsPending } =
    analyseMutation;
  const { mutate: importMutate, isPending: importIsPending } = importMutation;

  const handleAnalyseMarkdownBatch = useCallback(() => {
    const rawFiles = files.map((f) => f.file);
    analyseMutate(rawFiles);
  }, [files, analyseMutate]);

  const handleImportMarkdownBatch = useCallback(() => {
    const rawFiles = files.map((f) => f.file);
    const perFileOverrides: MarkdownPerFileOverrideWire[] = safeMdOverrides
      .map((o) => {
        const wire: MarkdownPerFileOverrideWire = { filename: o.filename };
        if (o.excluded !== undefined) wire.excluded = o.excluded;
        if (o.draftOrFinal) wire.draft_or_final = o.draftOrFinal;
        // Editors silently lose `skip_dedup` per spec §8.2 — but we forward
        // it here when set; the orchestrator drops it for non-admin callers.
        if (o.skipDedup !== undefined) wire.skip_dedup = o.skipDedup;
        return wire;
      })
      .filter(
        (o) =>
          o.excluded !== undefined ||
          o.draft_or_final !== undefined ||
          o.skip_dedup !== undefined,
      );

    // Pattern E (S212 W2): generate the pipeline_run_id BEFORE firing
    // the mutation so polling against /api/pipeline-runs/[id] can begin
    // immediately. The server's at-start INSERT adopts this id verbatim.
    const pipelineRunId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : // jsdom fallback for tests / pre-Node-19 environments
          `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setImportPipelineRunId(pipelineRunId);

    importMutate({
      rawFiles,
      options: {
        per_file_overrides:
          perFileOverrides.length > 0 ? perFileOverrides : undefined,
        batch: mdAutoSupersede ? { auto_supersede: true } : undefined,
        pipeline_run_id: pipelineRunId,
      },
    });
  }, [files, safeMdOverrides, mdAutoSupersede, importMutate]);

  const handleMarkdownImportAnother = useCallback(() => {
    resetMarkdownBatch();
    reset();
  }, [resetMarkdownBatch, reset]);

  const handleMarkdownDone = useCallback(() => {
    resetMarkdownBatch();
    reset();
  }, [resetMarkdownBatch, reset]);

  // ---------------------------------------------------------------------------
  // Q&A batch creation state
  // ---------------------------------------------------------------------------

  /** Tracks whether we are in the Q&A preview/batch creation flow. */
  const [qaPairs, setQaPairs] = useState<QACreateInput[] | null>(
    detectedQAPairs ?? null,
  );
  const [qaSourceDocumentId, setQaSourceDocumentId] = useState<
    string | undefined
  >(sourceDocumentId);
  const [qaBatchProgress, setQaBatchProgress] = useState<{
    isCreating: boolean;
    created: number;
    failed: number;
    total: number;
    items: Array<{ id: string; title: string; status: 'created' | 'failed' }>;
    batchId?: string;
  } | null>(null);

  /** Handle Q&A pair confirmation from the preview list. */
  const handleQAConfirm = useCallback(
    async (confirmedPairs: QACreateInput[]) => {
      if (confirmedPairs.length === 0) return;

      setQaBatchProgress({
        isCreating: true,
        created: 0,
        failed: 0,
        total: confirmedPairs.length,
        items: [],
      });

      try {
        const res = await fetch('/api/items/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: confirmedPairs,
            source_document_id: qaSourceDocumentId,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Batch creation failed');
        }

        setQaBatchProgress({
          isCreating: false,
          created: data.created ?? 0,
          failed: data.failed ?? 0,
          total: confirmedPairs.length,
          items: data.items ?? [],
          batchId: data.batch_id,
        });

        if (data.failed === 0) {
          toast.success(
            `${data.created} Q&A item${data.created !== 1 ? 's' : ''} created`,
          );
        } else {
          toast.warning(`${data.created} created, ${data.failed} failed`);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Batch creation failed';
        toast.error(message);
        setQaBatchProgress((prev) =>
          prev ? { ...prev, isCreating: false } : null,
        );
      }
    },
    [qaSourceDocumentId],
  );

  /** Handle skipping Q&A detection — dismiss preview and return to upload. */
  const handleQASkip = useCallback(() => {
    setQaPairs(null);
    setQaSourceDocumentId(undefined);
    setQaBatchProgress(null);
  }, []);

  /** Handle dedup check for a single Q&A pair. */
  const handleQADedupCheck = useCallback(
    async (text: string): Promise<DedupCheckResult> => {
      try {
        const res = await fetch('/api/dedup/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (!res.ok) {
          return { isDuplicate: false, matches: [], error: true };
        }

        const data = await res.json();
        return {
          isDuplicate: data.isDuplicate ?? false,
          matches: data.matches ?? [],
        };
      } catch {
        return { isDuplicate: false, matches: [], error: true };
      }
    },
    [],
  );

  /** Reset Q&A batch state and return to initial upload view. */
  const handleQABatchDismiss = useCallback(() => {
    setQaPairs(null);
    setQaSourceDocumentId(undefined);
    setQaBatchProgress(null);
    reset();
  }, [reset]);

  // Wrap handleUpload to manage phase transitions and toast messages
  const handleUpload = useCallback(async () => {
    const result = await rawHandleUpload();
    if (!result) return;

    const { successfulItems, errorCount, skipReview } = result;

    if (successfulItems.length > 0 && errorCount === 0) {
      if (skipReview) {
        toast.success(
          `${successfulItems.length} file${successfulItems.length !== 1 ? 's' : ''} uploaded and published`,
        );
        setPhase('select');
      } else {
        setReviewItems(successfulItems);
        setPhase('review');
      }
    } else if (successfulItems.length > 0 && errorCount > 0) {
      toast.warning(`${successfulItems.length} uploaded, ${errorCount} failed`);
      if (!skipReview) {
        setReviewItems(successfulItems);
        setPhase('review');
      } else {
        setPhase('select');
      }
    } else if (errorCount > 0) {
      toast.error(
        `${errorCount} file${errorCount !== 1 ? 's' : ''} failed to upload`,
      );
      setPhase('select');
    }
  }, [rawHandleUpload, setPhase, setReviewItems]);

  // Review step handlers
  const handlePublishItem = useCallback(async (itemId: string) => {
    const res = await fetch(`/api/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: 'governance_review_status', value: null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to publish item');
    }
    toast.success('Item published');
  }, []);

  const handlePublishAll = useCallback(async () => {
    const activeItems = reviewItems;

    const results = await Promise.allSettled(
      activeItems.map((item) => handlePublishItem(item.id)),
    );

    const failCount = results.filter((r) => r.status === 'rejected').length;
    if (failCount > 0) {
      toast.warning(
        `${activeItems.length - failCount} published, ${failCount} failed`,
      );
    } else {
      toast.success(
        `${activeItems.length} item${activeItems.length !== 1 ? 's' : ''} published`,
      );
    }
  }, [reviewItems, handlePublishItem]);

  const handleDiscardItem = useCallback(async (itemId: string) => {
    const res = await fetch(`/api/items/${itemId}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Discarded during upload review' }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to discard item');
    }
    toast.success('Item discarded');
  }, []);

  const handleEditItem = useCallback((itemId: string) => {
    window.open(`/item/${itemId}`, '_blank');
  }, []);

  const handleReviewDismiss = useCallback(() => {
    reset();
  }, [reset]);

  // Layer application handler
  const handleApplyLayer = useCallback(
    async (fileId: string, layerKey: string) => {
      const file = files.find((f) => f.id === fileId);
      const resultId = file?.resultId;
      if (!resultId) return;

      try {
        const res = await fetch(`/api/items/${resultId}/metadata`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layer: layerKey }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update layer');
        }
        handleSetLayerMode(fileId, 'applied');
        // Update applied layer label in fileStates directly — the hook
        // does not track this since it needs getLayerLabel from the context
        toast.success(`Layer set to ${getLayerLabel(layerKey)}`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to update layer',
        );
      }
    },
    [files, getLayerLabel, handleSetLayerMode],
  );

  // ---------------------------------------------------------------------------
  // Render: Q&A batch progress (after creation starts)
  // ---------------------------------------------------------------------------

  if (qaBatchProgress && !qaBatchProgress.isCreating) {
    return (
      <div
        className="mx-auto max-w-2xl space-y-4"
        data-testid="qa-batch-complete"
      >
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle
              className="size-5 text-quality-good"
              aria-hidden="true"
            />
            <h3 className="text-lg font-semibold text-foreground">
              Batch creation complete
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            {qaBatchProgress.created} item
            {qaBatchProgress.created !== 1 ? 's' : ''} created
            {qaBatchProgress.failed > 0 && (
              <span className="text-status-warning">
                {' '}
                ({qaBatchProgress.failed} failed)
              </span>
            )}
          </p>
          {/* Item list */}
          <div className="max-h-60 overflow-y-auto space-y-1">
            {qaBatchProgress.items.map((item, idx) => (
              <div
                key={item.id || idx}
                className="flex items-center gap-2 text-sm"
              >
                {item.status === 'created' ? (
                  <CheckCircle
                    className="size-3.5 shrink-0 text-quality-good"
                    aria-hidden="true"
                  />
                ) : (
                  <XCircle
                    className="size-3.5 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={
                    item.status === 'created'
                      ? 'text-foreground'
                      : 'text-muted-foreground line-through'
                  }
                >
                  {item.title}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <Button variant="outline" size="sm" onClick={handleQABatchDismiss}>
              Done
            </Button>
            <Button size="sm" onClick={() => window.open('/browse', '_blank')}>
              View in Browse
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (qaBatchProgress?.isCreating) {
    return (
      <div
        className="mx-auto max-w-2xl space-y-4"
        data-testid="qa-batch-progress"
      >
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Loader2
              className="size-5 animate-spin text-primary"
              aria-hidden="true"
            />
            <h3 className="text-lg font-semibold text-foreground">
              Creating Q&A items...
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Processing {qaBatchProgress.total} item
            {qaBatchProgress.total !== 1 ? 's' : ''}. This may take a few
            minutes.
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{
                width: `${Math.max(5, (qaBatchProgress.created / qaBatchProgress.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Q&A preview phase
  // ---------------------------------------------------------------------------

  if (qaPairs && qaPairs.length > 0) {
    return (
      <div className="mx-auto max-w-2xl" data-testid="qa-preview-phase">
        <QAPreviewList
          pairs={qaPairs}
          onConfirm={handleQAConfirm}
          onSkip={handleQASkip}
          onDedupCheck={handleQADedupCheck}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Review phase
  // ---------------------------------------------------------------------------

  if (phase === 'review' && reviewItems.length > 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <UploadReviewStep
          items={reviewItems}
          onPublish={handlePublishItem}
          onPublishAll={handlePublishAll}
          onDiscard={handleDiscardItem}
          onEditItem={handleEditItem}
          onDismiss={handleReviewDismiss}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Markdown-batch sub-mode (spec §6.1) — done state
  // ---------------------------------------------------------------------------

  if (mdPhase === 'done' && mdResult) {
    return (
      <div
        className="mx-auto max-w-3xl space-y-4"
        data-testid="markdown-batch-done"
      >
        <ImportSummaryCard
          pipelineRunId={mdResult.pipeline_run_id}
          resultsSummary={mdResult.results_summary}
          onImportAnother={handleMarkdownImportAnother}
          onDone={handleMarkdownDone}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Markdown-batch sub-mode — analysing / reviewing / importing
  // ---------------------------------------------------------------------------

  if (
    isMarkdownBatch &&
    (mdPhase === 'analysing' || mdPhase === 'reviewing' || mdPhase === 'importing')
  ) {
    return (
      <div
        className="mx-auto max-w-4xl space-y-4"
        data-testid="markdown-batch-active"
      >
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Upload className="size-5" aria-hidden="true" />
            Markdown batch — {files.length} file
            {files.length === 1 ? '' : 's'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pre-flight analysis runs front-matter, encoding, and dedup checks
            before the import pipeline.
          </p>
        </div>

        {mdPhase === 'analysing' && (
          <div
            className="flex items-center gap-2 rounded-md border border-border bg-card p-6 text-sm text-muted-foreground"
            data-testid="markdown-batch-analysing"
          >
            <Loader2
              className="size-4 animate-spin text-primary"
              aria-hidden="true"
            />
            Analysing {files.length} file{files.length === 1 ? '' : 's'}
            &hellip;
          </div>
        )}

        {mdPhase === 'reviewing' && (
          <>
            <MarkdownAnalysisTable
              analyses={safeMdAnalyses}
              overrides={safeMdOverrides}
              autoSupersede={mdAutoSupersede}
              role={userRole}
              onChangeOverrides={setMdOverrides}
              onChangeAutoSupersede={setMdAutoSupersede}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  resetMarkdownBatch();
                  reset();
                }}
                data-testid="markdown-batch-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={handleImportMarkdownBatch}
                data-testid="markdown-batch-import"
                disabled={importIsPending}
              >
                Import
              </Button>
            </div>
          </>
        )}

        {mdPhase === 'importing' && (
          <div
            className="space-y-2 rounded-md border border-border bg-card p-6 text-sm"
            data-testid="markdown-batch-importing"
          >
            <div className="flex items-center gap-2 text-foreground">
              <Loader2
                className="size-4 animate-spin text-primary"
                aria-hidden="true"
              />
              <span className="font-medium">Importing markdown batch</span>
            </div>
            {/* Pattern E poll-driven detail — the polling query updates
                this every 1.5s while the orchestrator runs. Pre-row-arrival
                fallback ("Starting…") covers the racy ~sub-100ms window
                where the server's at-start INSERT hasn't landed yet. */}
            {pipelineRun?.progress?.detail ? (
              <p
                className="text-muted-foreground"
                data-testid="markdown-batch-importing-detail"
              >
                {pipelineRun.progress.detail}
              </p>
            ) : (
              <p
                className="text-muted-foreground"
                data-testid="markdown-batch-importing-detail"
              >
                Starting&hellip;
              </p>
            )}
            {typeof pipelineRun?.progress?.files_completed === 'number' &&
              typeof pipelineRun?.progress?.files_total === 'number' && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="markdown-batch-importing-counts"
                >
                  {pipelineRun.progress.files_completed} /{' '}
                  {pipelineRun.progress.files_total} files
                </p>
              )}
            <p className="text-xs text-muted-foreground">
              Imports of {files.length} file{files.length === 1 ? '' : 's'}{' '}
              typically take 80&ndash;100 seconds.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Upload phase (select + uploading)
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Upload className="size-5" aria-hidden="true" />
          Upload Documents
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload PDF, DOCX, Markdown, or text files. They will be processed
          through the pipeline for classification and embedding.
        </p>
      </div>

      <FileUpload
        files={files}
        onFilesAdded={handleFilesAdded}
        onFileRemoved={handleFileRemoved}
      />

      {/* Mixed-batch fallback banner (spec §4.1 lines 344-347). */}
      {isMixedBatch && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
          data-testid="markdown-batch-mixed-banner"
        >
          <Info
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span>
            Tip: drop only .md files together to use the markdown batch
            review surface.
          </span>
        </div>
      )}

      {/* Markdown-batch idle CTA — pre-analyse. */}
      {isMarkdownBatch && mdPhase === 'idle' && (
        <div
          className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm"
          data-testid="markdown-batch-idle-banner"
        >
          <div>
            <p className="font-medium text-foreground">
              Markdown batch detected ({files.length} files)
            </p>
            <p className="text-xs text-muted-foreground">
              Run pre-flight analysis to review front-matter, encoding, and
              dedup verdicts before importing.
            </p>
          </div>
          <Button
            onClick={handleAnalyseMarkdownBatch}
            disabled={analyseIsPending}
            data-testid="markdown-batch-analyse-button"
          >
            Analyse files
          </Button>
        </div>
      )}

      {/* Per-file pipeline progress */}
      {files.some((f) => f.status !== 'pending') && (
        <div className="space-y-3" data-testid="file-progress-section">
          {files
            .filter((f) => f.status !== 'pending')
            .map((f) => {
              const state = fileStates[f.id];
              if (!state) return null;

              return (
                <div key={f.id} className="space-y-2">
                  <p className="truncate text-xs font-medium text-muted-foreground">
                    {f.file.name}
                  </p>
                  <IngestionProgress
                    compact={
                      files.filter((x) => x.status !== 'pending').length > 1
                    }
                    steps={state.steps}
                    warnings={f.status === 'done' ? state.warnings : undefined}
                  />
                  {/* Re-upload detection banner per file */}
                  {f.status === 'done' && state.reuploadInfo && (
                    <ReuploadBanner
                      matchType={state.reuploadInfo.matchType}
                      previousVersion={state.reuploadInfo.previousVersion}
                      previousDocumentId={state.reuploadInfo.previousDocumentId}
                      diffAvailable={state.reuploadInfo.diffAvailable}
                      diffDocumentId={state.reuploadInfo.newDocumentId}
                    />
                  )}
                  {/* Dedup warning per file */}
                  {state.showDedupWarning && state.dedupMatches.length > 0 && (
                    <DedupWarning
                      matches={state.dedupMatches}
                      onViewMatch={(id) => window.open(`/item/${id}`, '_blank')}
                      onDismiss={() => handleDismissDedupWarning(f.id)}
                    />
                  )}
                  {/* Layer suggestion per file */}
                  {f.status === 'done' && state.suggestedLayer && (
                    <div
                      className="flex flex-wrap items-center gap-1.5 text-xs"
                      data-testid={`layer-suggestion-${f.id}`}
                    >
                      <Layers
                        className="size-3 text-primary"
                        aria-hidden="true"
                      />
                      {state.layerMode === 'applied' ? (
                        <span className="text-muted-foreground">
                          Layer:{' '}
                          <span className="font-medium text-foreground">
                            {state.appliedLayerLabel}
                          </span>
                        </span>
                      ) : state.layerMode === 'change' ? (
                        <>
                          <Select
                            value={state.selectedLayer}
                            onValueChange={(val) =>
                              handleSetSelectedLayer(f.id, val)
                            }
                          >
                            <SelectTrigger
                              className="h-6 w-36 text-xs"
                              aria-label="Select a layer"
                            >
                              <SelectValue placeholder="Select layer..." />
                            </SelectTrigger>
                            <SelectContent>
                              {layers.map((layer) => (
                                <SelectItem key={layer.key} value={layer.key}>
                                  {layer.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 gap-1 px-1.5 text-xs"
                            onClick={() =>
                              handleApplyLayer(f.id, state.selectedLayer)
                            }
                          >
                            <Check className="size-3" aria-hidden="true" />
                            Apply
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-xs"
                            onClick={() => handleSetLayerMode(f.id, 'suggest')}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="text-muted-foreground">
                            Layer:{' '}
                            <span className="font-medium text-foreground">
                              {getLayerLabel(
                                state.suggestedLayer.suggestedLayer,
                              )}
                            </span>
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 gap-1 px-1.5 text-xs"
                            onClick={() => handleSetLayerMode(f.id, 'change')}
                            aria-label="Change layer"
                          >
                            <ChevronDown
                              className="size-3"
                              aria-hidden="true"
                            />
                            Change
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2">
        {hasResults && !isUploading && (
          <Button variant="outline" onClick={() => reset()}>
            Clear
          </Button>
        )}
        <Button
          onClick={handleUpload}
          disabled={pendingCount === 0 || isUploading}
        >
          {isUploading || hasActiveUploads
            ? 'Processing\u2026'
            : `Upload ${pendingCount > 0 ? `(${pendingCount})` : ''}`}
        </Button>
      </div>

      {/* Cross-method suggestions and Claude prompt */}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-center">
          <ClaudePromptButton
            prompt={generateIngestDocumentPrompt().prompt}
            label="Open in Claude"
            size="sm"
          />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          {onSwitchTab && (
            <>
              Or{' '}
              <button
                type="button"
                onClick={() => onSwitchTab('url')}
                className="rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                import from a URL
              </button>
              {' \u2022 '}
              <button
                type="button"
                onClick={() => onSwitchTab('write')}
                className="rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                write it manually
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
