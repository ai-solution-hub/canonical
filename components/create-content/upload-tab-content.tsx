'use client';

// ID-131.24 (G-UPLOAD-GATE, DR-025) rework: this tab used to drive TWO
// separate transports — the synchronous /api/upload content_items pipeline
// (Upload button) and a distinct folder-drop stage-then-poll flow (Stage &
// ingest button, polling content_items via source_file). Both are retired.
// There is now ONE binding gate (lib/upload/folder-drop.ts
// `stageAndWalk`, ID-138 {138.13}): gate-pass -> Storage PUT -> an
// admission-minted `source_documents` row, with NO content_items row. The
// UI reflects DR-025's framing — this is "connect a source" + assign a
// retention class, not "upload an authoritative document"; authority is
// earned later at promotion (DR-026), not at admission.
//
// id-417 second deletion wave (S529): the Q&A *detection* sub-flow is gone
// too. It previewed pairs that `lib/quality/qa-detection.ts` heuristically
// found in an uploaded document, then batch-created them via
// `POST /api/items/batch`. Both ends predeceased it — the endpoint was
// rebound away by ID-131 {131.21} (G-MANUAL-QA now posts to
// `/api/q-a-pairs/batch`) and the detector was retired as an ingest-era
// concept. The live "review Q&A pairs before batch creation" requirement is
// served by the Batch tab (`app/item/new/batch/batch-create-client.tsx` +
// `components/qa/batch-qa-preview-table.tsx`), not here. This tab's job is
// now solely connect-a-source.

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Upload, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileUpload } from '@/components/create-content/file-upload';
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';
import { generateIngestDocumentPrompt } from '@/lib/claude-prompts';
import {
  useFileUploadPipeline,
  type UploadRetentionClass,
} from '@/hooks/use-file-upload-pipeline';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UploadTabContentProps {
  /** Navigate to another tab (e.g. 'url') */
  onSwitchTab?: (tab: string) => void;
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

export function UploadTabContent({ onSwitchTab }: UploadTabContentProps) {
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
