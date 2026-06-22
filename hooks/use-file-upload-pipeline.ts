'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import type { UploadFile } from '@/components/create-content/file-upload';
import type { DedupMatch } from '@/components/shared/dedup-warning';
import type { IngestionStep } from '@/components/create-content/ingestion-progress';
import type { UploadReviewItem } from '@/components/create-content/upload-review-step';

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

/**
 * Interval between cosmetic step advances (ms).
 *
 * NOTE ({56.12}, ID-56 Path B): this cosmetic timer drives the SYNCHRONOUS
 * /api/upload path, which performs app-side extraction and returns the finished
 * item in a single response — there is no async backend surface to subscribe
 * to, so the steps are necessarily illustrative and the timer is retained here.
 *
 * The folder-drop async path (Path B) does NOT use this timer: it drives its
 * progress from REAL poll state via `hooks/use-content-ingest-polling.ts`
 * (content_items.source_file correlation) instead of a cosmetic interval.
 * Migrating the synchronous path off cosmetic stepping would require a
 * server-side progress surface for /api/upload (a separate work item) — see the
 * {56.12} journal escalation.
 */
const STEP_ADVANCE_INTERVAL = 2500;

/** localStorage key for skip review preference */
export const SKIP_REVIEW_KEY = 'kh_skip_upload_review';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-file layer suggestion info */
/** @public */
export interface FileSuggestedLayer {
  suggestedLayer: string;
  reason: string;
  confidence: string;
}

/** Per-file re-upload detection info */
/** @public */
export interface FileReuploadInfo {
  matchType: 'identical' | 'new_version';
  previousVersion: number;
  previousDocumentId: string;
  newDocumentId?: string;
}

/** Per-file state for progress and dedup tracking */
/** @public */
export interface FileUploadState {
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
  classification?: {
    domain: string;
    subtopic: string;
    confidence: number | null;
  };
  aiSummary?: string;
  qualityScore?: number;
  contentType?: string;
}

/** @public */
export type UploadPhase = 'select' | 'uploading' | 'review';

/** Configuration options for the upload pipeline hook */
/** @public */
export interface UseFileUploadPipelineOptions {
  /**
   * When true, uploads include `draft=true` in the FormData so
   * items are created with `governance_review_status = 'draft'`.
   * Set to false for the Browse-page dialog (immediate publish).
   */
  draftMode?: boolean;
}

/** Result returned by handleUpload after all files finish processing */
/** @public */
export interface UploadResult {
  successfulItems: UploadReviewItem[];
  errorCount: number;
  skipReview: boolean;
}

/** Return value from the useFileUploadPipeline hook */
/** @public */
export interface UseFileUploadPipelineReturn {
  // State
  phase: UploadPhase;
  files: UploadFile[];
  fileStates: Record<string, FileUploadState>;
  isUploading: boolean;
  reviewItems: UploadReviewItem[];

  // File management
  handleFilesAdded: (files: File[]) => void;
  handleFileRemoved: (fileId: string) => void;

  // Upload actions
  handleUpload: () => Promise<UploadResult | undefined>;
  reset: () => void;

  // Review actions
  setPhase: (phase: UploadPhase) => void;
  setReviewItems: (items: UploadReviewItem[]) => void;

  // Layer management
  handleSetLayerMode: (
    fileId: string,
    mode: 'suggest' | 'change' | 'applied',
  ) => void;
  handleSetSelectedLayer: (fileId: string, layerKey: string) => void;
  handleDismissDedupWarning: (fileId: string) => void;

  // Computed values
  pendingCount: number;
  hasResults: boolean;
  hasActiveUploads: boolean;

  // Helper for reading skip-review preference
  getSkipReview: () => boolean;
}

// ---------------------------------------------------------------------------
// File ID generation
// ---------------------------------------------------------------------------

/** Generate a unique file ID for upload tracking */
const generateFileId = () => `upload-${crypto.randomUUID().slice(0, 8)}`;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFileUploadPipeline(
  options: UseFileUploadPipelineOptions = {},
): UseFileUploadPipelineReturn {
  const { draftMode } = options;
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<UploadPhase>('select');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [fileStates, setFileStates] = useState<Record<string, FileUploadState>>(
    {},
  );
  const [reviewItems, setReviewItems] = useState<UploadReviewItem[]>([]);
  const stepTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>(
    {},
  );

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

  // Cosmetic step advancement for a single file
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

  // Add files to the upload queue
  const handleFilesAdded = useCallback((newFiles: File[]) => {
    const uploadFiles: UploadFile[] = newFiles.map((file) => ({
      id: generateFileId(),
      file,
      status: 'pending' as const,
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...uploadFiles]);
  }, []);

  // Remove a file from the queue
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

  // Core upload mutation — wraps the fetch('/api/upload') call
  const uploadFileMutation = useMutation({
    mutationFn: async ({
      file,
      useDraft,
    }: {
      file: File;
      useDraft: boolean;
    }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (useDraft) {
        formData.append('draft', 'true');
      }

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }
      return data;
    },
    onSuccess: () => {
      // Invalidate content queries so browse/library views refresh
      queryClient.invalidateQueries({ queryKey: queryKeys.contentItems.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.fileUploads.all });
    },
  });

  // Upload a single file
  const { mutateAsync: doUploadFile } = uploadFileMutation;
  const uploadSingleFile = useCallback(
    async (uploadFile: UploadFile, useDraft: boolean) => {
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
          f.id === fileId
            ? { ...f, status: 'uploading' as const, progress: 10 }
            : f,
        ),
      );

      // Start cosmetic step advancement
      stepTimersRef.current[fileId] = setInterval(
        () => advanceStepsForFile(fileId),
        STEP_ADVANCE_INTERVAL,
      );

      try {
        const data = await doUploadFile({
          file: uploadFile.file,
          useDraft,
        });

        // Stop cosmetic timer
        if (stepTimersRef.current[fileId]) {
          clearInterval(stepTimersRef.current[fileId]);
          delete stepTimersRef.current[fileId];
        }

        // Mark all steps as done
        const layerData: FileSuggestedLayer | undefined =
          data.suggested_layer ?? undefined;

        // Capture re-upload detection info
        const reuploadData: FileReuploadInfo | undefined =
          data.reupload_detection
            ? {
                matchType: data.reupload_detection.match_type,
                previousVersion: data.reupload_detection.previous_version,
                previousDocumentId:
                  data.reupload_detection.previous_document_id,
                newDocumentId: data.source_document_id ?? undefined,
              }
            : undefined;

        const dedupMatches: DedupMatch[] = (data.duplicate_matches ?? []).map(
          (m: {
            id: string;
            title: string;
            similarity: number;
            match_type?: string;
          }) => ({
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
              steps: state.steps.map((s) => ({
                ...s,
                status: 'done' as const,
              })),
              warnings: data.warnings ?? [],
              dedupMatches,
              showDedupWarning: dedupMatches.length > 0,
              suggestedLayer: layerData,
              selectedLayer: layerData?.suggestedLayer ?? '',
              reuploadInfo: reuploadData,
              // Enriched data for review step
              classification: data.classification ?? undefined,
              aiSummary: data.summary ?? undefined,
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
          classification: data.classification as
            | { domain: string; subtopic: string; confidence: number | null }
            | undefined,
          aiSummary: data.summary as string | undefined,
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
                s.status === 'active' ? { ...s, status: 'error' as const } : s,
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
    },
    [advanceStepsForFile, doUploadFile],
  );

  // Upload all pending files
  const handleUpload = useCallback(async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending');
    if (pendingFiles.length === 0) return;

    // Determine draft mode: if explicitly set use that,
    // otherwise use skip-review preference
    const skipReview = getSkipReview();
    const useDraft = draftMode !== undefined ? draftMode : !skipReview;

    setIsUploading(true);
    setPhase('uploading');

    // Upload all pending files in parallel
    const results = await Promise.allSettled(
      pendingFiles.map((f) => uploadSingleFile(f, useDraft)),
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

    return {
      successfulItems,
      errorCount,
      skipReview: draftMode !== undefined ? !draftMode : skipReview,
    };
  }, [files, getSkipReview, draftMode, uploadSingleFile]);

  // Reset everything to initial state
  const reset = useCallback(() => {
    // Clear all timers
    for (const timer of Object.values(stepTimersRef.current)) {
      clearInterval(timer);
    }
    stepTimersRef.current = {};

    setPhase('select');
    setFiles([]);
    setFileStates({});
    setReviewItems([]);
    setIsUploading(false);
  }, []);

  // Layer management
  const handleSetLayerMode = useCallback(
    (fileId: string, mode: 'suggest' | 'change' | 'applied') => {
      setFileStates((prev) => {
        const state = prev[fileId];
        if (!state) return prev;
        return { ...prev, [fileId]: { ...state, layerMode: mode } };
      });
    },
    [],
  );

  const handleSetSelectedLayer = useCallback(
    (fileId: string, layerKey: string) => {
      setFileStates((prev) => {
        const state = prev[fileId];
        if (!state) return prev;
        return { ...prev, [fileId]: { ...state, selectedLayer: layerKey } };
      });
    },
    [],
  );

  const handleDismissDedupWarning = useCallback((fileId: string) => {
    setFileStates((prev) => {
      const state = prev[fileId];
      if (!state) return prev;
      return { ...prev, [fileId]: { ...state, showDedupWarning: false } };
    });
  }, []);

  // Computed values
  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const hasResults = files.some(
    (f) => f.status === 'done' || f.status === 'error',
  );
  const hasActiveUploads = files.some(
    (f) => f.status === 'uploading' || f.status === 'extracting',
  );

  return {
    phase,
    files,
    fileStates,
    isUploading,
    reviewItems,
    handleFilesAdded,
    handleFileRemoved,
    handleUpload,
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
  };
}
