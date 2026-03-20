'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FileUpload, type UploadFile } from '@/components/file-upload';
import { IngestionProgress, type IngestionStep } from '@/components/ingestion-progress';
import { DedupWarning, type DedupMatch } from '@/components/dedup-warning';
import { ClaudePromptButton } from '@/components/claude-prompt-button';
import { generateIngestDocumentPrompt } from '@/lib/claude-prompts';

interface FileUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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

/** Per-file state for progress and dedup tracking */
interface FileUploadState {
  steps: IngestionStep[];
  dedupMatches: DedupMatch[];
  showDedupWarning: boolean;
  warnings: string[];
}

let fileIdCounter = 0;

export function FileUploadDialog({ open, onOpenChange }: FileUploadDialogProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [fileStates, setFileStates] = useState<Record<string, FileUploadState>>({});
  const stepTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of Object.values(stepTimersRef.current)) {
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
        // Start first step
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
        // All done cosmetically — stop advancing
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
    // Clean up associated state
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

  const uploadSingleFile = async (uploadFile: UploadFile): Promise<void> => {
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
      setFileStates((prev) => {
        const state = prev[fileId];
        if (!state) return prev;

        const dedupMatches: DedupMatch[] = (data.duplicate_matches ?? []).map(
          (m: { id: string; title: string; similarity: number; match_type?: string }) => ({
            id: m.id,
            title: m.title,
            similarity: m.similarity,
            match_type: m.match_type ?? 'near_duplicate',
          }),
        );

        return {
          ...prev,
          [fileId]: {
            ...state,
            steps: state.steps.map((s) => ({ ...s, status: 'done' as const })),
            warnings: data.warnings ?? [],
            dedupMatches,
            showDedupWarning: dedupMatches.length > 0,
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
    } catch (err) {
      // Stop cosmetic timer
      if (stepTimersRef.current[fileId]) {
        clearInterval(stepTimersRef.current[fileId]);
        delete stepTimersRef.current[fileId];
      }

      const message =
        err instanceof Error ? err.message : 'Upload failed';

      // Mark active step as error
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
    }
  };

  const handleUpload = async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending');
    if (pendingFiles.length === 0) return;

    setIsUploading(true);

    // Upload all pending files in parallel
    await Promise.allSettled(
      pendingFiles.map((f) => uploadSingleFile(f)),
    );

    setIsUploading(false);

    // Count results
    // Re-read files state after uploads complete
    setFiles((currentFiles) => {
      const doneCount = currentFiles.filter((f) => f.status === 'done').length;
      const errorCount = currentFiles.filter((f) => f.status === 'error').length;

      if (doneCount > 0 && errorCount === 0) {
        toast.success(
          `${doneCount} file${doneCount !== 1 ? 's' : ''} uploaded successfully`,
        );
      } else if (doneCount > 0 && errorCount > 0) {
        toast.warning(
          `${doneCount} uploaded, ${errorCount} failed`,
        );
      } else if (errorCount > 0) {
        toast.error(
          `${errorCount} file${errorCount !== 1 ? 's' : ''} failed to upload`,
        );
      }

      return currentFiles;
    });
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen && isUploading) return; // Prevent closing during upload
    if (!isOpen) {
      // Reset state when closing
      setFiles([]);
      setFileStates({});
      // Clean up all timers
      for (const timer of Object.values(stepTimersRef.current)) {
        clearInterval(timer);
      }
      stepTimersRef.current = {};
    }
    onOpenChange(isOpen);
  };

  const handleDismissDedupWarning = useCallback((fileId: string) => {
    setFileStates((prev) => {
      const state = prev[fileId];
      if (!state) return prev;
      return {
        ...prev,
        [fileId]: { ...state, showDedupWarning: false },
      };
    });
  }, []);

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const hasResults = files.some(
    (f) => f.status === 'done' || f.status === 'error',
  );
  const hasActiveUploads = files.some(
    (f) => f.status === 'uploading' || f.status === 'extracting',
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="size-5" />
            Upload Documents
          </DialogTitle>
          <DialogDescription>
            Upload PDF, DOCX, Markdown, or text files. They will be processed
            through the pipeline for classification and embedding.
          </DialogDescription>
        </DialogHeader>

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
                    {/* Dedup warning per file */}
                    {state.showDedupWarning && state.dedupMatches.length > 0 && (
                      <DedupWarning
                        matches={state.dedupMatches}
                        onViewMatch={(id) => window.open(`/item/${id}`, '_blank')}
                        onDismiss={() => handleDismissDedupWarning(f.id)}
                      />
                    )}
                  </div>
                );
              })}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <div className="flex w-full items-center justify-end gap-2">
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

          {/* Claude suggestion footer */}
          <div className="flex w-full items-center justify-center border-t pt-2">
            <ClaudePromptButton
              prompt={generateIngestDocumentPrompt().prompt}
              label="Or let Claude handle complex documents"
              size="sm"
            />
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
