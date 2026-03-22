'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { Upload, Layers, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileUpload } from '@/components/file-upload';
import { IngestionProgress } from '@/components/ingestion-progress';
import { DedupWarning } from '@/components/dedup-warning';
import { ReuploadBanner } from '@/components/reupload-banner';
import { UploadReviewStep, type UploadReviewItem } from '@/components/upload-review-step';
import { ClaudePromptButton } from '@/components/claude-prompt-button';
import { generateIngestDocumentPrompt } from '@/lib/claude-prompts';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { useFileUploadPipeline } from '@/hooks/use-file-upload-pipeline';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UploadTabContentProps {
  /** Navigate to another tab (e.g. 'write' or 'url') */
  onSwitchTab?: (tab: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UploadTabContent({ onSwitchTab }: UploadTabContentProps) {
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
    getSkipReview,
  } = pipeline;

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
            label="Or let Claude handle complex documents"
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
