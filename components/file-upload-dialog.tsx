'use client';

import { useState, useCallback } from 'react';
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

interface FileUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

let fileIdCounter = 0;

export function FileUploadDialog({ open, onOpenChange }: FileUploadDialogProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

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
  }, []);

  const uploadSingleFile = async (uploadFile: UploadFile): Promise<void> => {
    // Mark as uploading
    setFiles((prev) =>
      prev.map((f) =>
        f.id === uploadFile.id ? { ...f, status: 'uploading' as const, progress: 30 } : f,
      ),
    );

    try {
      const formData = new FormData();
      formData.append('file', uploadFile.file);

      // Mark as extracting after a brief delay to show upload progress
      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id ? { ...f, status: 'extracting' as const, progress: 60 } : f,
        ),
      );

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id
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
      const message =
        err instanceof Error ? err.message : 'Upload failed';
      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id
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
    }
    onOpenChange(isOpen);
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const hasResults = files.some(
    (f) => f.status === 'done' || f.status === 'error',
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
            through the IMS pipeline for classification and embedding.
          </DialogDescription>
        </DialogHeader>

        <FileUpload
          files={files}
          onFilesAdded={handleFilesAdded}
          onFileRemoved={handleFileRemoved}
        />

        <DialogFooter className="gap-2 sm:gap-0">
          {hasResults && !isUploading && (
            <Button
              variant="outline"
              onClick={() => {
                setFiles([]);
              }}
            >
              Clear
            </Button>
          )}
          <Button
            onClick={handleUpload}
            disabled={pendingCount === 0 || isUploading}
          >
            {isUploading
              ? 'Uploading\u2026'
              : `Upload ${pendingCount > 0 ? `(${pendingCount})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
