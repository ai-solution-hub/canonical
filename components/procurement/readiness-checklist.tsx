'use client';

import { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReadinessData } from '@/hooks/procurement/use-procurement-readiness';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReadinessChecklistProps {
  readiness: ReadinessData | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReadinessChecklist({
  readiness,
  isLoading,
  error,
  onRefresh,
}: ReadinessChecklistProps) {
  const [expandedIssues, setExpandedIssues] = useState(false);

  if (isLoading && !readiness) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2">
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <span className="text-sm text-muted-foreground">
            Checking readiness...
          </span>
        </div>
      </div>
    );
  }

  if (error && !readiness) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Could not check readiness: {error}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            className="gap-1.5"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!readiness) return null;

  const failedCount = readiness.criteria.filter((c) => !c.passed).length;
  const issueCount = readiness.issues.length;

  return (
    <div className="rounded-lg border bg-card p-4">
      {/* Header with status banner */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {readiness.ready ? (
            <>
              <ShieldCheck
                className="size-5 text-[var(--status-success)]"
                aria-hidden="true"
              />
              <h2 className="text-sm font-semibold text-[var(--status-success)]">
                Ready to export
              </h2>
            </>
          ) : (
            <>
              <AlertTriangle
                className="size-5 text-[var(--status-warning)]"
                aria-hidden="true"
              />
              <h2 className="text-sm font-semibold text-[var(--status-warning)]">
                {failedCount} {failedCount === 1 ? 'criterion' : 'criteria'} not
                met
              </h2>
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isLoading}
          className="gap-1.5"
          aria-label="Refresh readiness check"
        >
          {isLoading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          Refresh
        </Button>
      </div>

      {/* Summary stats */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {readiness.summary.answered}/{readiness.summary.total_questions}{' '}
          answered
        </span>
        <span>
          {readiness.summary.approved}/{readiness.summary.total_questions}{' '}
          approved
        </span>
        {readiness.summary.quality_checked > 0 && (
          <span>
            {readiness.summary.passing_quality}/
            {readiness.summary.quality_checked} passing quality
          </span>
        )}
      </div>

      {/* Criteria checklist */}
      <ul
        className="mt-3 space-y-1.5"
        role="list"
        aria-label="Readiness criteria"
      >
        {readiness.criteria.map((criterion) => (
          <li key={criterion.name} className="flex items-start gap-2">
            {criterion.passed ? (
              <CheckCircle
                className="mt-0.5 size-4 shrink-0 text-[var(--status-success)]"
                aria-label="Passed"
              />
            ) : (
              <XCircle
                className="mt-0.5 size-4 shrink-0 text-[var(--status-error)]"
                aria-label="Failed"
              />
            )}
            <div className="min-w-0">
              <span
                className={cn(
                  'text-sm',
                  criterion.passed
                    ? 'text-foreground'
                    : 'font-medium text-foreground',
                )}
              >
                {criterion.name}
              </span>
              <span className="ml-1.5 text-xs text-muted-foreground">
                {criterion.details}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* Expandable issues list */}
      {issueCount > 0 && (
        <div className="mt-3 border-t pt-3">
          <button
            type="button"
            onClick={() => setExpandedIssues(!expandedIssues)}
            className="flex w-full items-center gap-1.5 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors"
            aria-expanded={expandedIssues}
            aria-controls="readiness-issues-list"
          >
            {expandedIssues ? (
              <ChevronDown className="size-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4" aria-hidden="true" />
            )}
            {issueCount} {issueCount === 1 ? 'question' : 'questions'} with
            issues
          </button>

          {expandedIssues && (
            <ul
              id="readiness-issues-list"
              className="mt-2 space-y-2"
              role="list"
              aria-label="Per-question issues"
            >
              {readiness.issues.map((qi) => (
                <li
                  key={qi.question_number}
                  className="rounded-md bg-muted/50 px-3 py-2"
                >
                  <p className="text-sm font-medium text-foreground">
                    Q{qi.question_number}: {qi.question_title}
                  </p>
                  <ul className="mt-1 space-y-0.5" role="list">
                    {qi.issues.map((issue, idx) => (
                      <li
                        key={idx}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <span
                          className="text-[var(--status-error)]"
                          aria-hidden="true"
                        >
                          &bull;
                        </span>
                        {issue}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Readiness Badge (compact indicator for export button area)
// ---------------------------------------------------------------------------

interface ReadinessBadgeProps {
  readiness: ReadinessData | null;
  isLoading: boolean;
}

export function ReadinessBadge({ readiness, isLoading }: ReadinessBadgeProps) {
  if (isLoading || !readiness) return null;

  if (readiness.ready) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-[var(--freshness-fresh-bg)] px-2 py-0.5 text-xs font-medium text-[var(--freshness-fresh)]"
        title="All readiness criteria met"
      >
        <CheckCircle className="size-3" aria-hidden="true" />
        Ready
      </span>
    );
  }

  const failedCount = readiness.criteria.filter((c) => !c.passed).length;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[var(--freshness-aging-bg)] px-2 py-0.5 text-xs font-medium text-[var(--freshness-aging)]"
      title={`${failedCount} readiness ${failedCount === 1 ? 'criterion' : 'criteria'} not met`}
    >
      <AlertTriangle className="size-3" aria-hidden="true" />
      {failedCount} {failedCount === 1 ? 'issue' : 'issues'}
    </span>
  );
}
