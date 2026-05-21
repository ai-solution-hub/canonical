'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2,
  FileText,
  RefreshCw,
  Calendar,
  BookCheck,
  Filter,
  X,
  AlertTriangle,
  Square,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
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
import { digestTypeLabel } from '@/lib/change-reports/change-reports-helpers';
import { useReadMarks } from '@/contexts/read-marks-context';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { useDigestData } from '@/hooks/use-digest-data';
import { useAccountAge } from '@/hooks/use-account-age';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchNotificationPreferences, ApiError } from '@/lib/query/fetchers';

/**
 * Unified period options — Daily and Custom collapsed into a single dropdown
 * per audit P1-4 / P1-9. Preset periods are the zero-state; "Custom..." is
 * a progressive-disclosure option that reveals the filter panel inline.
 */
const PERIOD_OPTIONS = [
  { value: '1', label: 'Last 1 day', type: 'daily' as const },
  { value: '7', label: 'Last 7 days', type: 'weekly' as const },
  { value: '14', label: 'Last 14 days', type: 'custom' as const },
  { value: '30', label: 'Last 30 days', type: 'custom' as const },
  { value: 'custom', label: 'Custom…', type: 'custom' as const },
];

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
// Extracted sub-components
// ---------------------------------------------------------------------------

interface GenerateControlsProps {
  variant: 'hero' | 'bar';
  generating: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  periodSelection: string;
  onPeriodSelectionChange: (value: string) => void;
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
  generating,
  onGenerate,
  onCancel,
  periodSelection,
  onPeriodSelectionChange,
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
  const isCustom = periodSelection === 'custom';

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex flex-wrap items-center gap-3',
          variant === 'hero' && 'justify-center',
        )}
      >
        <Select value={periodSelection} onValueChange={onPeriodSelectionChange}>
          <SelectTrigger className="w-[180px]" aria-label="Report period">
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

        {!isCustom &&
          (generating ? (
            <Button
              onClick={onCancel}
              variant="destructive"
              size={buttonSize}
              aria-label="Cancel report generation"
            >
              <Square className="size-4" />
              Cancel
            </Button>
          ) : (
            <Button
              onClick={onGenerate}
              disabled={generating}
              variant={buttonVariant}
              size={buttonSize}
            >
              <RefreshCw className="size-4" />
              {variant === 'hero' ? 'Generate Report' : 'Generate New Report'}
            </Button>
          ))}
      </div>

      {/* Custom filter panel — revealed inline when "Custom..." is selected */}
      {isCustom && (
        <div className="rounded-xl border bg-card p-5">
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
            {generating ? (
              <Button
                onClick={onCancel}
                variant="destructive"
                aria-label="Cancel report generation"
              >
                <Square className="size-4" />
                Cancel
              </Button>
            ) : (
              <Button onClick={onGenerate} disabled={generating}>
                <RefreshCw className="size-4" />
                Generate Custom Report
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Too Many Items empty state (OPS-23)
// ---------------------------------------------------------------------------

interface TooManyItemsProps {
  itemCount: number;
  max: number;
}

function TooManyItemsNotice({ itemCount, max }: TooManyItemsProps) {
  return (
    <div className="mt-6 rounded-xl border border-status-warning/30 bg-status-warning/5 p-6 text-center">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-status-warning/10">
        <AlertTriangle className="size-5 text-status-warning" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">
        Too many items for automatic summary
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Your KB has <strong>{itemCount}</strong> items in the last 7 days
        (limit: {max}). Use <strong>Custom</strong> filter to narrow the date
        range or apply a domain filter.
      </p>
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

  const {
    currentDigest,
    loading,
    pastDigests,
    loadingPastDigests,
    generating,
    generateError,
    handleGenerate,
    cancelGeneration,
    loadDigest,
  } = useDigestData();

  const {
    isOver24h,
    isNewAccount,
    loading: accountAgeLoading,
  } = useAccountAge();

  // OPS-23: Fetch notification preferences for auto-gen guard
  const { data: notifPrefs, isLoading: notifPrefsLoading } = useQuery({
    queryKey: queryKeys.notifications.preferences,
    queryFn: fetchNotificationPreferences,
  });

  // OPS-23: Detect the "too many items" 413 response and read the
  // structured payload from `error.data` (item_count + max). Falls back
  // to zero/150 defaults if the API shape drifts.
  const tooManyItems =
    generateError instanceof ApiError &&
    generateError.code === 'DIGEST_TOO_MANY_ITEMS';

  let tooManyItemCount = 0;
  let tooManyItemMax = 150;
  if (tooManyItems && generateError instanceof ApiError) {
    const data = generateError.data;
    if (typeof data?.item_count === 'number') {
      tooManyItemCount = data.item_count;
    }
    if (typeof data?.max === 'number') {
      tooManyItemMax = data.max;
    }
  }

  // Trigger lazy loading of read marks for this page
  useEffect(() => {
    loadReadMarks();
  }, [loadReadMarks]);

  // ─── Auto-generate weekly report on first visit (P0-11) ───
  //
  // When a user lands on `/digest` with no existing report, fire the weekly
  // generation automatically so Sarah's Monday reorientation does not start
  // with a cold-click. Guarded on:
  //   - account age > 24h: new accounts have no meaningful KB history
  //   - auto_generate_change_reports pref is ON (OPS-23): user can opt out
  //     via Settings > Notifications
  const autoGenTriggered = useRef(false);
  useEffect(() => {
    if (autoGenTriggered.current) return;
    if (loading || accountAgeLoading || notifPrefsLoading) return;
    if (currentDigest) return;
    if (generating) return;
    if (!isOver24h) return;

    // OPS-23: respect the user's auto-generate preference
    const autoGenEnabled = notifPrefs?.auto_generate_change_reports ?? true;
    if (!autoGenEnabled) return;

    autoGenTriggered.current = true;
    handleGenerate({
      period_days: 7,
      digest_type: 'weekly',
    });
  }, [
    loading,
    accountAgeLoading,
    notifPrefsLoading,
    currentDigest,
    generating,
    isOver24h,
    notifPrefs,
    handleGenerate,
  ]);

  // Unified period selection — "7" is the default (weekly preset).
  // "custom" reveals the inline custom filter panel.
  const [periodSelection, setPeriodSelection] = useState('7');

  // Custom filter state — lazy initialisers keep Date.now()/new Date()
  // out of the render path (react-hooks/purity).
  const [customDateFrom, setCustomDateFrom] = useState(() =>
    toDateInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  );
  const [customDateTo, setCustomDateTo] = useState(() =>
    toDateInputValue(new Date()),
  );
  const [customDomain, setCustomDomain] = useState<string>('');
  const [customKeywords, setCustomKeywords] = useState('');

  // Build request body and trigger generation
  const onGenerate = useCallback(() => {
    if (periodSelection === 'custom') {
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

      handleGenerate({
        period_days: 7,
        digest_type: 'custom',
        date_from: dateFrom.toISOString(),
        date_to: dateTo.toISOString(),
        ...(customDomain && customDomain !== 'all'
          ? { domain: customDomain }
          : {}),
        ...(keywords.length > 0 ? { keywords } : {}),
      });
    } else {
      const days = parseInt(periodSelection, 10);
      const selectedPeriod = PERIOD_OPTIONS.find(
        (o) => o.value === periodSelection,
      );
      handleGenerate({
        period_days: days,
        digest_type: selectedPeriod?.type ?? 'custom',
      });
    }
  }, [
    periodSelection,
    customKeywords,
    customDateFrom,
    customDateTo,
    customDomain,
    handleGenerate,
  ]);

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

  // Shared props for GenerateControls
  const controlsProps = {
    generating,
    onGenerate,
    onCancel: cancelGeneration,
    periodSelection,
    onPeriodSelectionChange: setPeriodSelection,
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

  // Loading state — also covers the brief window after auto-gen triggers but
  // before `generating` has flipped to true, so Sarah sees a skeleton rather
  // than the hero empty-state flickering first.
  if (loading || accountAgeLoading) {
    return (
      <section
        aria-label="Change reports"
        className="mx-auto max-w-5xl px-4 py-12 sm:px-6"
      >
        <div role="status" aria-label="Loading">
          <DigestSkeleton />
        </div>
      </section>
    );
  }

  // No digest state + generating state
  if (!currentDigest) {
    // New-account empty-state (P0-11). Accounts < 24h old have no meaningful
    // KB history, so skip auto-gen and show a friendlier message. The manual
    // Generate button stays functional so the user can still trigger a run if
    // they want.
    return (
      <section
        aria-label="Change reports"
        className="mx-auto max-w-5xl px-4 py-12 sm:px-6"
      >
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-primary/10 p-4">
            <FileText className="size-8 text-primary" />
          </div>
          <h1 className="mt-6 text-fluid-2xl font-bold tracking-tight">
            Change Reports
          </h1>
          {isNewAccount && !generating ? (
            <p className="mt-2 max-w-md text-muted-foreground">
              No activity yet — check back after your first day of usage and
              we&apos;ll summarise what changed in your knowledge base.
            </p>
          ) : (
            <p className="mt-2 max-w-md text-muted-foreground">
              See what changed in your knowledge base, grouped by domain with
              cross-cutting themes identified.
            </p>
          )}

          <div className="mt-8 w-full max-w-2xl">
            <GenerateControls variant="hero" {...controlsProps} />
          </div>

          {/* OPS-23: "too many items" notice replaces generation skeleton */}
          {tooManyItems && (
            <div className="mt-6 w-full max-w-2xl">
              <TooManyItemsNotice
                itemCount={tooManyItemCount}
                max={tooManyItemMax}
              />
            </div>
          )}

          {generating && (
            <div
              className="mt-8 w-full max-w-2xl"
              aria-live="polite"
              role="status"
            >
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
    <section
      aria-label="Change reports"
      className="mx-auto max-w-5xl px-4 py-12 sm:px-6"
    >
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
      {(loadingPastDigests ||
        pastDigests.filter((d) => d.id !== currentDigest?.id).length > 0) && (
        <section className="mt-12 border-t border-border pt-8">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Previous Reports
          </h2>
          {loadingPastDigests ? (
            <div
              className="flex items-center justify-center py-4"
              role="status"
              aria-label="Loading previous reports"
            >
              <Loader2
                className="size-4 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
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
                      className="flex w-full flex-col gap-1 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:gap-3"
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
