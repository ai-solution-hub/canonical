'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DedupQueueFilters } from '@/lib/query/fetchers';

interface ContentDedupFilterBarProps {
  filters: DedupQueueFilters;
  onFiltersChange: (next: DedupQueueFilters) => void;
  onRefresh: () => void;
  /** Optional list of domain values present in the current queue. */
  availableDomains?: string[];
  isRefreshing?: boolean;
}

const ALL_DOMAINS = '__all__';

/**
 * Filter + sort + refresh bar for the admin dedup queue.
 *
 * - Domain filter (Radix Select) constrained to domains present in the
 *   current data set, plus an "All" sentinel.
 * - Sort dropdown — `created_at_desc` (default) or `similarity_desc`.
 * - Refresh button calls `onRefresh` (typically wired to TanStack Query
 *   `refetch()`).
 *
 * Per CLAUDE.md gotcha (`feedback_radix_select_jsdom_shims`), tests for
 * this component must call `installRadixPointerShims()` in `beforeEach`.
 */
export function ContentDedupFilterBar({
  filters,
  onFiltersChange,
  onRefresh,
  availableDomains = [],
  isRefreshing = false,
}: ContentDedupFilterBarProps) {
  const handleDomainChange = (value: string) => {
    if (value === ALL_DOMAINS) {
      const { domain: _domain, ...rest } = filters;
      onFiltersChange(rest);
    } else {
      onFiltersChange({ ...filters, domain: value });
    }
  };

  const handleSortChange = (value: string) => {
    onFiltersChange({
      ...filters,
      sort: value as DedupQueueFilters['sort'],
    });
  };

  return (
    <div
      role="toolbar"
      aria-label="Dedup queue filters"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-col gap-1">
        <label
          htmlFor="dedup-domain-filter"
          className="text-xs font-medium text-muted-foreground"
        >
          Domain
        </label>
        <Select
          value={filters.domain ?? ALL_DOMAINS}
          onValueChange={handleDomainChange}
        >
          <SelectTrigger
            id="dedup-domain-filter"
            size="sm"
            className="min-w-40"
            aria-label="Filter by domain"
          >
            <SelectValue placeholder="All domains" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_DOMAINS}>All domains</SelectItem>
            {availableDomains.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="dedup-sort"
          className="text-xs font-medium text-muted-foreground"
        >
          Sort
        </label>
        <Select
          value={filters.sort ?? 'created_at_desc'}
          onValueChange={handleSortChange}
        >
          <SelectTrigger
            id="dedup-sort"
            size="sm"
            className="min-w-40"
            aria-label="Sort order"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at_desc">Newest</SelectItem>
            <SelectItem value="similarity_desc">Similarity</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={isRefreshing}
        aria-label="Refresh queue"
        className="ml-auto"
      >
        <RefreshCw
          className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
        Refresh
      </Button>
    </div>
  );
}
