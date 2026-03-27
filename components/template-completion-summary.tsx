'use client';

import { useState } from 'react';
import {
  CheckCircle,
  AlertTriangle,
  Download,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileText,
  Scissors,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/lib/format';
import type { TemplateCompletion } from '@/types/template';

interface FieldError {
  table_index: number;
  row_index: number;
  error: string;
}

interface CompletionSummaryProps {
  completion: TemplateCompletion;
  templateName: string;
  onDownload: () => void;
  onRefill: () => void;
  /** Number of fields where content was truncated to fit word limits */
  truncatedCount?: number;
  /** Storage path for the original (unfilled) template download */
  originalStoragePath?: string;
  /** Per-field error details from the fill process */
  errors?: FieldError[];
  /** Handler for downloading the original template */
  onDownloadOriginal?: () => void;
}

export function TemplateCompletionSummary({
  completion,
  templateName,
  onDownload,
  onRefill,
  truncatedCount,
  originalStoragePath,
  errors,
  onDownloadOriginal,
}: CompletionSummaryProps) {
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const total = completion.fields_filled + completion.fields_skipped + completion.fields_failed;
  const successRate = total > 0 ? Math.round((completion.fields_filled / total) * 100) : 0;
  const hasErrors = errors && errors.length > 0;

  return (
    <div className="space-y-4 rounded-lg border p-6">
      <div className="flex items-start gap-3">
        <CheckCircle
          className="mt-0.5 size-5 shrink-0 text-template-confirmed"
          aria-hidden="true"
        />
        <div className="flex-1">
          <h3 className="text-sm font-semibold">Template Completed</h3>
          <p className="mt-1 text-xs text-muted-foreground">{templateName}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 rounded-lg bg-muted/50 p-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-template-confirmed">
            {completion.fields_filled}
          </p>
          <p className="text-xs text-muted-foreground">Fields filled</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-template-manual">
            {completion.fields_skipped}
          </p>
          <p className="text-xs text-muted-foreground">Skipped</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-template-unmapped">
            {completion.fields_failed}
          </p>
          <p className="text-xs text-muted-foreground">Failed</p>
        </div>
      </div>

      {/* Word limit truncation warning */}
      {truncatedCount != null && truncatedCount > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-template-manual-bg px-3 py-2" role="status">
          <Scissors className="size-4 text-template-manual" aria-hidden="true" />
          <span className="text-xs text-template-manual">
            {truncatedCount} field(s) were truncated to fit their word limits.
            Review the completed document to ensure key content was preserved.
          </span>
        </div>
      )}

      {completion.fields_failed > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2" role="alert">
          <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
          <span className="text-xs text-destructive">
            {completion.fields_failed} field(s) could not be filled. Re-analyse the
            template if the document structure has changed.
          </span>
        </div>
      )}

      {/* Per-field error details (expandable) */}
      {hasErrors && (
        <div className="rounded-md border border-destructive/20">
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-destructive hover:bg-destructive/5"
            onClick={() => setErrorsExpanded((prev) => !prev)}
            aria-expanded={errorsExpanded}
          >
            {errorsExpanded
              ? <ChevronDown className="size-3.5" aria-hidden="true" />
              : <ChevronRight className="size-3.5" aria-hidden="true" />}
            Error details ({errors.length} field{errors.length !== 1 ? 's' : ''})
          </button>
          {errorsExpanded && (
            <ul className="border-t border-destructive/20 px-3 py-2 space-y-1">
              {errors.map((err, i) => (
                <li key={i} className="text-xs text-destructive/80">
                  <span className="font-medium">
                    Table {err.table_index + 1}, Row {err.row_index + 1}:
                  </span>{' '}
                  {err.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>File size: {formatFileSize(completion.file_size)}</span>
        <span>Success rate: {successRate}%</span>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={async () => {
            setIsDownloading(true);
            try {
              await onDownload();
            } finally {
              setIsDownloading(false);
            }
          }}
          disabled={isDownloading}
          className="flex-1"
        >
          {isDownloading ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="mr-2 size-4" aria-hidden="true" />
          )}
          {isDownloading ? 'Downloading\u2026' : 'Download Completed Template'}
        </Button>
        <Button variant="outline" onClick={onRefill}>
          <RefreshCw className="mr-2 size-4" aria-hidden="true" />
          Re-fill
        </Button>
      </div>

      {/* Original template download */}
      {originalStoragePath && onDownloadOriginal && (
        <button
          className={cn(
            'flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors',
          )}
          onClick={onDownloadOriginal}
        >
          <FileText className="size-3.5" aria-hidden="true" />
          Download original (unfilled) template
        </button>
      )}
    </div>
  );
}
