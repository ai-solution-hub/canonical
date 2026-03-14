'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart3, BookOpen, FileText, AlertTriangle, XCircle, AlertCircle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CoverageContent } from './coverage-content';
import { TemplateCoverageContent } from '@/components/template-coverage-content';
import { CoverageGuideTab } from '@/components/coverage-guide-tab';
import type { GapSummary } from '@/lib/template-coverage';

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
// Gap summary banner
// ---------------------------------------------------------------------------

function GapSummaryBanner({
  summary,
  onViewTemplates,
}: {
  summary: GapSummary;
  onViewTemplates: () => void;
}) {
  if (summary.templates_assessed === 0) return null;
  if (summary.total_gaps === 0 && summary.total_partial === 0) return null;

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
          <p className="mt-1 text-sm text-gap-summary-text">
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
                >
                  <XCircle className="size-3" aria-hidden="true" />
                  {count} {TYPE_LABELS[type] ?? type}
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
                >
                  <AlertCircle className="size-3" aria-hidden="true" />
                  {count} {TYPE_LABELS[type] ?? type}
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

          <button
            type="button"
            onClick={onViewTemplates}
            className="mt-2 text-xs font-medium text-gap-summary-link underline underline-offset-2 hover:text-gap-summary-link-hover"
          >
            View template coverage details
          </button>
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
  const [activeTab, setActiveTab] = useState('taxonomy');

  const fetchGapSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/coverage/gap-summary');
      if (!res.ok) return;
      const data: GapSummary = await res.json();
      setGapSummary(data);
    } catch {
      // Silently fail — the banner is supplementary
    }
  }, []);

  useEffect(() => {
    fetchGapSummary();
  }, [fetchGapSummary]);

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
          <TabsTrigger value="taxonomy" className="gap-1.5">
            <BarChart3 className="size-3.5" aria-hidden="true" />
            Taxonomy
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
      {gapSummary && (
        <div className="mt-4">
          <GapSummaryBanner
            summary={gapSummary}
            onViewTemplates={() => setActiveTab('templates')}
          />
        </div>
      )}

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
