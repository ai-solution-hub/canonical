'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Upload, Layers, Check, ChevronDown, Loader2, CheckCircle, XCircle } from 'lucide-react';
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
import { generateIngestDocumentPrompt } from '@/lib/claude-prompts';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { useFileUploadPipeline } from '@/hooks/use-file-upload-pipeline';
import type { QACreateInput } from '@/lib/quality/qa-detection';
import type { DedupCheckResult } from '@/components/qa/qa-preview-list';

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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UploadTabContent({ onSwitchTab, detectedQAPairs, sourceDocumentId }: UploadTabContentProps) {
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
  // Q&A batch creation state
  // ---------------------------------------------------------------------------

  /** Tracks whether we are in the Q&A preview/batch creation flow. */
  const [qaPairs, setQaPairs] = useState<QACreateInput[] | null>(detectedQAPairs ?? null);
  const [qaSourceDocumentId, setQaSourceDocumentId] = useState<string | undefined>(sourceDocumentId);
  const [qaBatchProgress, setQaBatchProgress] = useState<{
    isCreating: boolean;
    created: number;
    failed: number;
    total: number;
    items: Array<{ id: string; title: string; status: 'created' | 'failed' }>;
    batchId?: string;
  } | null>(null);

  /** Handle Q&A pair confirmation from the preview list. */
  const handleQAConfirm = useCallback(async (confirmedPairs: QACreateInput[]) => {
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
        toast.success(`${data.created} Q&A item${data.created !== 1 ? 's' : ''} created`);
      } else {
        toast.warning(`${data.created} created, ${data.failed} failed`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch creation failed';
      toast.error(message);
      setQaBatchProgress((prev) =>
        prev ? { ...prev, isCreating: false } : null,
      );
    }
  }, [qaSourceDocumentId]);

  /** Handle skipping Q&A detection — dismiss preview and return to upload. */
  const handleQASkip = useCallback(() => {
    setQaPairs(null);
    setQaSourceDocumentId(undefined);
    setQaBatchProgress(null);
  }, []);

  /** Handle dedup check for a single Q&A pair. */
  const handleQADedupCheck = useCallback(async (text: string): Promise<DedupCheckResult> => {
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
  }, []);

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
      toast.error(`${errorCount} file${errorCount !== 1 ? 's' : ''} failed to upload`);
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
      toast.warning(`${activeItems.length - failCount} published, ${failCount} failed`);
    } else {
      toast.success(`${activeItems.length} item${activeItems.length !== 1 ? 's' : ''} published`);
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
  const handleApplyLayer = useCallback(async (fileId: string, layerKey: string) => {
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
  }, [files, getLayerLabel, handleSetLayerMode]);

  // ---------------------------------------------------------------------------
  // Render: Q&A batch progress (after creation starts)
  // ---------------------------------------------------------------------------

  if (qaBatchProgress && !qaBatchProgress.isCreating) {
    return (
      <div className="mx-auto max-w-2xl space-y-4" data-testid="qa-batch-complete">
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="size-5 text-quality-good" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-foreground">
              Batch creation complete
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            {qaBatchProgress.created} item{qaBatchProgress.created !== 1 ? 's' : ''} created
            {qaBatchProgress.failed > 0 && (
              <span className="text-status-warning">
                {' '}({qaBatchProgress.failed} failed)
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
                  <CheckCircle className="size-3.5 shrink-0 text-quality-good" aria-hidden="true" />
                ) : (
                  <XCircle className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                )}
                <span className={item.status === 'created' ? 'text-foreground' : 'text-muted-foreground line-through'}>
                  {item.title}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <Button variant="outline" size="sm" onClick={handleQABatchDismiss}>
              Done
            </Button>
            <Button
              size="sm"
              onClick={() => window.open('/browse', '_blank')}
            >
              View in Browse
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (qaBatchProgress?.isCreating) {
    return (
      <div className="mx-auto max-w-2xl space-y-4" data-testid="qa-batch-progress">
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-foreground">
              Creating Q&A items...
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Processing {qaBatchProgress.total} item{qaBatchProgress.total !== 1 ? 's' : ''}. This may take a few minutes.
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.max(5, (qaBatchProgress.created / qaBatchProgress.total) * 100)}%` }}
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
                    compact={files.filter((x) => x.status !== 'pending').length > 1}
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
                    <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid={`layer-suggestion-${f.id}`}>
                      <Layers className="size-3 text-primary" aria-hidden="true" />
                      {state.layerMode === 'applied' ? (
                        <span className="text-muted-foreground">
                          Layer: <span className="font-medium text-foreground">{state.appliedLayerLabel}</span>
                        </span>
                      ) : state.layerMode === 'change' ? (
                        <>
                          <Select
                            value={state.selectedLayer}
                            onValueChange={(val) => handleSetSelectedLayer(f.id, val)}
                          >
                            <SelectTrigger className="h-6 w-36 text-xs" aria-label="Select a layer">
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
                            onClick={() => handleApplyLayer(f.id, state.selectedLayer)}
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
                              {getLayerLabel(state.suggestedLayer.suggestedLayer)}
                            </span>
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 gap-1 px-1.5 text-xs"
                            onClick={() => handleSetLayerMode(f.id, 'change')}
                            aria-label="Change layer"
                          >
                            <ChevronDown className="size-3" aria-hidden="true" />
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
          <Button
            variant="outline"
            onClick={() => reset()}
          >
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
            label="Open in Claude for complex documents"
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
