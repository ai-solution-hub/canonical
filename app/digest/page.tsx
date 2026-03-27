'use client';

import { useState, useEffect, useCallback } from 'react';
import { handleTablistKeyDown } from '@/lib/tablist-keyboard';
import {
  Loader2,
  FileText,
  RefreshCw,
  Calendar,
  BookCheck,
  Filter,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DigestView } from '@/components/digest/digest-view';
import { formatDate } from '@/lib/format';
import { digestTypeLabel } from '@/lib/digest/digest-helpers';
import { useReadMarks } from '@/contexts/read-marks-context';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import type { Digest } from '@/types/digest';

type DigestMode = 'preset' | 'daily' | 'custom';

const PERIOD_OPTIONS = [
  { value: '7', label: 'Last 7 days', type: 'weekly' as const },
  { value: '14', label: 'Last 14 days', type: 'custom' as const },
  { value: '30', label: 'Last 30 days', type: 'custom' as const },
];

// Domain options are now loaded from taxonomy context in the page component

function DigestSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  );
}

interface PastDigestEntry {
  id: string;
  digest_type: string;
  period_start: string;
  period_end: string;
  item_count: number;
  created_at: string;
}

/**
 * Format a date to YYYY-MM-DD for use with date inputs.
 */
function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Extracted sub-components (previously defined inside DigestPage body)
// ---------------------------------------------------------------------------

interface ModeSelectorProps {
  mode: DigestMode;
  onModeChange: (mode: DigestMode) => void;
}

function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
  return (
    <div role="tablist" aria-label="Report mode" onKeyDown={handleTablistKeyDown} className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
      <button
        role="tab"
        id="tab-preset"
        aria-selected={mode === 'preset'}
        aria-controls="digest-content-panel"
        tabIndex={mode === 'preset' ? 0 : -1}
        onClick={() => onModeChange('preset')}
        className={`rounded-md px-2 py-1.5 text-sm font-medium transition-colors sm:px-3 ${
          mode === 'preset'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Calendar className="inline-block size-3.5 sm:mr-1.5" />
        <span className="sm:hidden">7d</span>
        <span className="hidden sm:inline">Period</span>
      </button>
      <button
        role="tab"
        id="tab-daily"
        aria-selected={mode === 'daily'}
        aria-controls="digest-content-panel"
        tabIndex={mode === 'daily' ? 0 : -1}
        onClick={() => onModeChange('daily')}
        className={`rounded-md px-2 py-1.5 text-sm font-medium transition-colors sm:px-3 ${
          mode === 'daily'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Calendar className="inline-block size-3.5 sm:mr-1.5" />
        <span className="sm:hidden">1d</span>
        <span className="hidden sm:inline">Daily</span>
      </button>
      <button
        role="tab"
        id="tab-custom"
        aria-selected={mode === 'custom'}
        aria-controls="digest-content-panel"
        tabIndex={mode === 'custom' ? 0 : -1}
        onClick={() => onModeChange('custom')}
        className={`rounded-md px-2 py-1.5 text-sm font-medium transition-colors sm:px-3 ${
          mode === 'custom'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <SlidersHorizontal className="inline-block size-3.5 sm:mr-1.5" />
        <span className="sm:hidden">Filter</span>
        <span className="hidden sm:inline">Custom</span>
      </button>
    </div>
  );
}

interface GenerateControlsProps {
  variant: 'hero' | 'bar';
  mode: DigestMode;
  onModeChange: (mode: DigestMode) => void;
  generating: boolean;
  onGenerate: () => void;
  periodDays: string;
  onPeriodDaysChange: (value: string) => void;
  customDateFrom: string;
  onCustomDateFromChange: (value: string) => void;
  customDateTo: string;
  onCustomDateToChange: (value: string) => void;
  customDomain: string;
  onCustomDomainChange: (value: string) => void;
  customKeywords: string;
  onCustomKeywordsChange: (value: string) => void;
  domainOptions: string[];
}

function GenerateControls({
  variant,
  mode,
  onModeChange,
  generating,
  onGenerate,
  periodDays,
  onPeriodDaysChange,
  customDateFrom,
  onCustomDateFromChange,
  customDateTo,
  onCustomDateToChange,
  customDomain,
  onCustomDomainChange,
  customKeywords,
  onCustomKeywordsChange,
  domainOptions,
}: GenerateControlsProps) {
  const buttonVariant = variant === 'hero' ? 'default' : 'outline';
  const buttonSize = variant === 'hero' ? 'lg' : 'default';

  return (
    <div className="space-y-4">
      <div className={cn('flex flex-wrap items-center gap-3', variant === 'hero' && 'justify-center')}>
        <ModeSelector mode={mode} onModeChange={onModeChange} />
      </div>

      <div
        role="tabpanel"
        id="digest-content-panel"
        aria-labelledby={`tab-${mode}`}
      >
        <div className={cn('flex flex-wrap items-center gap-3', variant === 'hero' && 'justify-center')}>
        {mode === 'preset' && (
          <Select value={periodDays} onValueChange={onPeriodDaysChange}>
            <SelectTrigger className="w-[160px]">
              <Calendar className="size-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {mode === 'daily' && (
          <span className="text-sm text-muted-foreground">
            Summarise today&apos;s new additions
          </span>
        )}

        {mode !== 'custom' && (
          <Button
            onClick={onGenerate}
            disabled={generating}
            variant={buttonVariant}
            size={buttonSize}
          >
            {generating ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                {mode === 'daily' ? (
                  <RefreshCw className="size-4" />
                ) : variant === 'hero' ? (
                  <RefreshCw className="size-4" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {variant === 'hero' ? 'Generate Report' : 'Generate New Report'}
              </>
            )}
          </Button>
        )}

        </div>

      {/* Custom filter panel */}
      {mode === 'custom' && (
        <div className="mt-4 rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Filter className="size-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Custom Report Filters
            </h3>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Date range */}
            <div className="space-y-2">
              <Label htmlFor="date-from">From</Label>
              <Input
                id="date-from"
                type="date"
                value={customDateFrom}
                onChange={(e) => onCustomDateFromChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date-to">To</Label>
              <Input
                id="date-to"
                type="date"
                value={customDateTo}
                onChange={(e) => onCustomDateToChange(e.target.value)}
              />
            </div>

            {/* Domain filter */}
            <div className="space-y-2">
              <Label htmlFor="custom-domain">Domain</Label>
              <Select value={customDomain} onValueChange={onCustomDomainChange}>
                <SelectTrigger id="custom-domain">
                  <SelectValue placeholder="All domains" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All domains</SelectItem>
                  {domainOptions.map((domain) => (
                    <SelectItem key={domain} value={domain}>
                      {domain}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Keywords filter */}
            <div className="space-y-2">
              <Label htmlFor="keywords">
                Keywords{' '}
                <span className="font-normal text-muted-foreground">
                  (comma-separated)
                </span>
              </Label>
              <Input
                id="keywords"
                type="text"
                placeholder="e.g. ai agents, claude, llm"
                value={customKeywords}
                onChange={(e) => onCustomKeywordsChange(e.target.value)}
              />
            </div>
          </div>

          {/* Active filter badges */}
          {((customDomain && customDomain !== 'all') ||
            customKeywords.trim()) && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Active filters:
              </span>
              {customDomain && customDomain !== 'all' && (
                <Badge
                  variant="secondary"
                  className="gap-1 text-xs font-normal"
                >
                  {customDomain}
                  <button
                    onClick={() => onCustomDomainChange('')}
                    aria-label={`Remove domain filter: ${customDomain}`}
                    className="ml-0.5 flex min-h-[32px] min-w-[32px] items-center justify-center rounded-full hover:bg-muted"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              )}
              {customKeywords
                .split(',')
                .map((k) => k.trim())
                .filter(Boolean)
                .map((kw) => (
                  <Badge
                    key={kw}
                    variant="secondary"
                    className="gap-1 text-xs font-normal"
                  >
                    {kw}
                    <button
                      onClick={() => {
                        const remaining = customKeywords
                          .split(',')
                          .map((k) => k.trim())
                          .filter((k) => k && k !== kw)
                          .join(', ');
                        onCustomKeywordsChange(remaining);
                      }}
                      aria-label={`Remove keyword filter: ${kw}`}
                      className="ml-0.5 flex min-h-[32px] min-w-[32px] items-center justify-center rounded-full hover:bg-muted"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
            </div>
          )}

          <div className="mt-4">
            <Button onClick={onGenerate} disabled={generating}>
              {generating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <RefreshCw className="size-4" />
                  Generate Custom Report
                </>
              )}
            </Button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function DigestPage() {
  const { markBulkRead, loadReadMarks } = useReadMarks();
  const { getDomainNames } = useTaxonomy();
  const domainOptions = getDomainNames();

  // Trigger lazy loading of read marks for this page
  useEffect(() => {
    loadReadMarks();
  }, [loadReadMarks]);

  const [currentDigest, setCurrentDigest] = useState<Digest | null>(null);
  const [pastDigests, setPastDigests] = useState<PastDigestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPastDigests, setLoadingPastDigests] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [periodDays, setPeriodDays] = useState('7');

  // Mode: preset (7/14/30 day), daily, or custom
  const [mode, setMode] = useState<DigestMode>('preset');

  // Custom filter state
  const [customDateFrom, setCustomDateFrom] = useState(
    toDateInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  );
  const [customDateTo, setCustomDateTo] = useState(
    toDateInputValue(new Date()),
  );
  const [customDomain, setCustomDomain] = useState<string>('');
  const [customKeywords, setCustomKeywords] = useState('');

  // Fetch the latest digest on mount
  const fetchLatest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/digest/latest');
      if (!res.ok) throw new Error('Failed to fetch latest digest');
      const data = await res.json();
      setCurrentDigest(data.digest ?? null);
    } catch (err) {
      console.error('Failed to fetch latest digest:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch list of past digests
  const fetchPastDigests = useCallback(async () => {
    setLoadingPastDigests(true);
    try {
      const res = await fetch('/api/digest/list?limit=10&offset=0');
      if (!res.ok) throw new Error('Failed to fetch digest list');
      const data = await res.json();
      setPastDigests(data.digests ?? []);
    } catch (err) {
      console.error('Failed to fetch digest list:', err);
    } finally {
      setLoadingPastDigests(false);
    }
  }, []);

  useEffect(() => {
    fetchLatest();
    fetchPastDigests();
  }, [fetchLatest, fetchPastDigests]);

  // Generate a new digest
  const handleGenerate = useCallback(async () => {
    setGenerating(true);

    try {
      let body: Record<string, unknown>;

      if (mode === 'daily') {
        body = {
          period_days: 1,
          digest_type: 'daily',
        };
      } else if (mode === 'custom') {
        // Parse keywords from comma-separated input
        const keywords = customKeywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean);

        const dateFrom = customDateFrom
          ? new Date(customDateFrom)
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const dateTo = customDateTo
          ? new Date(customDateTo + 'T23:59:59')
          : new Date();

        body = {
          period_days: 7, // fallback, overridden by date_from/date_to
          digest_type: 'custom',
          date_from: dateFrom.toISOString(),
          date_to: dateTo.toISOString(),
          ...(customDomain && customDomain !== 'all'
            ? { domain: customDomain }
            : {}),
          ...(keywords.length > 0 ? { keywords } : {}),
        };
      } else {
        const selectedPeriod = PERIOD_OPTIONS.find(
          (o) => o.value === periodDays,
        );
        body = {
          period_days: parseInt(periodDays, 10),
          digest_type: selectedPeriod?.type ?? 'custom',
        };
      }

      const res = await fetch('/api/digest/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate report');
      }

      const data = await res.json();
      setCurrentDigest(data.digest);
      toast.success('Report generated successfully');

      // Refresh the list
      fetchPastDigests();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to generate report';
      toast.error(message);
      console.error('Digest generation failed:', err);
    } finally {
      setGenerating(false);
    }
  }, [mode, customKeywords, customDateFrom, customDateTo, customDomain, periodDays, fetchPastDigests]);

  // Mark all items from digest as read
  const handleMarkAllRead = useCallback(async () => {
    if (!currentDigest) return;
    const ids: string[] = [];
    if (currentDigest.item_ids?.length) {
      ids.push(...currentDigest.item_ids);
    } else if (currentDigest.domain_summaries) {
      for (const ds of currentDigest.domain_summaries) {
        if (ds.top_items) {
          for (const item of ds.top_items) {
            if (item.id) ids.push(item.id);
          }
        }
      }
    }
    if (ids.length > 0) {
      await markBulkRead(ids, 'digest');
      toast.success(`Marked ${ids.length} items as read`);
    }
  }, [currentDigest, markBulkRead]);

  // Load a specific past digest by fetching full data
  async function loadDigest(digestId: string) {
    setLoading(true);
    try {
      const match = pastDigests.find((d) => d.id === digestId);
      if (
        match &&
        'domain_summaries' in match &&
        'narrative_summary' in match
      ) {
        setCurrentDigest(match as Digest);
      } else {
        const res = await fetch('/api/digest/list?limit=50&offset=0');
        if (!res.ok) throw new Error('Failed to load digest');
        const data = await res.json();
        const full = data.digests?.find((d: Digest) => d.id === digestId);
        if (full) {
          setCurrentDigest(full);
        } else {
          // Digest not found in paginated list — fetch it individually
          const singleRes = await fetch(`/api/digest/${digestId}`);
          if (!singleRes.ok) throw new Error('Failed to load digest');
          const singleData = await singleRes.json();
          if (singleData) {
            setCurrentDigest(singleData);
          } else {
            toast.error('Report not found');
          }
        }
      }
    } catch (err) {
      console.error('Failed to load digest:', err);
      toast.error('Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  // Shared props for GenerateControls
  const controlsProps = {
    mode,
    onModeChange: setMode,
    generating,
    onGenerate: handleGenerate,
    periodDays,
    onPeriodDaysChange: setPeriodDays,
    customDateFrom,
    onCustomDateFromChange: setCustomDateFrom,
    customDateTo,
    onCustomDateToChange: setCustomDateTo,
    customDomain,
    onCustomDomainChange: setCustomDomain,
    customKeywords,
    onCustomKeywordsChange: setCustomKeywords,
    domainOptions,
  };

  // Loading state
  if (loading) {
    return (
      <section aria-label="Change reports" className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div role="status" aria-label="Loading">
          <DigestSkeleton />
        </div>
      </section>
    );
  }

  // No digest state + generating state
  if (!currentDigest) {
    return (
      <section aria-label="Change reports" className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-primary/10 p-4">
            <FileText className="size-8 text-primary" />
          </div>
          <h1 className="mt-6 text-fluid-2xl font-bold tracking-tight">
            Change Reports
          </h1>
          <p className="mt-2 max-w-md text-muted-foreground">
            See what changed in your knowledge base, grouped by domain with
            cross-cutting themes identified.
          </p>

          <div className="mt-8 w-full max-w-2xl">
            <GenerateControls variant="hero" {...controlsProps} />
          </div>

          {generating && (
            <div className="mt-8 w-full max-w-2xl" aria-live="polite" role="status">
              <p className="mb-4 text-center text-sm text-muted-foreground">
                Generating your report... This may take up to a minute.
              </p>
              <DigestSkeleton />
            </div>
          )}
        </div>
      </section>
    );
  }

  // Digest view state
  return (
    <section aria-label="Change reports" className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      {/* Generate new / controls bar */}
      <div className="mb-8">
        <GenerateControls variant="bar" {...controlsProps} />
      </div>

      {/* Show skeleton while generating */}
      {generating ? (
        <div aria-live="polite" role="status">
          <p className="mb-4 text-sm text-muted-foreground">
            Generating your report... This may take up to a minute.
          </p>
          <DigestSkeleton />
        </div>
      ) : (
        <>
          <DigestView digest={currentDigest} />

          {/* Mark all as read — positioned after digest content */}
          <div className="mt-8 flex justify-center">
            <Button
              variant="outline"
              onClick={handleMarkAllRead}
              className="gap-2"
            >
              <BookCheck className="size-4" />
              Mark all as read
            </Button>
          </div>
        </>
      )}

      {/* Past digests */}
      {(loadingPastDigests || pastDigests.filter((d) => d.id !== currentDigest?.id).length > 0) && (
        <section className="mt-12 border-t border-border pt-8">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Previous Reports
          </h2>
          {loadingPastDigests ? (
            <div className="flex items-center justify-center py-4" role="status" aria-label="Loading previous reports">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Loading previous reports</span>
            </div>
          ) : (
            <ul className="space-y-2" aria-label="Previous reports">
              {pastDigests
                .filter((d) => d.id !== currentDigest?.id)
                .map((digest) => (
                  <li key={digest.id}>
                    <button
                      onClick={() => loadDigest(digest.id)}
                      className="flex w-full flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                    >
                      <div>
                        <span className="text-sm font-medium text-foreground">
                          {formatDate(digest.period_start)} &ndash;{' '}
                          {formatDate(digest.period_end)}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {digestTypeLabel(digest.digest_type)}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {digest.item_count} items
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
