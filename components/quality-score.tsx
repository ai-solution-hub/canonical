'use client';

import { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { QualityData, QualityIssueEntry } from '@/types/bid-metadata';

interface QualityScoreProps {
  quality: QualityData;
  className?: string;
}

function getScoreColour(score: number): string {
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-destructive';
}

function getScoreBg(score: number): string {
  if (score >= 80) return 'bg-emerald-50 dark:bg-emerald-950/30';
  if (score >= 60) return 'bg-amber-50 dark:bg-amber-950/30';
  return 'bg-red-50 dark:bg-red-950/30';
}

function getSeverityIcon(severity: QualityIssueEntry['severity']) {
  switch (severity) {
    case 'error':
      return <XCircle className="size-3.5 text-destructive" />;
    case 'warning':
      return <AlertTriangle className="size-3.5 text-amber-500" />;
    case 'info':
      return <Lightbulb className="size-3.5 text-blue-500" />;
  }
}

export function QualityScore({ quality, className }: QualityScoreProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const errorCount = quality.issues.filter((i) => i.severity === 'error').length;
  const warningCount = quality.issues.filter((i) => i.severity === 'warning').length;

  return (
    <div className={cn('rounded-md border', className)}>
      {/* Summary bar */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex w-full items-center justify-between px-4 py-2 text-sm transition-colors hover:bg-muted/50',
          getScoreBg(quality.overall_score),
        )}
        aria-expanded={isExpanded}
        type="button"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className={cn('font-semibold tabular-nums', getScoreColour(quality.overall_score))}>
            Quality: {quality.overall_score}/100
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {quality.word_limit_compliance ? (
              <CheckCircle2 className="size-3 text-emerald-500" />
            ) : (
              <XCircle className="size-3 text-destructive" />
            )}
            {quality.word_count} words
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3 text-emerald-500" />
            {quality.citation_count} citation{quality.citation_count !== 1 ? 's' : ''}
          </span>
          {errorCount > 0 && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </Badge>
          )}
          {warningCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500 text-amber-600">
              {warningCount} warning{warningCount !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="border-t px-4 py-3 space-y-3">
          {/* Issues */}
          {quality.issues.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Issues
              </h4>
              {quality.issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  {getSeverityIcon(issue.severity)}
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Suggestions */}
          {quality.suggestions.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Suggestions
              </h4>
              {quality.suggestions.map((suggestion, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <Lightbulb className="size-3.5 text-blue-500 mt-0.5 shrink-0" />
                  <span>{suggestion}</span>
                </div>
              ))}
            </div>
          )}

          {/* No issues */}
          {quality.issues.length === 0 && quality.suggestions.length === 0 && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-500" />
              No issues found. Response looks good.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
