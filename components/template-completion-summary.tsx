'use client';

import { CheckCircle, AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TemplateCompletion } from '@/types/template';

interface CompletionSummaryProps {
  completion: TemplateCompletion;
  templateName: string;
  onDownload: () => void;
  onRefill: () => void;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TemplateCompletionSummary({
  completion,
  templateName,
  onDownload,
  onRefill,
}: CompletionSummaryProps) {
  const total = completion.fields_filled + completion.fields_skipped + completion.fields_failed;
  const successRate = total > 0 ? Math.round((completion.fields_filled / total) * 100) : 0;

  return (
    <div className="space-y-4 rounded-lg border p-6">
      <div className="flex items-start gap-3">
        <CheckCircle
          className="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400"
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
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {completion.fields_filled}
          </p>
          <p className="text-xs text-muted-foreground">Fields filled</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {completion.fields_skipped}
          </p>
          <p className="text-xs text-muted-foreground">Skipped</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">
            {completion.fields_failed}
          </p>
          <p className="text-xs text-muted-foreground">Failed</p>
        </div>
      </div>

      {completion.fields_failed > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2" role="alert">
          <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
          <span className="text-xs text-destructive">
            {completion.fields_failed} field(s) could not be filled. Re-analyse the
            template if the document structure has changed.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>File size: {formatFileSize(completion.file_size)}</span>
        <span>Success rate: {successRate}%</span>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button onClick={onDownload} className="flex-1">
          <Download className="mr-2 size-4" aria-hidden="true" />
          Download Completed Template
        </Button>
        <Button variant="outline" onClick={onRefill}>
          <RefreshCw className="mr-2 size-4" aria-hidden="true" />
          Re-fill
        </Button>
      </div>
    </div>
  );
}
