'use client';

import { useCallback, useRef, useState } from 'react';
import { FileUp, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/lib/format';
import type { ExtractionResult } from '@/types/procurement';

interface TenderUploadProps {
  procurementId: string;
  onUploadComplete: (result?: ExtractionResult) => void;
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const ACCEPTED_EXTENSIONS = ['.docx', '.pdf'];
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

type UploadPhase = 'idle' | 'uploading' | 'extracting' | 'complete' | 'error';

function hasValidExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function detectFormat(filename: string): 'docx' | 'pdf' {
  return filename.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx';
}

export function TenderUpload({
  procurementId,
  onUploadComplete,
}: TenderUploadProps) {
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [extractionResult, setExtractionResult] =
    useState<ExtractionResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const resetState = useCallback(() => {
    setPhase('idle');
    setError(null);
    setFileName(null);
    setExtractionResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const validateFile = useCallback((file: File): string | null => {
    if (!ACCEPTED_TYPES.includes(file.type) && !hasValidExtension(file.name)) {
      return `Invalid file type. Please upload a .docx or .pdf file. Received: ${file.name}`;
    }
    if (file.size > MAX_SIZE_BYTES) {
      return `File is too large (${formatFileSize(file.size)}). Maximum size is 50MB.`;
    }
    return null;
  }, []);

  const processFile = useCallback(
    async (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        setPhase('error');
        toast.error(validationError);
        return;
      }

      setFileName(file.name);
      setError(null);
      setPhase('uploading');

      try {
        // Upload the tender document
        const formData = new FormData();
        formData.append('file', file);

        const uploadRes = await fetch(
          `/api/procurement/${procurementId}/tender`,
          {
            method: 'POST',
            body: formData,
          },
        );

        if (!uploadRes.ok) {
          const body = await uploadRes.json().catch(() => null);
          throw new Error(body?.error ?? `Upload failed (${uploadRes.status})`);
        }

        const uploadData = await uploadRes.json();

        // Automatically extract questions
        setPhase('extracting');

        const extractRes = await fetch(
          `/api/procurement/${procurementId}/questions/extract`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              document_path: uploadData.path,
              format: detectFormat(file.name),
            }),
          },
        );

        if (!extractRes.ok) {
          const body = await extractRes.json().catch(() => null);
          throw new Error(
            body?.error ?? `Extraction failed (${extractRes.status})`,
          );
        }

        const result: ExtractionResult = await extractRes.json();
        setExtractionResult(result);
        setPhase('complete');
        toast.success(
          `Extracted ${result.total_questions} questions from ${result.total_sections} sections`,
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'An unexpected error occurred';
        setError(message);
        setPhase('error');
        toast.error(message);
      }
    },
    [procurementId, validateFile],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      dragCounterRef.current = 0;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFile(files[0]);
      }
    },
    [processFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        processFile(files[0]);
      }
    },
    [processFile],
  );

  const handleClick = useCallback(() => {
    if (phase === 'idle' || phase === 'error') {
      fileInputRef.current?.click();
    }
  }, [phase]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={phase === 'idle' || phase === 'error' ? 0 : -1}
        aria-label="Upload tender document. Drag and drop or click to browse."
        className={cn(
          'relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
          phase === 'idle' &&
            !dragging &&
            'border-muted-foreground/25 hover:border-muted-foreground/50 cursor-pointer',
          phase === 'error' &&
            'border-destructive/50 hover:border-destructive cursor-pointer',
          dragging && 'border-primary bg-primary/5',
          (phase === 'uploading' || phase === 'extracting') &&
            'border-primary/50 cursor-default',
          phase === 'complete' && 'border-template-confirmed/50 cursor-default',
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.pdf"
          className="sr-only"
          onChange={handleFileSelect}
          aria-hidden="true"
          tabIndex={-1}
        />

        {/* Idle state */}
        {phase === 'idle' && (
          <>
            <FileUp
              className="size-10 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium">Upload Tender Document</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Drag and drop your tender document here, or click to browse.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Accepts: .docx, .pdf (max 50MB)
              </p>
            </div>
          </>
        )}

        {/* Uploading state */}
        {phase === 'uploading' && (
          <>
            <Loader2
              className="size-8 animate-spin text-primary"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium">
                Uploading{fileName ? `: ${fileName}` : ''}...
              </p>
              <Progress
                className="mt-2 w-48"
                value={undefined}
                aria-label="Upload in progress"
              />
            </div>
          </>
        )}

        {/* Extracting state */}
        {phase === 'extracting' && (
          <>
            <Loader2
              className="size-8 animate-spin text-primary"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium">Extracting questions...</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Analysing document structure and identifying tender questions.
              </p>
            </div>
          </>
        )}

        {/* Complete state */}
        {phase === 'complete' && extractionResult && (
          <>
            <CheckCircle
              className="size-8 text-template-confirmed"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium">Extraction complete</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Found {extractionResult.total_questions} questions across{' '}
                {extractionResult.total_sections} sections.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onUploadComplete(extractionResult);
                }}
              >
                Review Questions
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  resetState();
                }}
              >
                Upload Another
              </Button>
            </div>
          </>
        )}

        {/* Error state */}
        {phase === 'error' && (
          <>
            <AlertTriangle
              className="size-8 text-muted-foreground/50"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-foreground">
                Upload didn&apos;t complete
              </p>
              {error && (
                <p className="mt-1 text-xs text-muted-foreground">{error}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Click to try again, or drag and drop a new file.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                resetState();
              }}
            >
              Try Again
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
