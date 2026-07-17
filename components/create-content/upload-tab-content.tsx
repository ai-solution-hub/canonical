'use client';

// ID-131.24 (G-UPLOAD-GATE, DR-025) rework: this tab used to drive TWO
// separate transports — the synchronous /api/upload content_items pipeline
// (Upload button) and a distinct folder-drop stage-then-poll flow (Stage &
// ingest button, polling content_items via source_file). Both are retired.
// There is now ONE binding-admission gate (lib/upload/folder-drop.ts
// `stageAndWalk`, ID-138 {138.13}): gate-pass -> Storage PUT -> an
// admission-minted `source_documents` row, with NO content_items row. The
// UI reflects DR-025's framing — this is "connect a source" + assign a
// retention class, not "upload an authoritative document"; authority is
// earned later at promotion (DR-026), not at admission.

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Upload, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileUpload } from '@/components/create-content/file-upload';
import { QAPreviewList } from '@/components/qa/qa-preview-list';
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';
import { generateIngestDocumentPrompt } from '@/lib/claude-prompts';
import {
  useFileUploadPipeline,
  type UploadRetentionClass,
} from '@/hooks/use-file-upload-pipeline';
import type { QACreateInput } from '@/lib/quality/qa-detection';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UploadTabContentProps {
  /** Navigate to another tab (e.g. 'url') */
  onSwitchTab?: (tab: string) => void;
  /** Pre-detected Q&A pairs to show in the preview list. */
  detectedQAPairs?: QACreateInput[];
  /** Source document ID to link batch-created items to. */
  sourceDocumentId?: string;
}

// ---------------------------------------------------------------------------
// Retention class options (DR-025) — only the two classes that apply to an
// actual bytes upload; `live_connected` / `external_referenced` are
// zero-byte connector bindings out of this surface's remit (see
// `lib/upload/folder-drop.ts` `RetentionClass`).
// ---------------------------------------------------------------------------

const RETENTION_CLASS_OPTIONS: Array<{
  value: UploadRetentionClass;
  label: string;
  description: string;
}> = [
  {
    value: 'keep_and_watch',
    label: 'Keep & watch',
    description: 'A living document — re-checked on future syncs.',
  },
  {
    value: 'ingest_once',
    label: 'Ingest once',
    description: 'A one-time extract — never re-walked.',
  },
];

const RETENTION_CLASS_LABEL: Record<UploadRetentionClass, string> =
  Object.fromEntries(
    RETENTION_CLASS_OPTIONS.map((opt) => [opt.value, opt.label]),
  ) as Record<UploadRetentionClass, string>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UploadTabContent({
  onSwitchTab,
  detectedQAPairs,
  sourceDocumentId,
}: UploadTabContentProps) {
  const pipeline = useFileUploadPipeline();

  const {
    files,
    fileStates,
    isUploading,
    handleFilesAdded,
    handleFileRemoved,
    handleUpload: rawHandleUpload,
    reset,
    pendingCount,
    hasResults,
  } = pipeline;

  const [retentionClass, setRetentionClass] =
    useState<UploadRetentionClass>('keep_and_watch');

  // ---------------------------------------------------------------------------
  // Q&A batch creation state
  // ---------------------------------------------------------------------------

  /** Tracks whether we are in the Q&A preview/batch creation flow. */
  const [qaPairs, setQaPairs] = useState<QACreateInput[] | null>(
    detectedQAPairs ?? null,
  );
  const [qaSourceDocumentId, setQaSourceDocumentId] = useState<
    string | undefined
  >(sourceDocumentId);
  const [qaBatchProgress, setQaBatchProgress] = useState<{
    isCreating: boolean;
    created: number;
    failed: number;
    total: number;
    items: Array<{ id: string; title: string; status: 'created' | 'failed' }>;
    batchId?: string;
  } | null>(null);

  /** Handle Q&A pair confirmation from the preview list. */
  const handleQAConfirm = useCallback(
    async (confirmedPairs: QACreateInput[]) => {
      if (confirmedPairs.length === 0) return;

      setQaBatchProgress({
        isCreating: true,
        created: 0,
        failed: 0,
        total: confirmedPairs.length,
        items: [],
      });

      try {
        const res = await fetch('/api/items/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: confirmedPairs,
            source_document_id: qaSourceDocumentId,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Batch creation failed');
        }

        setQaBatchProgress({
          isCreating: false,
          created: data.created ?? 0,
          failed: data.failed ?? 0,
          total: confirmedPairs.length,
          items: data.items ?? [],
          batchId: data.batch_id,
        });

        if (data.failed === 0) {
          toast.success(
            `${data.created} Q&A item${data.created !== 1 ? 's' : ''} created`,
          );
        } else {
          toast.warning(`${data.created} created, ${data.failed} failed`);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Batch creation failed';
        toast.error(message);
        setQaBatchProgress((prev) =>
          prev ? { ...prev, isCreating: false } : null,
        );
      }
    },
    [qaSourceDocumentId],
  );

  /** Handle skipping Q&A detection — dismiss preview and return to upload. */
  const handleQASkip = useCallback(() => {
    setQaPairs(null);
    setQaSourceDocumentId(undefined);
    setQaBatchProgress(null);
  }, []);

  // ID-131.15 (G-DEDUP legacy dedup-family retirement, S446): handleQADedupCheck
  // (POST /api/dedup/check) was removed — that endpoint was retired along with
  // the on-ingest dedup surface. `QAPreviewList`'s `onDedupCheck` prop is
  // optional and gracefully no-ops when omitted (see `runDedupChecks` guard
  // in components/qa/qa-preview-list.tsx), so the per-pair dedup UI in that
  // component simply stays inactive here rather than being ripped out.

  /** Reset Q&A batch state and return to initial upload view. */
  const handleQABatchDismiss = useCallback(() => {
    setQaPairs(null);
    setQaSourceDocumentId(undefined);
    setQaBatchProgress(null);
    reset();
  }, [reset]);

  // Wrap handleUpload to surface toasts for the admission outcome.
  const handleUpload = useCallback(async () => {
    const result = await rawHandleUpload(retentionClass);
    if (!result) return;

    const { admittedCount, errorCount } = result;

    if (admittedCount > 0 && errorCount === 0) {
      toast.success(
        `${admittedCount} source${admittedCount !== 1 ? 's' : ''} connected`,
      );
    } else if (admittedCount > 0 && errorCount > 0) {
      toast.warning(`${admittedCount} connected, ${errorCount} failed`);
    } else if (errorCount > 0) {
      toast.error(
        `${errorCount} file${errorCount !== 1 ? 's' : ''} failed to connect`,
      );
    }
  }, [rawHandleUpload, retentionClass]);

  // ---------------------------------------------------------------------------
  // Render: Q&A batch progress (after creation starts)
  // ---------------------------------------------------------------------------

  if (qaBatchProgress && !qaBatchProgress.isCreating) {
    return (
      <div
        className="mx-auto max-w-2xl space-y-4"
        data-testid="qa-batch-complete"
      >
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle
              className="size-5 text-quality-good"
              aria-hidden="true"
            />
            <h3 className="text-lg font-semibold text-foreground">
              Batch creation complete
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            {qaBatchProgress.created} item
            {qaBatchProgress.created !== 1 ? 's' : ''} created
            {qaBatchProgress.failed > 0 && (
              <span className="text-status-warning">
                {' '}
                ({qaBatchProgress.failed} failed)
              </span>
            )}
          </p>
          {/* Item list */}
          <div className="max-h-60 overflow-y-auto space-y-1">
            {qaBatchProgress.items.map((item, idx) => (
              <div
                key={item.id || idx}
                className="flex items-center gap-2 text-sm"
              >
                {item.status === 'created' ? (
                  <CheckCircle
                    className="size-3.5 shrink-0 text-quality-good"
                    aria-hidden="true"
                  />
                ) : (
                  <XCircle
                    className="size-3.5 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={
                    item.status === 'created'
                      ? 'text-foreground'
                      : 'text-muted-foreground line-through'
                  }
                >
                  {item.title}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <Button variant="outline" size="sm" onClick={handleQABatchDismiss}>
              Done
            </Button>
            <Button size="sm" onClick={() => window.open('/library', '_blank')}>
              View in Browse
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (qaBatchProgress?.isCreating) {
    return (
      <div
        className="mx-auto max-w-2xl space-y-4"
        data-testid="qa-batch-progress"
      >
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Loader2
              className="size-5 animate-spin text-primary"
              aria-hidden="true"
            />
            <h3 className="text-lg font-semibold text-foreground">
              Creating Q&A items...
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Processing {qaBatchProgress.total} item
            {qaBatchProgress.total !== 1 ? 's' : ''}. This may take a few
            minutes.
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{
                width: `${Math.max(5, (qaBatchProgress.created / qaBatchProgress.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Q&A preview phase
  // ---------------------------------------------------------------------------

  if (qaPairs && qaPairs.length > 0) {
    return (
      <div className="mx-auto max-w-2xl" data-testid="qa-preview-phase">
        <QAPreviewList
          pairs={qaPairs}
          onConfirm={handleQAConfirm}
          onSkip={handleQASkip}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: connect-a-source phase (select + uploading + admitted results)
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Upload className="size-5" aria-hidden="true" />
          Connect a source
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect documents (PDF, DOCX, Markdown, or text) as source evidence.
          Choose how each binding is retained — authority is earned later, at
          promotion.
        </p>
      </div>

      <FileUpload
        files={files}
        onFilesAdded={handleFilesAdded}
        onFileRemoved={handleFileRemoved}
      />

      {/* Retention class picker (DR-025) */}
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="upload-retention-class"
          className="text-sm font-medium text-foreground"
        >
          Retention
        </label>
        <Select
          value={retentionClass}
          onValueChange={(value) =>
            setRetentionClass(value as UploadRetentionClass)
          }
        >
          <SelectTrigger
            id="upload-retention-class"
            className="h-8 w-44 text-xs"
            aria-label="Retention class"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RETENTION_CLASS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {
            RETENTION_CLASS_OPTIONS.find((opt) => opt.value === retentionClass)
              ?.description
          }
        </span>
      </div>

      {/* Per-file admission results */}
      {files.some((f) => f.status === 'done' || f.status === 'error') && (
        <div className="space-y-2" data-testid="admission-results">
          {files
            .filter((f) => f.status === 'done' || f.status === 'error')
            .map((f) => {
              const state = fileStates[f.id];
              if (!state) return null;

              return (
                <div
                  key={f.id}
                  className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  {state.status === 'admitted' ? (
                    <CheckCircle
                      className="mt-0.5 size-4 shrink-0 text-status-success"
                      aria-hidden="true"
                    />
                  ) : (
                    <XCircle
                      className="mt-0.5 size-4 shrink-0 text-destructive"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">
                      {f.file.name}
                    </p>
                    {state.status === 'admitted' ? (
                      <p className="text-xs text-muted-foreground">
                        {
                          RETENTION_CLASS_LABEL[
                            state.retentionClass ?? 'keep_and_watch'
                          ]
                        }
                        {state.wasMinted === false && ' · already connected'}
                      </p>
                    ) : (
                      <p className="text-xs text-destructive">{state.error}</p>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2">
        {hasResults && !isUploading && (
          <Button variant="outline" onClick={() => reset()}>
            Clear
          </Button>
        )}
        <Button
          onClick={handleUpload}
          disabled={pendingCount === 0 || isUploading}
        >
          {isUploading
            ? 'Connecting…'
            : `Connect ${pendingCount > 0 ? `(${pendingCount})` : ''}`}
        </Button>
      </div>

      {/* Cross-method suggestions and Claude prompt */}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-center">
          <ClaudePromptButton
            prompt={generateIngestDocumentPrompt().prompt}
            label="Open in Claude"
            size="sm"
          />
        </div>
        {onSwitchTab && (
          <p className="text-center text-xs text-muted-foreground">
            Or{' '}
            <button
              type="button"
              onClick={() => onSwitchTab('url')}
              className="rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              import from a URL
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
