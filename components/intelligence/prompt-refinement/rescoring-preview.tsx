'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type {
  RescoringPreviewResponse,
  RescoringPreviewResult,
} from '@/types/intelligence-refinement';

/**
 * RescoringPreview — groups preview results into three buckets based
 * on a pass/fail threshold of 0.5:
 *
 *   newlyFiltered  — existing passed, candidate fails (shown FIRST,
 *                    warning-coloured because losing relevant articles
 *                    is worse than gaining noisy ones)
 *   newlyPassed    — existing failed, candidate passes
 *   unchanged      — same pass/fail state on both (collapsed by default
 *                    with a Show/Hide toggle)
 *
 * Every colour-coded delta also carries a direction icon and a text
 * suffix ("FILTERED" / "PASSED") so colour is never the only signal.
 */

interface RescoringPreviewProps {
  result: RescoringPreviewResponse;
}

const PASS_THRESHOLD = 0.5;

type Bucket = 'newly-filtered' | 'newly-passed' | 'unchanged';

function bucketForResult(row: RescoringPreviewResult): Bucket {
  const existingPass = (row.existing_score ?? 0) >= PASS_THRESHOLD;
  const candidatePass = row.candidate_score >= PASS_THRESHOLD;
  if (existingPass && !candidatePass) return 'newly-filtered';
  if (!existingPass && candidatePass) return 'newly-passed';
  return 'unchanged';
}

function formatDelta(delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  return `${sign}${Math.abs(delta).toFixed(2)}`;
}

function formatScore(score: number | null): string {
  return score === null ? '—' : score.toFixed(2);
}

interface ResultRowProps {
  row: RescoringPreviewResult;
  bucket: Bucket;
}

function ResultRow({ row, bucket }: ResultRowProps) {
  const Icon =
    row.score_delta > 0 ? ArrowUp : row.score_delta < 0 ? ArrowDown : Minus;

  const suffix =
    bucket === 'newly-filtered'
      ? 'FILTERED'
      : bucket === 'newly-passed'
        ? 'PASSED'
        : '';

  const deltaTone =
    bucket === 'newly-filtered'
      ? 'text-status-warning'
      : bucket === 'newly-passed'
        ? 'text-status-success'
        : 'text-muted-foreground';

  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3 text-sm text-foreground">{row.title}</td>
      <td className="py-2 pr-3 text-right font-mono text-xs text-muted-foreground">
        {formatScore(row.existing_score)}
      </td>
      <td className="py-2 pr-3 text-right font-mono text-xs text-muted-foreground">
        {row.candidate_score.toFixed(2)}
      </td>
      <td className={cn('py-2 text-right font-mono text-xs', deltaTone)}>
        <span className="inline-flex items-center justify-end gap-1">
          <Icon className="size-3" aria-hidden="true" />
          <span>{formatDelta(row.score_delta)}</span>
          {suffix && (
            <span className="ml-1 text-[0.65rem] font-semibold uppercase tracking-wide">
              {suffix}
            </span>
          )}
        </span>
      </td>
    </tr>
  );
}

interface ResultTableProps {
  rows: RescoringPreviewResult[];
  bucket: Bucket;
}

function ResultTable({ rows, bucket }: ResultTableProps) {
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b text-xs text-muted-foreground">
          <th className="py-1 pr-3 font-medium">Title</th>
          <th className="py-1 pr-3 text-right font-medium">Existing</th>
          <th className="py-1 pr-3 text-right font-medium">Candidate</th>
          <th className="py-1 text-right font-medium">Delta</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <ResultRow key={row.article_id} row={row} bucket={bucket} />
        ))}
      </tbody>
    </table>
  );
}

export function RescoringPreview({ result }: RescoringPreviewProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);

  const { newlyFiltered, newlyPassed, unchanged } = useMemo(() => {
    const nf: RescoringPreviewResult[] = [];
    const np: RescoringPreviewResult[] = [];
    const uc: RescoringPreviewResult[] = [];
    for (const row of result.results) {
      const bucket = bucketForResult(row);
      if (bucket === 'newly-filtered') nf.push(row);
      else if (bucket === 'newly-passed') np.push(row);
      else uc.push(row);
    }
    return { newlyFiltered: nf, newlyPassed: np, unchanged: uc };
  }, [result.results]);

  // Empty-sample edge case — placed AFTER all hooks so hook order is stable.
  if (result.samples === 0) {
    return (
      <section
        aria-label="Re-scoring preview"
        className="rounded-md border bg-card p-4"
        data-testid="rescoring-preview-empty"
      >
        <h3 className="mb-1 text-sm font-semibold text-foreground">
          Impact preview
        </h3>
        <p className="text-sm text-muted-foreground">
          No articles available for preview. Ingest some articles first.
        </p>
      </section>
    );
  }

  const meanDeltaLabel =
    result.mean_delta >= 0
      ? `+${result.mean_delta.toFixed(2)}`
      : result.mean_delta.toFixed(2);

  const warnings = result.warnings ?? [];

  return (
    <section
      aria-label="Re-scoring preview"
      className="space-y-4 rounded-md border bg-card p-4"
      data-testid="rescoring-preview"
    >
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">
          Impact preview
        </h3>
        <p className="text-sm text-muted-foreground">
          {result.samples}{' '}
          {result.samples === 1 ? 'article' : 'articles'} re-scored.{' '}
          {newlyFiltered.length} newly filtered, {newlyPassed.length} newly
          passed, {unchanged.length} unchanged.
        </p>
        <p className="text-xs text-muted-foreground">
          Average score change: {meanDeltaLabel}
        </p>
      </header>

      {warnings.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="mb-1 font-semibold">
              Partial preview — some articles could not be re-scored
            </p>
            <ul className="list-disc space-y-0.5 pl-4">
              {warnings.map((warning, idx) => (
                <li key={idx}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Newly filtered — shown FIRST because losing coverage is the
          higher-impact change. */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-status-warning">
          <AlertTriangle className="size-3" aria-hidden="true" />
          Newly filtered ({newlyFiltered.length})
        </h4>
        {newlyFiltered.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No articles would lose coverage.
          </p>
        ) : (
          <div className="rounded-md border border-status-warning/30 bg-status-warning/5 p-2">
            <ResultTable rows={newlyFiltered} bucket="newly-filtered" />
          </div>
        )}
      </div>

      {/* Newly passed */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-status-success">
          Newly passed ({newlyPassed.length})
        </h4>
        {newlyPassed.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No articles would gain coverage.
          </p>
        ) : (
          <div className="rounded-md border border-status-success/30 bg-status-success/5 p-2">
            <ResultTable rows={newlyPassed} bucket="newly-passed" />
          </div>
        )}
      </div>

      {/* Unchanged — collapsed by default */}
      <div className="space-y-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={showUnchanged}
          onClick={() => setShowUnchanged((prev) => !prev)}
        >
          {showUnchanged ? 'Hide' : 'Show'} unchanged ({unchanged.length})
        </Button>
        {showUnchanged && unchanged.length > 0 && (
          <div className="rounded-md border p-2">
            <ResultTable rows={unchanged} bucket="unchanged" />
          </div>
        )}
      </div>
    </section>
  );
}
