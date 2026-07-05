'use client';

// ID-131.24 (G-UPLOAD-GATE, DR-025) rework: the pre-existing hook drove the
// old synchronous /api/upload pipeline (extract -> embed -> classify ->
// summarise -> content_items row). That pipeline is retired — the app-side
// upload now rides the binding-admission gate (lib/upload/folder-drop.ts
// `stageAndWalk`, ID-138 {138.13}): gate-pass -> Storage PUT -> an
// admission-minted `source_documents` row, with NO content_items row and no
// synchronous classification/embedding/summary to track. This hook is
// correspondingly much simpler: each pending file is POSTed to the shared
// gated endpoint (`/api/ingest/folder-drop` — the SAME leg the folder-drop
// drop-zone used, per "do not build a second transport") with the caller's
// chosen `retentionClass`, and the per-file result is either `admitted`
// (sourceDocumentId + wasMinted + retentionClass) or `error`.

import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import type { UploadFile } from '@/components/create-content/file-upload';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Retention classes selectable at this upload surface (DR-025). Only the two
 * classes that apply to an actual bytes upload — `live_connected` /
 * `external_referenced` are zero-byte connector bindings (locator/auth-driven,
 * see `lib/upload/folder-drop.ts` `RetentionClass`) and are never offered
 * here.
 */
/** @public */
export type UploadRetentionClass = 'keep_and_watch' | 'ingest_once';

/** Per-file admission outcome. */
/** @public */
export interface FileAdmissionState {
  status: 'admitted' | 'error';
  sourceDocumentId?: string;
  destPath?: string;
  wasMinted?: boolean;
  retentionClass?: UploadRetentionClass;
  error?: string;
}

/** @public */
export type UploadPhase = 'select' | 'uploading';

/** Result returned by handleUpload after all files finish processing. */
/** @public */
export interface UploadResult {
  admittedCount: number;
  errorCount: number;
}

/** Return value from the useFileUploadPipeline hook */
/** @public */
export interface UseFileUploadPipelineReturn {
  // State
  phase: UploadPhase;
  files: UploadFile[];
  fileStates: Record<string, FileAdmissionState>;
  isUploading: boolean;

  // File management
  handleFilesAdded: (files: File[]) => void;
  handleFileRemoved: (fileId: string) => void;

  // Upload action — admits every pending file at the chosen retention class.
  handleUpload: (
    retentionClass: UploadRetentionClass,
  ) => Promise<UploadResult | undefined>;
  reset: () => void;

  // Computed values
  pendingCount: number;
  hasResults: boolean;
}

// ---------------------------------------------------------------------------
// File ID generation
// ---------------------------------------------------------------------------

/** Generate a unique file ID for upload tracking */
const generateFileId = () => `upload-${crypto.randomUUID().slice(0, 8)}`;

/** Wire response shape from POST /api/ingest/folder-drop. */
interface FolderDropAdmitResponse {
  sourceFile: string;
  destPath: string;
  sourceDocumentId: string;
  wasMinted: boolean;
  retentionClass: UploadRetentionClass;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFileUploadPipeline(): UseFileUploadPipelineReturn {
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<UploadPhase>('select');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [fileStates, setFileStates] = useState<
    Record<string, FileAdmissionState>
  >({});

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
  }, []);

  // Core admission mutation — POSTs to the shared gated endpoint (the SAME
  // leg the folder-drop drop-zone rides — no second transport).
  const admitFileMutation = useMutation({
    mutationFn: async ({
      file,
      retentionClass,
    }: {
      file: File;
      retentionClass: UploadRetentionClass;
    }): Promise<FolderDropAdmitResponse> => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('retention_class', retentionClass);

      const response = await fetch('/api/ingest/folder-drop', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }
      return data as FolderDropAdmitResponse;
    },
    onSuccess: () => {
      // A source was admitted — invalidate any source/file-listing views.
      queryClient.invalidateQueries({
        queryKey: queryKeys.sourceDocuments.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.fileUploads.all });
    },
  });

  const { mutateAsync: admitFile } = admitFileMutation;

  const admitSingleFile = useCallback(
    async (
      uploadFile: UploadFile,
      retentionClass: UploadRetentionClass,
    ): Promise<boolean> => {
      const fileId = uploadFile.id;

      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? { ...f, status: 'uploading' as const, progress: 10 }
            : f,
        ),
      );

      try {
        const data = await admitFile({ file: uploadFile.file, retentionClass });

        setFileStates((prev) => ({
          ...prev,
          [fileId]: {
            status: 'admitted',
            sourceDocumentId: data.sourceDocumentId,
            destPath: data.destPath,
            wasMinted: data.wasMinted,
            retentionClass: data.retentionClass,
          },
        }));

        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  status: 'done' as const,
                  progress: 100,
                  resultId: data.sourceDocumentId,
                }
              : f,
          ),
        );

        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';

        setFileStates((prev) => ({
          ...prev,
          [fileId]: { status: 'error', error: message },
        }));

        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? { ...f, status: 'error' as const, progress: 0, error: message }
              : f,
          ),
        );

        return false;
      }
    },
    [admitFile],
  );

  // Admit all pending files at the chosen retention class
  const handleUpload = useCallback(
    async (retentionClass: UploadRetentionClass) => {
      const pendingFiles = files.filter((f) => f.status === 'pending');
      if (pendingFiles.length === 0) return;

      setIsUploading(true);
      setPhase('uploading');

      const results = await Promise.allSettled(
        pendingFiles.map((f) => admitSingleFile(f, retentionClass)),
      );

      setIsUploading(false);
      setPhase('select');

      let admittedCount = 0;
      let errorCount = 0;
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          admittedCount++;
        } else {
          errorCount++;
        }
      }

      return { admittedCount, errorCount };
    },
    [files, admitSingleFile],
  );

  // Reset everything to initial state
  const reset = useCallback(() => {
    setPhase('select');
    setFiles([]);
    setFileStates({});
    setIsUploading(false);
  }, []);

  // Computed values
  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const hasResults = files.some(
    (f) => f.status === 'done' || f.status === 'error',
  );

  return {
    phase,
    files,
    fileStates,
    isUploading,
    handleFilesAdded,
    handleFileRemoved,
    handleUpload,
    reset,
    pendingCount,
    hasResults,
  };
}
