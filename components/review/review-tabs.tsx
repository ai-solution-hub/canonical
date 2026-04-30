'use client';

import { useState, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  FileEdit,
  Flag,
  ShieldQuestion,
  ShieldCheck,
  List,
  ClipboardList,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ReviewContent } from '@/app/review/review-content';
import { PublicationReviewQueue } from '@/components/review/PublicationReviewQueue';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import { cn } from '@/lib/utils';
import type {
  ReviewStatsResponse,
  ReviewStatus,
} from '@/types/review';

/**
 * Six-tab Radix container for /review.
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §3, §5, §8 (a)-(e).
 *
 * Tabs (in display order):
 *   1. drafts                 status='draft'        → ReviewContent
 *   2. pending                status='flagged'      → ReviewContent
 *   3. verified-review (DEF)  status='unverified'   → ReviewContent
 *   4. verified-audit         status='verified'     → ReviewContent
 *   5. all                    status='all'          → ReviewContent
 *   6. publication-review     publication=in_review → PublicationReviewQueue
 *
 * URL state (matches `app/coverage/coverage-tabs.tsx` precedent):
 *   - `?tab=verified-review` (default) is omitted from the URL.
 *   - Other tabs are written explicitly via `router.replace()` (NOT push,
 *     so back-button does not navigate through every tab click — AC d).
 *   - Invalid `?tab=` values silently fall back to default (AC c).
 *
 * Tab switching forces a clean remount of ReviewContent via `key={tabValue}`
 * (CLAUDE.md "Reset local state via key prop" pattern + spec §4 explicit
 * recommendation). This avoids subtle leaks of in-flight mutation state /
 * sortedQueue cache between tab switches, while leaving the
 * useReviewQueue orchestrator + 4 sub-hooks UNTOUCHED.
 */

const VALID_TABS = [
  'drafts',
  'pending',
  'verified-review',
  'verified-audit',
  'all',
  'publication-review',
] as const;

type TabValue = (typeof VALID_TABS)[number];

const DEFAULT_TAB: TabValue = 'verified-review';

const VALID_TABS_SET = new Set<string>(VALID_TABS);

/**
 * Map each Radix tab value to the `ReviewStatus` enum that the existing
 * `ReviewContent` body filters on (tabs 1-5). Tab 6 has no `ReviewStatus`
 * mapping — it renders a different component.
 *
 * Spec §3 verbatim:
 *   drafts            → 'draft'
 *   pending           → 'flagged'
 *   verified-review   → 'unverified' (today's default)
 *   verified-audit    → 'verified'
 *   all               → 'all'
 */
const TAB_TO_STATUS: Record<
  Exclude<TabValue, 'publication-review'>,
  ReviewStatus
> = {
  drafts: 'draft',
  pending: 'flagged',
  'verified-review': 'unverified',
  'verified-audit': 'verified',
  all: 'all',
};

interface TabSpec {
  value: TabValue;
  label: string;
  icon: typeof FileEdit;
  /**
   * Function that picks the count for this tab from the stats response.
   * Returns null when the count is unavailable (network error / pre-load).
   */
  count: (stats: ReviewStatsResponse | null) => number | null;
}

const TAB_SPECS: readonly TabSpec[] = [
  {
    value: 'drafts',
    label: 'Drafts',
    icon: FileEdit,
    count: (s) => s?.draft ?? null,
  },
  {
    value: 'pending',
    label: 'Pending changes',
    icon: Flag,
    count: (s) => s?.flagged ?? null,
  },
  {
    value: 'verified-review',
    label: 'Verified content review',
    icon: ShieldQuestion,
    count: (s) => s?.unverified ?? null,
  },
  {
    value: 'verified-audit',
    label: 'Verified (audit)',
    icon: ShieldCheck,
    count: (s) => s?.verified ?? null,
  },
  {
    value: 'all',
    label: 'All',
    icon: List,
    count: (s) => s?.total ?? null,
  },
  {
    value: 'publication-review',
    label: 'Awaiting publication',
    icon: ClipboardList,
    count: (s) => s?.awaiting_publication ?? null,
  },
] as const;

function resolveTab(value: string | null): TabValue {
  if (value && VALID_TABS_SET.has(value)) {
    return value as TabValue;
  }
  return DEFAULT_TAB;
}

export function ReviewTabs() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabParam = searchParams.get('tab');
  const initialTab = resolveTab(tabParam);

  const [activeTab, setActiveTab] = useState<TabValue>(initialTab);

  // Stats are fetched at the tab level so each TabsTrigger badge is wired
  // independently of the per-tab queue. Re-uses the existing
  // `queryKeys.review.stats` key so invalidations from action-bar
  // mutations (Verify, Approve & publish, etc.) keep the badges fresh.
  const { data: stats = null } = useQuery<ReviewStatsResponse>({
    queryKey: queryKeys.review.stats,
    queryFn: () => fetchJson<ReviewStatsResponse>('/api/review/stats'),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const handleTabChange = useCallback(
    (value: string) => {
      const next = resolveTab(value);
      setActiveTab(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_TAB) {
        params.delete('tab');
      } else {
        params.set('tab', next);
      }
      // Strip the legacy `?status=` key — `useReviewSession` no longer
      // writes it post-S215 (status is derived from the active tab) so
      // any residual `?status=` value would mislead deep-link sharers.
      params.delete('status');
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  // Memoise the per-tab status map so ReviewContent receives a stable
  // `initialStatus` prop reference between renders.
  const tabSpecsWithCounts = useMemo(
    () =>
      TAB_SPECS.map((spec) => ({
        ...spec,
        countValue: spec.count(stats),
      })),
    [stats],
  );

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <div className="mx-auto w-full max-w-[1100px] px-4 pt-6 sm:px-6">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 p-1">
          {tabSpecsWithCounts.map(({ value, label, icon: Icon, countValue }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="gap-1.5"
              aria-label={
                countValue !== null
                  ? `${label} — ${countValue} ${countValue === 1 ? 'item' : 'items'}`
                  : label
              }
            >
              <Icon className="size-3.5" aria-hidden="true" />
              <span>{label}</span>
              {countValue !== null && (
                <Badge
                  variant="secondary"
                  className={cn(
                    'ml-0.5 h-5 min-w-5 px-1.5 text-[10px] tabular-nums',
                  )}
                  aria-hidden="true"
                >
                  {countValue}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* Tabs 1-5: ReviewContent body driven by initialStatus + key prop. */}
      {(['drafts', 'pending', 'verified-review', 'verified-audit', 'all'] as const).map(
        (tab) => (
          <TabsContent key={tab} value={tab} className="mt-2">
            {activeTab === tab && (
              <ReviewContent
                key={tab}
                initialStatus={TAB_TO_STATUS[tab]}
                hideStatusPills
              />
            )}
          </TabsContent>
        ),
      )}

      {/* Tab 6: NEW PublicationReviewQueue. */}
      <TabsContent value="publication-review" className="mt-2">
        {activeTab === 'publication-review' && <PublicationReviewQueue />}
      </TabsContent>
    </Tabs>
  );
}
