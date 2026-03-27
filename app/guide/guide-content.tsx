'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { BookOpen, Loader2, FileText, Layers, Clock, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DomainBadge } from '@/components/domain-badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuideStats {
  total_sections: number;
  populated_sections: number;
  required_sections: number;
  populated_required: number;
}

interface Guide {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  guide_type: string;
  domain_filter: string | null;
  icon: string | null;
  color: string | null;
  display_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  stats?: GuideStats;
}

interface GuideFilters {
  search?: string;
  type?: string;
  domain?: string;
}

// ---------------------------------------------------------------------------
// Guide type labels
// ---------------------------------------------------------------------------

const GUIDE_TYPE_LABELS: Record<string, string> = {
  sector: 'Sector',
  product: 'Product',
  company: 'Company',
  research: 'Research',
  custom: 'Custom',
};

// ---------------------------------------------------------------------------
// Reading time estimate
// ---------------------------------------------------------------------------

/**
 * Estimate reading time based on populated sections.
 * Each populated section averages ~2 content items at ~400 words each,
 * at ~200 words/minute = ~4 min per section. We round to nearest minute.
 * Minimum 1 min if any content exists.
 */
function estimateReadingTime(populatedSections: number): number | null {
  if (populatedSections <= 0) return null;
  return Math.max(1, Math.round(populatedSections * 4));
}

// ---------------------------------------------------------------------------
// Guide card
// ---------------------------------------------------------------------------

function GuideCard({ guide }: { guide: Guide }) {
  const stats = guide.stats;
  const hasStats = stats && stats.total_sections > 0;
  const percentage = hasStats
    ? Math.round((stats.populated_sections / stats.total_sections) * 100)
    : 0;
  const isComplete = hasStats && stats.populated_sections >= stats.total_sections;
  const readingTime = hasStats ? estimateReadingTime(stats.populated_sections) : null;

  return (
    <Link
      href={`/guide/${guide.slug}`}
      className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <BookOpen className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground group-hover:underline">
              {guide.name}
            </h3>
            {readingTime !== null && (
              <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground" aria-label={`Estimated reading time: ${readingTime} minutes`}>
                <Clock className="size-3" aria-hidden="true" />
                {readingTime} min read
              </span>
            )}
          </div>
          {guide.description && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
              {guide.description}
            </p>
          )}
        </div>
      </div>

      {/* Section coverage */}
      {hasStats && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {stats.populated_sections}/{stats.total_sections} sections populated
            </span>
            <span
              className={
                isComplete ? 'font-semibold text-freshness-fresh' : ''
              }
            >
              {percentage}%
            </span>
          </div>
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={stats.populated_sections}
            aria-valuemin={0}
            aria-valuemax={stats.total_sections}
            aria-label={`${stats.populated_sections} of ${stats.total_sections} sections populated`}
          >
            <div
              className={
                isComplete
                  ? 'h-full rounded-full bg-freshness-fresh transition-all duration-300'
                  : 'h-full rounded-full bg-primary transition-all duration-300'
              }
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="text-xs">
          {GUIDE_TYPE_LABELS[guide.guide_type] ?? guide.guide_type}
        </Badge>
        {guide.domain_filter && (
          <DomainBadge domain={guide.domain_filter} />
        )}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Empty state (no guides published)
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <FileText className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <h3 className="mt-4 text-sm font-medium text-foreground">
        No guides published yet
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Guides provide a curated reading experience over your knowledge base content.
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        <Link
          href="/browse"
          className="inline-flex items-center gap-1 text-foreground/70 underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <Search className="size-3" aria-hidden="true" />
          Try searching for specific content
        </Link>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// No results empty state (filters exclude everything)
// ---------------------------------------------------------------------------

function NoResultsState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <Search className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <h3 className="mt-4 text-sm font-medium text-foreground">
        No guides match your filters
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Try broadening your search or removing some filters.
      </p>
      <button
        onClick={onClear}
        className="mt-3 text-xs text-foreground/70 underline underline-offset-2 transition-colors hover:text-foreground"
      >
        Clear all filters
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function FilterBar({
  filters,
  setFilters,
  clearFilters,
  activeCount,
  domains,
}: {
  filters: GuideFilters;
  setFilters: (updates: Partial<GuideFilters>) => void;
  clearFilters: () => void;
  activeCount: number;
  domains: string[];
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={filters.search ?? ''}
          onChange={(e) => setFilters({ search: e.target.value || undefined })}
          placeholder="Search guides..."
          aria-label="Search guides"
          className="h-9 pl-8 text-xs"
        />
      </div>

      <Select
        value={filters.type ?? '__all__'}
        onValueChange={(v) => setFilters({ type: v === '__all__' ? undefined : v })}
      >
        <SelectTrigger className="h-9 w-full text-xs sm:w-[140px]" aria-label="Filter by type">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All types</SelectItem>
          {Object.entries(GUIDE_TYPE_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {domains.length > 0 && (
        <Select
          value={filters.domain ?? '__all__'}
          onValueChange={(v) => setFilters({ domain: v === '__all__' ? undefined : v })}
        >
          <SelectTrigger className="h-9 w-full text-xs sm:w-[160px]" aria-label="Filter by domain">
            <SelectValue placeholder="All domains" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All domains</SelectItem>
            {domains.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {activeCount > 0 && (
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="text-xs"
            aria-label={`${activeCount} active ${activeCount === 1 ? 'filter' : 'filters'}`}
          >
            {activeCount}
          </Badge>
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-xs text-foreground/70 underline underline-offset-2 transition-colors hover:text-foreground"
            aria-label="Clear all filters"
          >
            <X className="size-3" aria-hidden="true" />
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main content component
// ---------------------------------------------------------------------------

export function GuideContent() {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // -------------------------------------------------------------------------
  // Filter state from URL params
  // -------------------------------------------------------------------------

  const filters: GuideFilters = useMemo(
    () => ({
      search: searchParams.get('q') || undefined,
      type: searchParams.get('type') || undefined,
      domain: searchParams.get('domain') || undefined,
    }),
    [searchParams],
  );

  const setFilters = useCallback(
    (updates: Partial<GuideFilters>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        const paramKey = key === 'search' ? 'q' : key;
        if (value) {
          params.set(paramKey, value);
        } else {
          params.delete(paramKey);
        }
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const clearFilters = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  const activeCount = [filters.search, filters.type, filters.domain].filter(
    Boolean,
  ).length;

  // -------------------------------------------------------------------------
  // Derived domain options
  // -------------------------------------------------------------------------

  const domains = useMemo(
    () =>
      [...new Set(guides.map((g) => g.domain_filter).filter(Boolean))] as string[],
    [guides],
  );

  // -------------------------------------------------------------------------
  // Client-side filtering
  // -------------------------------------------------------------------------

  const filteredGuides = useMemo(() => {
    let result = guides;

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          (g.description?.toLowerCase().includes(q) ?? false),
      );
    }

    if (filters.type) {
      result = result.filter((g) => g.guide_type === filters.type);
    }

    if (filters.domain) {
      result = result.filter((g) => g.domain_filter === filters.domain);
    }

    return result;
  }, [guides, filters]);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  useEffect(() => {
    async function fetchGuides() {
      try {
        const res = await fetch('/api/guides?include=stats');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? 'Failed to load guides');
          return;
        }
        const data: Guide[] = await res.json();
        setGuides(data);
      } catch {
        setError('Failed to load guides');
      } finally {
        setLoading(false);
      }
    }
    fetchGuides();
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section aria-label="Guides" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-3">
        <Layers className="size-6 text-muted-foreground" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Guides</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Curated reading experiences across your knowledge base
          </p>
        </div>
      </div>

      {/* Filter bar — only show when guides are loaded and not empty */}
      {!loading && !error && guides.length > 0 && (
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          clearFilters={clearFilters}
          activeCount={activeCount}
          domains={domains}
        />
      )}

      <div className="mt-6" aria-live="polite">
        {loading && (
          <div className="flex items-center justify-center py-16" role="status" aria-label="Loading guides">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Loading guides...</span>
          </div>
        )}

        {!loading && error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && guides.length === 0 && <EmptyState />}

        {!loading && !error && guides.length > 0 && filteredGuides.length === 0 && (
          <NoResultsState onClear={clearFilters} />
        )}

        {!loading && !error && filteredGuides.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredGuides.map((guide) => (
              <GuideCard key={guide.id} guide={guide} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
