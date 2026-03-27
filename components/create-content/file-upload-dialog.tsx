'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { Upload, Layers, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';
import { generateIngestDocumentPrompt } from '@/lib/claude-prompts';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { useFileUploadPipeline } from '@/hooks/use-file-upload-pipeline';

interface FileUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FileUploadDialog({ open, onOpenChange }: FileUploadDialogProps) {
  const { layers, getLayerLabel } = useLayerVocabulary();

  const {
    files,
    fileStates,
    isUploading,
    handleFilesAdded,
    handleFileRemoved,
    handleUpload: rawHandleUpload,
    reset,
    handleSetLayerMode,
    handleSetSelectedLayer,
    handleDismissDedupWarning,
    pendingCount,
    hasResults,
    hasActiveUploads,
  } = useFileUploadPipeline({ draftMode: false });

  // Wrap handleUpload to show toast messages (dialog does not use review step)
  const handleUpload = useCallback(async () => {
    const result = await rawHandleUpload();
    if (!result) return;

    const { successfulItems, errorCount } = result;
    const doneCount = successfulItems.length;

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
  }, [rawHandleUpload]);

  // Layer application handler (requires layer vocabulary context)
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
      toast.success(`Layer set to ${getLayerLabel(layerKey)}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update layer',
      );
    }
  }, [files, getLayerLabel, handleSetLayerMode]);

  const handleClose = (isOpen: boolean) => {
    if (!isOpen && isUploading) return; // Prevent closing during upload
    if (!isOpen) {
      reset();
    }
    onOpenChange(isOpen);
  };

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

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <div className="flex w-full items-center justify-end gap-2">
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

          {/* Claude suggestion footer */}
          <div className="flex w-full items-center justify-center border-t pt-2">
            <ClaudePromptButton
              prompt={generateIngestDocumentPrompt().prompt}
              label="Open in Claude for complex documents"
              size="sm"
            />
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
