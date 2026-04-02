'use client';

import { useCallback } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Upload, FileText, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/lib/format';

/** Maximum file size: 50 MB */
const MAX_FILE_SIZE = 52_428_800;

/** Maximum files per batch */
const MAX_FILES = 10;

/** Accepted MIME types for the dropzone */
const ACCEPT = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    '.docx',
  ],
  'text/markdown': ['.md'],
  'text/plain': ['.txt'],
};

export interface UploadFileSuggestedLayer {
  suggestedLayer: string;
  reason: string;
  confidence: string;
}

export interface UploadFile {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'extracting' | 'done' | 'error';
  progress: number;
  error?: string;
  resultId?: string;
  suggestedLayer?: UploadFileSuggestedLayer;
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'PDF';
    case 'docx':
      return 'DOCX';
    case 'md':
      return 'MD';
    case 'txt':
      return 'TXT';
    default:
      return 'FILE';
  }
}

interface FileUploadProps {
  files: UploadFile[];
  onFilesAdded: (files: File[]) => void;
  onFileRemoved: (fileId: string) => void;
}

export function FileUpload({
  files,
  onFilesAdded,
  onFileRemoved,
}: FileUploadProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[], rejections: FileRejection[]) => {
      // Check total count
      const remaining = MAX_FILES - files.length;
      if (remaining <= 0) return;

      const toAdd = acceptedFiles.slice(0, remaining);
      if (toAdd.length > 0) {
        onFilesAdded(toAdd);
      }

      // Report rejections via console (toast handled in parent)
      if (rejections.length > 0) {
        for (const rej of rejections) {
          console.warn('File rejected:', rej.file.name, rej.errors);
        }
      }
    },
    [files.length, onFilesAdded],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      onDrop,
      accept: ACCEPT,
      maxSize: MAX_FILE_SIZE,
      maxFiles: MAX_FILES - files.length,
      disabled: files.length >= MAX_FILES,
    });

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        {...getRootProps()}
        aria-label="Upload files drop zone. Drag and drop files here or click to browse."
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer',
          isDragActive && !isDragReject && 'border-primary bg-primary/5',
          isDragReject && 'border-destructive bg-destructive/5',
          !isDragActive &&
            !isDragReject &&
            'border-muted-foreground/25 hover:border-muted-foreground/50',
          files.length >= MAX_FILES && 'cursor-not-allowed opacity-50',
        )}
      >
        <input {...getInputProps()} />
        <Upload
          className={cn(
            'mb-3 size-10',
            isDragActive ? 'text-primary' : 'text-muted-foreground',
          )}
        />
        {isDragReject ? (
          <p className="text-sm font-medium text-destructive">
            Unsupported file type
          </p>
        ) : isDragActive ? (
          <p className="text-sm font-medium text-primary">
            Drop files here&hellip;
          </p>
        ) : (
          <>
            <p className="text-sm font-medium">
              Drag and drop files here, or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              PDF, DOCX, Markdown, or Text &middot; Max 50 MB per file &middot;
              Up to {MAX_FILES} files
            </p>
          </>
        )}
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2',
                f.status === 'error' &&
                  'border-destructive/50 bg-destructive/5',
                f.status === 'done' &&
                  'border-status-success/50 bg-status-success/5',
              )}
            >
              {/* File type badge */}
              <div className="flex size-9 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {getFileIcon(f.file.name)}
              </div>

              {/* File info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.file.name}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatFileSize(f.file.size)}</span>
                  {f.status === 'uploading' && (
                    <span className="text-primary">Uploading&hellip;</span>
                  )}
                  {f.status === 'extracting' && (
                    <span className="text-primary">
                      Extracting text&hellip;
                    </span>
                  )}
                  {f.status === 'done' && (
                    <span className="text-status-success">Done</span>
                  )}
                  {f.status === 'error' && (
                    <span className="flex items-center gap-1 text-destructive">
                      <AlertCircle className="size-3" />
                      {f.error || 'Upload failed'}
                    </span>
                  )}
                </div>
              </div>

              {/* Status icon / remove button */}
              <div className="shrink-0">
                {f.status === 'pending' && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onFileRemoved(f.id)}
                    aria-label={`Remove ${f.file.name}`}
                  >
                    <X className="size-4" />
                  </Button>
                )}
                {(f.status === 'uploading' || f.status === 'extracting') && (
                  <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                )}
                {f.status === 'done' && (
                  <FileText className="size-4 text-status-success" />
                )}
                {f.status === 'error' && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onFileRemoved(f.id)}
                    aria-label={`Remove ${f.file.name}`}
                  >
                    <X className="size-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
