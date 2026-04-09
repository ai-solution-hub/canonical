'use client';

import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { FlagAnalysisResult } from '@/types/intelligence-refinement';

/**
 * FlagAnalysisView — pure presentation for a `FlagAnalysisResult`.
 *
 * Sections:
 *  1. Summary card
 *  2. Optional truncation banner
 *  3. False positive pattern clusters (collapsible, collapsed if >3)
 *  4. False negative pattern clusters (same treatment)
 *  5. Recommendations (ordered by impact)
 *  6. Confidence notes
 *
 * No callbacks — this is a display-only component. Any actions
 * (apply / preview / dismiss) are the container's responsibility.
 *
 * Accessibility: every colour-coded element also carries a text
 * marker — `[+ Add]`, `[- Remove]`, `[↻ Reword]` — so users without
 * colour perception (and any assistive tech) can tell what each
 * recommendation is doing.
 */

interface FlagAnalysisViewProps {
  result: FlagAnalysisResult;
}

type RecommendationType = 'add' | 'remove' | 'reword';

const RECOMMENDATION_BADGE: Record<
  RecommendationType,
  { label: string; className: string }
> = {
  add: {
    label: '[+ Add]',
    className: 'bg-status-success/15 text-status-success border-status-success/30',
  },
  remove: {
    label: '[- Remove]',
    className: 'bg-status-error/15 text-status-error border-status-error/30',
  },
  reword: {
    label: '[↻ Reword]',
    className: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  },
};

interface PatternCluster {
  pattern: string;
  articleCount: number;
  articles: string[];
  rootCause: string;
}

interface PatternSectionProps {
  heading: string;
  description: string;
  clusters: readonly PatternCluster[];
  /** Emptiness copy when the cluster list is empty. */
  emptyCopy: string;
}

/**
 * Render a list of pattern clusters using native `<details>` for
 * keyboard-accessible collapse/expand with no extra JS. If there are
 * more than three clusters the group starts collapsed so the page
 * remains scannable.
 */
function PatternSection({
  heading,
  description,
  clusters,
  emptyCopy,
}: PatternSectionProps) {
  const startCollapsed = clusters.length > 3;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
      {clusters.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyCopy}</p>
      ) : (
        <ul className="space-y-2">
          {clusters.map((cluster, idx) => (
            <li key={`${heading}-${idx}`}>
              <details
                className="rounded-md border bg-card px-3 py-2"
                open={!startCollapsed}
              >
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  {cluster.pattern}{' '}
                  <span className="text-xs text-muted-foreground">
                    ({cluster.articleCount}{' '}
                    {cluster.articleCount === 1 ? 'article' : 'articles'})
                  </span>
                </summary>
                <div className="mt-2 space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      Root cause:
                    </span>{' '}
                    {cluster.rootCause}
                  </p>
                  {cluster.articles.length > 0 && (
                    <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
                      {cluster.articles.map((title, articleIdx) => (
                        <li key={`${idx}-${articleIdx}`}>{title}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FlagAnalysisView({ result }: FlagAnalysisViewProps) {
  // Order recommendations by affectedFlags descending so high-impact
  // changes surface first. Stable sort via `.slice()` to avoid mutating
  // the prop.
  const orderedRecommendations = useMemo(
    () =>
      result.recommendations
        .slice()
        .sort((a, b) => b.affectedFlags - a.affectedFlags),
    [result.recommendations],
  );

  return (
    <div className="space-y-6" data-testid="flag-analysis-view">
      {/* Summary */}
      <section
        aria-label="Analysis summary"
        className="rounded-md border bg-muted/40 p-4"
      >
        <h3 className="mb-1 text-sm font-semibold text-foreground">Summary</h3>
        <p className="text-sm text-foreground">{result.summary}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Analysed {result.analysedFlagCount}{' '}
          {result.analysedFlagCount === 1 ? 'flag' : 'flags'}.
        </p>
      </section>

      {/* Truncation banner */}
      {result.truncated && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-status-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Only the most recent {result.analysedFlagCount} flags were
            analysed. Re-run the analysis after resolving these to cover older
            ones.
          </p>
        </div>
      )}

      {/* False positive patterns */}
      <PatternSection
        heading="False positive patterns"
        description="Articles the prompt is over-weighting — passing when they should be filtered."
        clusters={result.falsePositivePatterns}
        emptyCopy="No false positive clusters were identified."
      />

      {/* False negative patterns */}
      <PatternSection
        heading="False negative patterns"
        description="Articles the prompt is missing — filtering when they should be passing."
        clusters={result.falseNegativePatterns}
        emptyCopy="No false negative clusters were identified."
      />

      {/* Recommendations */}
      <section aria-label="Recommendations" className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          Recommendations
        </h3>
        {orderedRecommendations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recommended changes. The analysis did not produce any
            actionable prompt edits.
          </p>
        ) : (
          <ol className="space-y-3">
            {orderedRecommendations.map((rec, idx) => {
              const badge = RECOMMENDATION_BADGE[rec.type as RecommendationType];
              return (
                <li
                  key={`rec-${idx}`}
                  className="rounded-md border bg-card p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">
                      #{idx + 1}
                    </span>
                    <span
                      className={cn(
                        'rounded-sm border px-1.5 py-0.5 text-xs font-medium',
                        badge.className,
                      )}
                    >
                      {badge.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {rec.section}
                    </span>
                    <Badge variant="secondary" className="ml-auto">
                      {rec.affectedFlags}{' '}
                      {rec.affectedFlags === 1 ? 'flag' : 'flags'}
                    </Badge>
                  </div>

                  {/* Inline current vs proposed */}
                  <div className="space-y-1 text-sm">
                    {rec.type === 'add' && (
                      <p className="rounded-sm bg-status-success/10 px-2 py-1 text-status-success">
                        <span className="font-semibold">[+ Added] </span>
                        {rec.proposedText}
                      </p>
                    )}
                    {rec.type === 'remove' && rec.currentText && (
                      <p className="rounded-sm bg-status-error/10 px-2 py-1 text-status-error line-through">
                        <span className="font-semibold no-underline">
                          [- Removed]{' '}
                        </span>
                        {rec.currentText}
                      </p>
                    )}
                    {rec.type === 'reword' && (
                      <>
                        {rec.currentText && (
                          <p className="rounded-sm bg-status-error/10 px-2 py-1 text-status-error line-through">
                            <span className="font-semibold no-underline">
                              [- Before]{' '}
                            </span>
                            {rec.currentText}
                          </p>
                        )}
                        <p className="rounded-sm bg-status-success/10 px-2 py-1 text-status-success">
                          <span className="font-semibold">[+ After] </span>
                          {rec.proposedText}
                        </p>
                      </>
                    )}
                  </div>

                  <p className="mt-2 text-xs text-muted-foreground">
                    {rec.reasoning}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Confidence notes */}
      {result.confidenceNotes && (
        <section
          aria-label="Confidence notes"
          className="border-t pt-3 text-xs text-muted-foreground"
        >
          <span className="font-semibold text-foreground">Confidence: </span>
          {result.confidenceNotes}
        </section>
      )}
    </div>
  );
}
