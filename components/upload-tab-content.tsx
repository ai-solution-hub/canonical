'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
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
import { FileUpload, type UploadFile } from '@/components/file-upload';
import { IngestionProgress, type IngestionStep } from '@/components/ingestion-progress';
import { DedupWarning, type DedupMatch } from '@/components/dedup-warning';
import { ReuploadBanner } from '@/components/reupload-banner';
import { UploadReviewStep, type UploadReviewItem } from '@/components/upload-review-step';
import { ClaudePromptButton } from '@/components/claude-prompt-button';
import { generateIngestDocumentPrompt } from '@/lib/claude-prompts';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-file pipeline steps matching the upload route's 5-step pipeline */
const UPLOAD_STEPS: IngestionStep[] = [
  { label: 'Uploading file', status: 'pending' },
  { label: 'Extracting text', status: 'pending' },
  { label: 'Generating embedding', status: 'pending' },
  { label: 'Classifying content', status: 'pending' },
  { label: 'Generating summary', status: 'pending' },
];

/** Interval between cosmetic step advances (ms) */
const STEP_ADVANCE_INTERVAL = 2500;

/** localStorage key for skip review preference */
const SKIP_REVIEW_KEY = 'kh_skip_upload_review';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UploadPhase = 'select' | 'uploading' | 'review';

/** Per-file layer suggestion info */
interface FileSuggestedLayer {
  suggestedLayer: string;
  reason: string;
  confidence: string;
}

/** Per-file re-upload detection info */
interface FileReuploadInfo {
  matchType: 'identical' | 'new_version';
  previousVersion: number;
  previousDocumentId: string;
  diffAvailable?: boolean;
  newDocumentId?: string;
}

/** Per-file state for progress and dedup tracking */
interface FileUploadState {
  steps: IngestionStep[];
  dedupMatches: DedupMatch[];
  showDedupWarning: boolean;
  warnings: string[];
  suggestedLayer?: FileSuggestedLayer;
  layerMode: 'suggest' | 'change' | 'applied';
  selectedLayer: string;
  appliedLayerLabel: string;
  reuploadInfo?: FileReuploadInfo;
  // Enriched response data for review step
  classification?: { domain: string; subtopic: string; confidence: number | null };
  aiSummary?: string;
  qualityScore?: number;
  contentType?: string;
}

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

let fileIdCounter = 0;

export function UploadTabContent({ onSwitchTab }: UploadTabContentProps) {
  const { layers, getLayerLabel } = useLayerVocabulary();
  const [phase, setPhase] = useState<UploadPhase>('select');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [fileStates, setFileStates] = useState<Record<string, FileUploadState>>({});
  const [reviewItems, setReviewItems] = useState<UploadReviewItem[]>([]);
  const stepTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // Check skip review preference
  const getSkipReview = useCallback((): boolean => {
    try {
      return localStorage.getItem(SKIP_REVIEW_KEY) === 'true';
    } catch {
      return false;
    }
  }, []);

  // Clean up all timers on unmount
  useEffect(() => {
    const timersRef = stepTimersRef;
    return () => {
      for (const timer of Object.values(timersRef.current)) {
        clearInterval(timer);
      }
    };
  }, []);

  const advanceStepsForFile = useCallback((fileId: string) => {
    setFileStates((prev) => {
      const state = prev[fileId];
      if (!state) return prev;

      const steps = state.steps;
      const activeIdx = steps.findIndex((s) => s.status === 'active');

      if (activeIdx === -1) {
        return {
          ...prev,
          [fileId]: {
            ...state,
            steps: steps.map((s, i) =>
              i === 0 ? { ...s, status: 'active' as const } : s,
            ),
          },
        };
      }
      if (activeIdx >= steps.length - 1) {
        return prev;
      }

      return {
        ...prev,
        [fileId]: {
          ...state,
          steps: steps.map((s, i) => {
            if (i === activeIdx) return { ...s, status: 'done' as const };
            if (i === activeIdx + 1) return { ...s, status: 'active' as const };
            return s;
          }),
        },
      };
    });
  }, []);

  const handleFilesAdded = useCallback((newFiles: File[]) => {
    const uploadFiles: UploadFile[] = newFiles.map((file) => ({
      id: `upload-${++fileIdCounter}`,
      file,
      status: 'pending' as const,
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...uploadFiles]);
  }, []);

  const handleFileRemoved = useCallback((fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    setFileStates((prev) => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
    if (stepTimersRef.current[fileId]) {
      clearInterval(stepTimersRef.current[fileId]);
      delete stepTimersRef.current[fileId];
    }
  }, []);

  const uploadSingleFile = useCallback(async (uploadFile: UploadFile, draftMode: boolean) => {
    const fileId = uploadFile.id;

    // Initialise per-file progress state
    setFileStates((prev) => ({
      ...prev,
      [fileId]: {
        steps: UPLOAD_STEPS.map((s, i) =>
          i === 0 ? { ...s, status: 'active' as const } : s,
        ),
        dedupMatches: [],
        showDedupWarning: false,
        warnings: [],
        layerMode: 'suggest',
        selectedLayer: '',
        appliedLayerLabel: '',
      },
    }));

    // Mark as uploading
    setFiles((prev) =>
      prev.map((f) =>
        f.id === fileId ? { ...f, status: 'uploading' as const, progress: 10 } : f,
      ),
    );

    // Start cosmetic step advancement
    stepTimersRef.current[fileId] = setInterval(
      () => advanceStepsForFile(fileId),
      STEP_ADVANCE_INTERVAL,
    );

    try {
      const formData = new FormData();
      formData.append('file', uploadFile.file);
      if (draftMode) {
        formData.append('draft', 'true');
      }

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      // Stop cosmetic timer
      if (stepTimersRef.current[fileId]) {
        clearInterval(stepTimersRef.current[fileId]);
        delete stepTimersRef.current[fileId];
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      // Mark all steps as done
      const layerData: FileSuggestedLayer | undefined = data.suggested_layer ?? undefined;

      // Capture re-upload detection info
      const reuploadData: FileReuploadInfo | undefined = data.reupload_detection
        ? {
            matchType: data.reupload_detection.match_type,
            previousVersion: data.reupload_detection.previous_version,
            previousDocumentId: data.reupload_detection.previous_document_id,
            diffAvailable: data.diff_available ?? false,
            newDocumentId: data.source_document_id ?? undefined,
          }
        : undefined;

      const dedupMatches: DedupMatch[] = (data.duplicate_matches ?? []).map(
        (m: { id: string; title: string; similarity: number; match_type?: string }) => ({
          id: m.id,
          title: m.title,
          similarity: m.similarity,
          match_type: m.match_type ?? 'near_duplicate',
        }),
      );

      setFileStates((prev) => {
        const state = prev[fileId];
        if (!state) return prev;

        return {
          ...prev,
          [fileId]: {
            ...state,
            steps: state.steps.map((s) => ({ ...s, status: 'done' as const })),
            warnings: data.warnings ?? [],
            dedupMatches,
            showDedupWarning: dedupMatches.length > 0,
            suggestedLayer: layerData,
            selectedLayer: layerData?.suggestedLayer ?? '',
            reuploadInfo: reuploadData,
            // Enriched data for review step
            classification: data.classification ?? undefined,
            aiSummary: data.ai_summary ?? undefined,
            qualityScore: data.quality_score ?? undefined,
            contentType: data.content_type ?? undefined,
          },
        };
      });

      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? {
                ...f,
                status: 'done' as const,
                progress: 100,
                resultId: data.id,
              }
            : f,
        ),
      );

      // Return data for review item construction
      return {
        id: data.id as string,
        title: (data.title as string) || uploadFile.file.name,
        contentType: (data.content_type as string) || 'other',
        classification: data.classification as { domain: string; subtopic: string; confidence: number | null } | undefined,
        aiSummary: data.ai_summary as string | undefined,
        qualityScore: data.quality_score as number | undefined,
        suggestedLayer: layerData,
        warnings: (data.warnings ?? []) as string[],
        dedupMatches,
      };
    } catch (err) {
      // Stop cosmetic timer
      if (stepTimersRef.current[fileId]) {
        clearInterval(stepTimersRef.current[fileId]);
        delete stepTimersRef.current[fileId];
      }

      const message = err instanceof Error ? err.message : 'Upload failed';

      setFileStates((prev) => {
        const state = prev[fileId];
        if (!state) return prev;
        return {
          ...prev,
          [fileId]: {
            ...state,
            steps: state.steps.map((s) =>
              s.status === 'active'
                ? { ...s, status: 'error' as const }
                : s,
            ),
          },
        };
      });

      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? { ...f, status: 'error' as const, progress: 0, error: message }
            : f,
        ),
      );

      return null;
    }
  }, [advanceStepsForFile]);

  const handleUpload = useCallback(async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending');
    if (pendingFiles.length === 0) return;

    const skipReview = getSkipReview();
    const draftMode = !skipReview;

    setIsUploading(true);
    setPhase('uploading');

    // Upload all pending files in parallel
    const results = await Promise.allSettled(
      pendingFiles.map((f) => uploadSingleFile(f, draftMode)),
    );

    setIsUploading(false);

    // Collect successful results for review
    const successfulItems: UploadReviewItem[] = [];
    let errorCount = 0;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        successfulItems.push(result.value);
      } else {
        errorCount++;
      }
    }

    // Toast feedback
    if (successfulItems.length > 0 && errorCount === 0) {
      if (skipReview) {
        toast.success(
          `${successfulItems.length} file${successfulItems.length !== 1 ? 's' : ''} uploaded and published`,
        );
        setPhase('select');
      } else {
        // Transition to review phase
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
  }, [files, getSkipReview, uploadSingleFile]);

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
    // Publish all review items — the review step manages its own published/discarded state
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
    setPhase('select');
    setFiles([]);
    setFileStates({});
    setReviewItems([]);
  }, []);

  // Layer management handlers
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
      setFileStates((prev) => {
        const state = prev[fileId];
        if (!state) return prev;
        return {
          ...prev,
          [fileId]: {
            ...state,
            layerMode: 'applied',
            appliedLayerLabel: getLayerLabel(layerKey),
          },
        };
      });
      toast.success(`Layer set to ${getLayerLabel(layerKey)}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update layer',
      );
    }
  }, [files, getLayerLabel]);

  const handleSetLayerMode = useCallback((fileId: string, mode: 'suggest' | 'change' | 'applied') => {
    setFileStates((prev) => {
      const state = prev[fileId];
      if (!state) return prev;
      return { ...prev, [fileId]: { ...state, layerMode: mode } };
    });
  }, []);

  const handleSetSelectedLayer = useCallback((fileId: string, layerKey: string) => {
    setFileStates((prev) => {
      const state = prev[fileId];
      if (!state) return prev;
      return { ...prev, [fileId]: { ...state, selectedLayer: layerKey } };
    });
  }, []);

  const handleDismissDedupWarning = useCallback((fileId: string) => {
    setFileStates((prev) => {
      const state = prev[fileId];
      if (!state) return prev;
      return { ...prev, [fileId]: { ...state, showDedupWarning: false } };
    });
  }, []);

  // Computed values
  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const hasResults = files.some((f) => f.status === 'done' || f.status === 'error');
  const hasActiveUploads = files.some(
    (f) => f.status === 'uploading' || f.status === 'extracting',
  );

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
            onClick={() => {
              setFiles([]);
              setFileStates({});
            }}
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
