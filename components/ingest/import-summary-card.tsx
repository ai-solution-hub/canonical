'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MarkdownBatchResultsSummary } from '@/types/ingest';

// ---------------------------------------------------------------------------
// Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §4.5 (mockup) + §6.4
//   (component placement). Plan: docs/plans/§1.11-ep2-build-plan.md row
//   EP2-T6.
//
// Renders the post-flight summary card returned by the import-phase
// orchestrator. The shape is `MarkdownBatchResultsSummary` (spec §5.4
// verbatim — same shape stamped onto `pipeline_runs.result`). The
// pipeline_run_id link points at /provenance?tab=pipeline-health which is
// the existing pipeline health UI on main (no `/admin/monitoring/pipeline-
// runs/[id]` route exists).
//
// "Retry" buttons on per-file errors are stubs — they fire `onRetry?(filename)`
// and the parent decides what to do. Background-queue retry is a post-EP2
// follow-up; for S212 the prop may be omitted entirely.
// ---------------------------------------------------------------------------

const EMPTY_STORED: MarkdownBatchResultsSummary['stored'] = [];
const EMPTY_DEDUP: MarkdownBatchResultsSummary['dedup_flagged'] = [];
const EMPTY_SUPERSEDED: MarkdownBatchResultsSummary['superseded'] = [];
const EMPTY_SKIPPED: MarkdownBatchResultsSummary['skipped_excluded'] = [];
const EMPTY_ERRORED: MarkdownBatchResultsSummary['errored'] = [];

export interface ImportSummaryCardProps {
  /** `pipeline_run_id` returned by POST /api/ingest/markdown phase=import. */
  pipelineRunId: string;
  /** Verbatim §5.4 results_summary block. */
  resultsSummary: MarkdownBatchResultsSummary;
  /**
   * Optional retry hook fired when the user clicks "Retry" on a per-file
   * error row. Background-queue retry is post-EP2; pass undefined to render
   * the row without a retry button.
   */
  onRetry?: (filename: string) => void;
  /** Fired when the user clicks "Import another batch". */
  onImportAnother?: () => void;
  /** Fired when the user clicks "Done". */
  onDone?: () => void;
}

interface CountTileProps {
  label: string;
  count: number;
  tone: 'neutral' | 'good' | 'warn' | 'bad';
  testId: string;
}

function CountTile({ label, count, tone, testId }: CountTileProps) {
  const toneClasses =
    tone === 'good'
      ? 'border-quality-good/40 bg-quality-good/10 text-quality-good'
      : tone === 'warn'
        ? 'border-status-warning/40 bg-status-warning/10 text-status-warning'
        : tone === 'bad'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-border bg-muted/40 text-foreground';

  return (
    <div
      className={`rounded-md border px-3 py-2 ${toneClasses}`}
      data-testid={testId}
    >
      <div className="text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className="text-xl font-semibold">{count}</div>
    </div>
  );
}

export function ImportSummaryCard({
  pipelineRunId,
  resultsSummary,
  onRetry,
  onImportAnother,
  onDone,
}: ImportSummaryCardProps) {
  // Stable empty fallbacks per G14.
  const stored = useMemo(
    () => resultsSummary.stored ?? EMPTY_STORED,
    [resultsSummary.stored],
  );
  const dedupFlagged = useMemo(
    () => resultsSummary.dedup_flagged ?? EMPTY_DEDUP,
    [resultsSummary.dedup_flagged],
  );
  const superseded = useMemo(
    () => resultsSummary.superseded ?? EMPTY_SUPERSEDED,
    [resultsSummary.superseded],
  );
  const skipped = useMemo(
    () => resultsSummary.skipped_excluded ?? EMPTY_SKIPPED,
    [resultsSummary.skipped_excluded],
  );
  const errored = useMemo(
    () => resultsSummary.errored ?? EMPTY_ERRORED,
    [resultsSummary.errored],
  );

  const filesProcessed = resultsSummary.files_processed ?? 0;

  return (
    <div
      className="space-y-4 rounded-lg border border-border bg-card p-6"
      data-testid="import-summary-card"
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-5 text-quality-good" aria-hidden="true" />
        <h3 className="text-lg font-semibold text-foreground">
          Import complete
        </h3>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <CountTile
          label="Files processed"
          count={filesProcessed}
          tone="neutral"
          testId="summary-tile-files-processed"
        />
        <CountTile
          label="New items stored"
          count={stored.length}
          tone="good"
          testId="summary-tile-stored"
        />
        <CountTile
          label="Dedup-flagged"
          count={dedupFlagged.length}
          tone="warn"
          testId="summary-tile-dedup"
        />
        <CountTile
          label="Auto-superseded"
          count={superseded.length}
          tone="warn"
          testId="summary-tile-superseded"
        />
        <CountTile
          label="Skipped"
          count={skipped.length}
          tone="neutral"
          testId="summary-tile-skipped"
        />
        <CountTile
          label="Errors"
          count={errored.length}
          tone={errored.length > 0 ? 'bad' : 'neutral'}
          testId="summary-tile-errors"
        />
      </div>

      {/* Per-file results */}
      <div className="space-y-2 border-t border-border pt-3">
        <h4 className="text-sm font-medium text-foreground">
          Per-file results
        </h4>
        <ul className="space-y-1.5 text-sm" data-testid="summary-per-file-list">
          {stored.map((row) => (
            <li
              key={`stored-${row.filename}`}
              className="flex flex-wrap items-center gap-2"
              data-testid={`summary-row-stored-${row.filename}`}
            >
              <CheckCircle2
                className="size-3.5 shrink-0 text-quality-good"
                aria-hidden="true"
              />
              <span className="font-medium text-foreground">
                {row.filename}
              </span>
              <span aria-hidden="true" className="text-muted-foreground">
                &rarr;
              </span>
              <a
                href={`/item/${row.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Open item
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
              <span className="truncate text-xs text-muted-foreground">
                {row.title}
              </span>
            </li>
          ))}
          {dedupFlagged.map((row) => (
            <li
              key={`dedup-${row.filename}`}
              className="flex flex-wrap items-center gap-2"
              data-testid={`summary-row-dedup-${row.filename}`}
            >
              <AlertTriangle
                className="size-3.5 shrink-0 text-status-warning"
                aria-hidden="true"
              />
              <span className="font-medium text-foreground">
                {row.filename}
              </span>
              <span aria-hidden="true" className="text-muted-foreground">
                &rarr;
              </span>
              <span className="text-status-warning">
                SUSPECTED-DUPLICATE of &ldquo;{row.title}&rdquo; (
                {row.suspected_duplicate_of})
              </span>
              <a
                href="/review/dedup"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Resolve in dedup queue
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </li>
          ))}
          {superseded.map((row) => (
            <li
              key={`superseded-${row.filename}`}
              className="flex flex-wrap items-center gap-2"
              data-testid={`summary-row-superseded-${row.filename}`}
            >
              <CheckCircle2
                className="size-3.5 shrink-0 text-status-warning"
                aria-hidden="true"
              />
              <span className="font-medium text-foreground">
                {row.filename}
              </span>
              <span className="text-status-warning">
                Auto-superseded {row.old_id} &rarr;
              </span>
              <a
                href={`/item/${row.new_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {row.new_id}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </li>
          ))}
          {skipped.map((filename) => (
            <li
              key={`skipped-${filename}`}
              className="flex flex-wrap items-center gap-2 text-muted-foreground"
              data-testid={`summary-row-skipped-${filename}`}
            >
              <span aria-hidden="true">&middot;</span>
              <span className="font-medium">{filename}</span>
              <span>Skipped</span>
            </li>
          ))}
          {errored.map((row) => (
            <li
              key={`error-${row.filename}`}
              className="flex flex-wrap items-center gap-2"
              data-testid={`summary-row-error-${row.filename}`}
            >
              <XCircle
                className="size-3.5 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <span className="font-medium text-foreground">
                {row.filename}
              </span>
              <span className="text-destructive">ERROR: {row.error}</span>
              {onRetry && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => onRetry(row.filename)}
                  aria-label={`Retry ${row.filename}`}
                >
                  <RefreshCw className="size-3" aria-hidden="true" />
                  Retry
                </Button>
              )}
            </li>
          ))}
          {filesProcessed === 0 &&
            stored.length === 0 &&
            dedupFlagged.length === 0 &&
            superseded.length === 0 &&
            skipped.length === 0 &&
            errored.length === 0 && (
              <li className="text-xs text-muted-foreground">
                No files were processed.
              </li>
            )}
        </ul>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <a
          href="/provenance?tab=pipeline-health"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          data-testid="summary-pipeline-run-link"
        >
          Pipeline run ID:{' '}
          <span className="font-mono text-foreground">{pipelineRunId}</span>
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
        <div className="flex items-center gap-2">
          {onImportAnother && (
            <Button variant="outline" size="sm" onClick={onImportAnother}>
              Import another batch
            </Button>
          )}
          {onDone && (
            <Button size="sm" onClick={onDone}>
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
