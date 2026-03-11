'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, FileText, CheckCircle, AlertCircle, XCircle, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { TemplateCoverageSection } from '@/components/template-coverage-section';
import type { TemplateCoverageResult, TemplateSummary } from '@/lib/template-coverage';

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function TemplateCoverageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function TemplateEmpty() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <FileText className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <h3 className="mt-4 text-base font-medium text-foreground">
        No templates catalogued
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Template requirements need to be added before coverage can be measured.
        Use Claude Desktop to catalogue a template via MCP tools.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function TemplateError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-card px-6 py-12 text-center">
      <FileText className="size-8 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
        <RefreshCw className="size-3.5" aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary stat card
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  count,
  colourClass,
}: {
  icon: typeof CheckCircle;
  label: string;
  count: number;
  colourClass: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <div className={cn('flex size-10 items-center justify-center rounded-lg', colourClass)}>
        <Icon className="size-5 text-inherit" aria-hidden="true" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold text-foreground">{count}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template type labels
// ---------------------------------------------------------------------------

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  sq: 'Selection Questionnaire',
  rfp: 'Request for Proposal',
  pqq: 'Pre-Qualification Questionnaire',
  eqq: 'Evaluation Quality Questionnaire',
  gcloud: 'G-Cloud',
  method_statement: 'Method Statement',
  dos: 'Digital Outcomes & Specialists',
  dps: 'Dynamic Purchasing System',
  framework: 'Framework',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TemplateCoverageContent() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<TemplateCoverageResult | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [isLoadingCoverage, setIsLoadingCoverage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch template list
  const fetchTemplates = useCallback(async () => {
    setIsLoadingTemplates(true);
    setError(null);
    try {
      const res = await fetch('/api/coverage/templates/list');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load templates (${res.status})`);
      }
      const json = await res.json();
      setTemplates(json.templates ?? []);

      // Auto-select first template
      if (json.templates?.length > 0 && !selectedTemplate) {
        setSelectedTemplate(json.templates[0].template_name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setIsLoadingTemplates(false);
    }
  }, [selectedTemplate]);

  // Fetch coverage for selected template
  const fetchCoverage = useCallback(async (templateName: string) => {
    setIsLoadingCoverage(true);
    setError(null);
    try {
      const params = new URLSearchParams({ template_name: templateName });
      const res = await fetch(`/api/coverage/templates?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load coverage (${res.status})`);
      }
      const json: TemplateCoverageResult = await res.json();
      setCoverage(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load coverage');
    } finally {
      setIsLoadingCoverage(false);
    }
  }, []);

  // Fetch templates on mount
  useEffect(() => {
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch coverage when selection changes
  useEffect(() => {
    if (selectedTemplate) {
      fetchCoverage(selectedTemplate);
    }
  }, [selectedTemplate, fetchCoverage]);

  const handleTemplateChange = useCallback((value: string) => {
    setSelectedTemplate(value);
  }, []);

  const handleRetry = useCallback(() => {
    if (templates.length === 0) {
      fetchTemplates();
    } else if (selectedTemplate) {
      fetchCoverage(selectedTemplate);
    }
  }, [templates.length, selectedTemplate, fetchTemplates, fetchCoverage]);

  // Score as percentage
  const scorePercent = coverage ? Math.round(coverage.score * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header row: selector + refresh */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Template Coverage
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            How well your KB covers specific bid template requirements
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isLoadingTemplates ? (
            <Skeleton className="h-9 w-[220px]" />
          ) : templates.length > 0 ? (
            <Select
              value={selectedTemplate ?? undefined}
              onValueChange={handleTemplateChange}
            >
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="Select template…" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.template_name} value={t.template_name}>
                    <span className="flex items-center gap-2">
                      <span>{t.template_name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({t.requirement_count})
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            disabled={isLoadingCoverage || isLoadingTemplates}
            className="gap-1.5"
          >
            <RefreshCw
              className={cn(
                'size-3.5',
                (isLoadingCoverage || isLoadingTemplates) && 'animate-spin',
              )}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoadingTemplates ? (
        <div role="status" aria-label="Loading templates">
          <TemplateCoverageSkeleton />
        </div>
      ) : error ? (
        <TemplateError message={error} onRetry={handleRetry} />
      ) : templates.length === 0 ? (
        <TemplateEmpty />
      ) : isLoadingCoverage ? (
        <div role="status" aria-label="Loading coverage data">
          <TemplateCoverageSkeleton />
        </div>
      ) : coverage ? (
        <>
          {/* Template info + score */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-medium text-foreground">{coverage.template_name}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {TEMPLATE_TYPE_LABELS[coverage.template_type] ?? coverage.template_type}
                  {coverage.template_version && ` · ${coverage.template_version}`}
                  {' · '}
                  {coverage.total_requirements} requirements
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-2xl font-bold text-foreground">{scorePercent}%</p>
                  <p className="text-xs text-muted-foreground">coverage</p>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <Progress value={scorePercent} className="h-2.5" />
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={CheckCircle}
              label="Strong"
              count={coverage.strong_count}
              colourClass="bg-confidence-strong-bg text-confidence-strong"
            />
            <StatCard
              icon={AlertCircle}
              label="Partial"
              count={coverage.partial_count}
              colourClass="bg-confidence-partial-bg text-confidence-partial"
            />
            <StatCard
              icon={XCircle}
              label="Gaps"
              count={coverage.gap_count}
              colourClass="bg-confidence-none-bg text-confidence-none"
            />
            <StatCard
              icon={Minus}
              label="N/A"
              count={coverage.na_count}
              colourClass="bg-muted text-muted-foreground"
            />
          </div>

          {/* Section breakdown */}
          <div className="space-y-4">
            {coverage.sections.map((section, index) => (
              <TemplateCoverageSection
                key={section.section_ref}
                sectionRef={section.section_ref}
                sectionName={section.section_name}
                requirements={section.requirements}
                defaultExpanded={index === 0}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
