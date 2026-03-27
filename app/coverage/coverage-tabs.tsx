'use client';

import { useState, useEffect } from 'react';
import {
  BarChart3,
  BookOpen,
  FileText,
  AlertTriangle,
  XCircle,
  AlertCircle,
  Target,
  ArrowRight,
  Grid3X3,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { CoverageContent } from './coverage-content';
import { TemplateCoverageContent } from '@/components/coverage/template-coverage-content';
import { CoverageGuideTab } from '@/components/coverage/coverage-guide-tab';
import { PriorityGapsTab } from '@/components/coverage/priority-gaps-tab';
import type { GapSummary } from '@/lib/templates/template-coverage';
import type { UnifiedGapSummary } from '@/types/unified-gap';

// ---------------------------------------------------------------------------
// Requirement type labels (UK English)
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  policy: 'Policy',
  statement: 'Statement',
  evidence: 'Evidence',
  data: 'Data',
  narrative: 'Narrative',
  declaration: 'Declaration',
  reference: 'Reference',
};

// ---------------------------------------------------------------------------
// Banner skeleton (shown while loading)
// ---------------------------------------------------------------------------

function GapSummaryBannerSkeleton() {
  return (
    <div
      className="rounded-lg border border-gap-summary-border bg-gap-summary-bg p-4"
      role="status"
      aria-label="Loading gap summary"
    >
      <div className="flex items-start gap-3">
        <Skeleton className="mt-0.5 size-5 shrink-0 rounded" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-48 rounded" />
          <Skeleton className="h-4 w-64 rounded" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gap summary banner
// ---------------------------------------------------------------------------

interface GapSummaryBannerProps {
  summary: GapSummary;
  unifiedSummary: UnifiedGapSummary | null;
  onViewTemplates: () => void;
  onViewPriorityGaps: () => void;
}

function GapSummaryBanner({
  summary,
  unifiedSummary,
  onViewTemplates,
  onViewPriorityGaps,
}: GapSummaryBannerProps) {
  // Derive counts: prefer unified summary if available, fall back to template-only
  const taxonomyGaps = unifiedSummary?.taxonomy_gaps ?? 0;
  const templateGaps = summary.total_gaps;
  const guideGaps = unifiedSummary?.guide_gaps ?? 0;
  const totalAcrossAllSources = taxonomyGaps + templateGaps + guideGaps;

  // Only show if there are template gaps/partials OR cross-source gaps
  const hasTemplateData = summary.templates_assessed > 0 && (summary.total_gaps > 0 || summary.total_partial > 0);
  const hasCrossSourceGaps = totalAcrossAllSources > 0;

  if (!hasTemplateData && !hasCrossSourceGaps) return null;

  const gapTypeEntries = Object.entries(summary.gaps_by_type).sort(
    ([, a], [, b]) => b - a,
  );
  const partialTypeEntries = Object.entries(summary.partial_by_type).sort(
    ([, a], [, b]) => b - a,
  );

  return (
    <div className="rounded-lg border border-gap-summary-border bg-gap-summary-bg p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 size-5 shrink-0 text-gap-summary-icon"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gap-summary-title">
            Action required: content gaps detected
          </p>

          {/* Cross-source gap summary */}
          <div className="mt-2 flex flex-col gap-1.5 text-sm text-gap-summary-text sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            {taxonomyGaps > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Grid3X3 className="size-3.5 shrink-0" aria-hidden="true" />
                <strong>{taxonomyGaps}</strong>{' '}
                taxonomy {taxonomyGaps === 1 ? 'gap' : 'gaps'}
              </span>
            )}
            {templateGaps > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                <strong>{templateGaps}</strong>{' '}
                template {templateGaps === 1 ? 'gap' : 'gaps'}
              </span>
            )}
            {guideGaps > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <BookOpen className="size-3.5 shrink-0" aria-hidden="true" />
                <strong>{guideGaps}</strong>{' '}
                guide {guideGaps === 1 ? 'gap' : 'gaps'}
              </span>
            )}
          </div>

          {/* Template-specific details (only if template gaps exist) */}
          {hasTemplateData && (
            <>
              <p className="mt-2 text-sm text-gap-summary-text">
                {summary.total_gaps > 0 && (
                  <>
                    <strong>{summary.total_gaps}</strong>{' '}
                    {summary.total_gaps === 1 ? 'gap' : 'gaps'}
                  </>
                )}
                {summary.total_gaps > 0 && summary.total_partial > 0 && ' and '}
                {summary.total_partial > 0 && (
                  <>
                    <strong>{summary.total_partial}</strong> partial{' '}
                    {summary.total_partial === 1 ? 'match' : 'matches'}
                  </>
                )}
                {' across '}
                <strong>{summary.templates_assessed}</strong>{' '}
                {summary.templates_assessed === 1 ? 'template' : 'templates'}
              </p>

              {/* Gap breakdown by type */}
              {gapTypeEntries.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {gapTypeEntries.map(([type, count]) => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-1 rounded-full bg-confidence-none-bg px-2 py-0.5 text-xs font-medium text-confidence-none"
                      aria-label={`Gap: ${count} ${TYPE_LABELS[type] ?? type}`}
                    >
                      <XCircle className="size-3" aria-hidden="true" />
                      <span className="font-semibold">Gap:</span> {count} {TYPE_LABELS[type] ?? type}
                    </span>
                  ))}
                </div>
              )}

              {/* Partial breakdown by type */}
              {partialTypeEntries.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {partialTypeEntries.map(([type, count]) => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-1 rounded-full bg-confidence-partial-bg px-2 py-0.5 text-xs font-medium text-confidence-partial"
                      aria-label={`Partial: ${count} ${TYPE_LABELS[type] ?? type}`}
                    >
                      <AlertCircle className="size-3" aria-hidden="true" />
                      <span className="font-semibold">Partial:</span> {count} {TYPE_LABELS[type] ?? type}
                    </span>
                  ))}
                </div>
              )}

              {/* Per-template breakdown */}
              {summary.gaps_by_template.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-gap-summary-text">
                  {summary.gaps_by_template.map((t) => (
                    <li key={t.template_name}>
                      <strong>{t.template_name}</strong>:{' '}
                      {t.gap_count > 0 && (
                        <>{t.gap_count} {t.gap_count === 1 ? 'gap' : 'gaps'}</>
                      )}
                      {t.gap_count > 0 && t.partial_count > 0 && ', '}
                      {t.partial_count > 0 && (
                        <>{t.partial_count} partial</>
                      )}
                      {' of '}{t.total}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* Action links */}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <button
              type="button"
              onClick={onViewPriorityGaps}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-medium text-gap-summary-link underline underline-offset-2 hover:text-gap-summary-link-hover"
            >
              View priority gaps
              <ArrowRight className="size-3" aria-hidden="true" />
            </button>
            {hasTemplateData && (
              <button
                type="button"
                onClick={onViewTemplates}
                className="inline-flex min-h-[44px] items-center text-xs font-medium text-gap-summary-link underline underline-offset-2 hover:text-gap-summary-link-hover"
              >
                View template coverage details
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CoveragePageTabs() {
  const [gapSummary, setGapSummary] = useState<GapSummary | null>(null);
  const [unifiedSummary, setUnifiedSummary] = useState<UnifiedGapSummary | null>(null);
  const [bannerLoading, setBannerLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('priority-gaps');

  useEffect(() => {
    let cancelled = false;

    async function fetchBannerData() {
      setBannerLoading(true);

      // Fetch template gap summary and unified gap summary in parallel
      const [gapResult, unifiedResult] = await Promise.allSettled([
        fetch('/api/coverage/gap-summary').then(async (res) => {
          if (!res.ok) return null;
          return res.json() as Promise<GapSummary>;
        }),
        fetch('/api/coverage/gaps?limit=0').then(async (res) => {
          if (!res.ok) return null;
          return res.json() as Promise<UnifiedGapSummary>;
        }),
      ]);

      if (cancelled) return;

      if (gapResult.status === 'fulfilled' && gapResult.value) {
        setGapSummary(gapResult.value);
      }
      if (unifiedResult.status === 'fulfilled' && unifiedResult.value) {
        setUnifiedSummary(unifiedResult.value);
      }

      setBannerLoading(false);
    }

    fetchBannerData();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Coverage Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Measure knowledge base completeness
          </p>
        </div>

        <TabsList>
          <TabsTrigger value="priority-gaps" className="gap-1.5">
            <Target className="size-3.5" aria-hidden="true" />
            Priority Gaps
          </TabsTrigger>
          <TabsTrigger value="taxonomy" className="gap-1.5">
            <BarChart3 className="size-3.5" aria-hidden="true" />
            Domain Coverage
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <FileText className="size-3.5" aria-hidden="true" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="guides" className="gap-1.5">
            <BookOpen className="size-3.5" aria-hidden="true" />
            Guides
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Gap summary banner — visible on all tabs */}
      <div className="mt-4">
        {bannerLoading ? (
          <GapSummaryBannerSkeleton />
        ) : gapSummary ? (
          <GapSummaryBanner
            summary={gapSummary}
            unifiedSummary={unifiedSummary}
            onViewTemplates={() => setActiveTab('templates')}
            onViewPriorityGaps={() => setActiveTab('priority-gaps')}
          />
        ) : null}
      </div>

      <TabsContent value="priority-gaps" className="mt-6">
        <PriorityGapsTab />
      </TabsContent>

      <TabsContent value="taxonomy" className="mt-6">
        <CoverageContent />
      </TabsContent>

      <TabsContent value="templates" className="mt-6">
        <TemplateCoverageContent />
      </TabsContent>

      <TabsContent value="guides" className="mt-6">
        <CoverageGuideTab />
      </TabsContent>
    </Tabs>
  );
}
