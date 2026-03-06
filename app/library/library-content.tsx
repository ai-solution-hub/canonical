'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  Search,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  Filter,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { CONTENT_LIST_COLUMNS, type ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LibraryFilters {
  domain?: string;
  source_file?: string;
  variant?: 'all' | 'standard_only' | 'advanced_only' | 'both' | 'neither';
  search?: string;
  freshness?: 'fresh' | 'aging' | 'stale' | 'expired';
  verified?: 'verified' | 'unverified';
}

type GroupBy = 'none' | 'source' | 'domain';

// ---------------------------------------------------------------------------
// Hook: useLibraryFilters (URL search params)
// ---------------------------------------------------------------------------

function useLibraryFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters: LibraryFilters = useMemo(
    () => ({
      domain: searchParams.get('domain') || undefined,
      source_file: searchParams.get('source') || undefined,
      variant:
        (searchParams.get('variant') as LibraryFilters['variant']) || undefined,
      search: searchParams.get('q') || undefined,
      freshness:
        (searchParams.get('freshness') as LibraryFilters['freshness']) || undefined,
      verified:
        (searchParams.get('verified') as LibraryFilters['verified']) || undefined,
    }),
    [searchParams],
  );

  const groupBy: GroupBy = useMemo(
    () => (searchParams.get('group') as GroupBy) || 'none',
    [searchParams],
  );

  const setGroupBy = useCallback(
    (value: GroupBy) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === 'none') {
        params.delete('group');
      } else {
        params.set('group', value);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const setFilters = useCallback(
    (updates: Partial<LibraryFilters>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        const paramKey = key === 'source_file' ? 'source' : key === 'search' ? 'q' : key;
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

  const activeCount = [
    filters.domain,
    filters.source_file,
    filters.variant,
    filters.search,
    filters.freshness,
    filters.verified,
  ].filter(Boolean).length;

  return { filters, setFilters, clearFilters, activeCount, groupBy, setGroupBy };
}

// ---------------------------------------------------------------------------
// QA Row Component
// ---------------------------------------------------------------------------

function QARow({ item }: { item: ContentListItem }) {
  const [expanded, setExpanded] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const metadata = item.metadata as Record<string, unknown> | null;
  const hasStandard = !!item.answer_standard;
  const hasAdvanced = !!item.answer_advanced;
  const sourceFile = metadata?.source_file as string | undefined;

  const handleCopy = useCallback(
    async (text: string, label: string) => {
      await navigator.clipboard.writeText(text);
      setCopiedField(label);
      toast.success(`${label} copied`);
      setTimeout(() => setCopiedField(null), 2000);
    },
    [],
  );

  const freshness = item.freshness as string | null;
  const freshnessColour =
    freshness === 'fresh'
      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : freshness === 'aging'
        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
        : freshness === 'stale'
          ? 'bg-red-500/10 text-red-700 dark:text-red-400'
          : 'bg-muted text-muted-foreground';

  return (
    <div className="rounded-lg border border-border bg-card transition-colors hover:border-border/80">
      {/* Row header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-3 p-4 text-left"
        aria-expanded={expanded}
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground leading-snug">
            {item.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {item.primary_domain && (
              <span>
                {item.primary_domain}
                {item.primary_subtopic ? ` > ${item.primary_subtopic}` : ''}
              </span>
            )}
            {sourceFile && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate max-w-[200px]">{sourceFile}</span>
              </>
            )}
            {freshness && (
              <>
                <span aria-hidden="true">·</span>
                <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', freshnessColour)}>
                  {freshness}
                </Badge>
              </>
            )}
            {hasStandard && hasAdvanced && (
              <>
                <span aria-hidden="true">·</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  Standard + Advanced
                </Badge>
              </>
            )}
          </div>
        </div>
        <Link
          href={`/item/${item.id}`}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="Open detail view"
        >
          <ExternalLink className="size-3.5" />
        </Link>
      </button>

      {/* Expanded answer content */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 pl-11">
          {hasStandard && (
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Standard
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 text-xs"
                  onClick={() => handleCopy(item.answer_standard!, 'Standard answer')}
                >
                  {copiedField === 'Standard answer' ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  Copy
                </Button>
              </div>
              <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
                {item.answer_standard}
              </p>
            </div>
          )}
          {hasAdvanced && (
            <div className={hasStandard ? 'mt-4 border-t border-border/50 pt-3' : ''}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Advanced
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 text-xs"
                  onClick={() => handleCopy(item.answer_advanced!, 'Advanced answer')}
                >
                  {copiedField === 'Advanced answer' ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  Copy
                </Button>
              </div>
              <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
                {item.answer_advanced}
              </p>
            </div>
          )}
          {!hasStandard && !hasAdvanced && item.content && (
            <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
              {item.content}
            </p>
          )}
          {!hasStandard && !hasAdvanced && !item.content && (
            <p className="text-sm italic text-muted-foreground">
              No answer recorded yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleGroup — expandable section for grouped Q&A pairs
// ---------------------------------------------------------------------------

function CollapsibleGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 bg-muted/50 px-4 py-2.5 text-left border-l-4 border-primary/40 hover:bg-muted/80 transition-colors"
      >
        <span className="shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Badge variant="secondary" className="ml-auto tabular-nums text-xs">
          {count}
        </Badge>
      </button>
      {expanded && (
        <div className="space-y-2 p-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// groupItems — group ContentListItems by source or domain
// ---------------------------------------------------------------------------

function groupItems(
  items: ContentListItem[],
  groupBy: GroupBy,
): Map<string, ContentListItem[]> {
  const groups = new Map<string, ContentListItem[]>();

  for (const item of items) {
    let key: string;
    if (groupBy === 'source') {
      const metadata = item.metadata as Record<string, unknown> | null;
      key = (metadata?.source_file as string) || 'No source';
    } else {
      key = item.primary_domain || 'Unclassified';
    }

    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// LibraryContent
// ---------------------------------------------------------------------------

export function LibraryContent() {
  const supabase = createClient();
  const { filters, setFilters, clearFilters, activeCount, groupBy, setGroupBy } = useLibraryFilters();
  const { domains } = useTaxonomy();

  const [items, setItems] = useState<ContentListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sourceFiles, setSourceFiles] = useState<string[]>([]);

  // Fetch Q&A pairs
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);

      let query = supabase
        .from('content_items')
        .select(CONTENT_LIST_COLUMNS.trim())
        .eq('content_type', 'q_a_pair')
        .or('governance_review_status.is.null,governance_review_status.neq.draft')
        .order('primary_domain', { ascending: true })
        .order('title', { ascending: true });

      if (filters.domain) {
        query = query.eq('primary_domain', filters.domain);
      }

      if (filters.source_file) {
        query = query.eq('metadata->>source_file', filters.source_file);
      }

      if (filters.variant === 'both') {
        query = query.not('answer_standard', 'is', null).not('answer_advanced', 'is', null);
      } else if (filters.variant === 'standard_only') {
        query = query.not('answer_standard', 'is', null).is('answer_advanced', null);
      } else if (filters.variant === 'advanced_only') {
        query = query.is('answer_standard', null).not('answer_advanced', 'is', null);
      } else if (filters.variant === 'neither') {
        query = query.is('answer_standard', null).is('answer_advanced', null);
      }

      if (filters.freshness) {
        query = query.eq('freshness', filters.freshness);
      }

      if (filters.verified === 'verified') {
        query = query.not('verified_at', 'is', null);
      } else if (filters.verified === 'unverified') {
        query = query.is('verified_at', null);
      }

      if (filters.search) {
        query = query.or(
          `title.ilike.%${filters.search}%,content.ilike.%${filters.search}%`,
        );
      }

      const { data, error } = await query;

      if (error) {
        console.error('Failed to fetch Q&A pairs:', error);
        setIsLoading(false);
        return;
      }

      const fetched = Array.isArray(data) ? (data as unknown as ContentListItem[]) : [];
      setItems(fetched);
      setIsLoading(false);
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.domain, filters.source_file, filters.variant, filters.search, filters.freshness, filters.verified]);

  // Fetch distinct source files for filter dropdown
  useEffect(() => {
    const fetchSources = async () => {
      const { data } = await supabase
        .from('content_items')
        .select('metadata->>source_file')
        .eq('content_type', 'q_a_pair')
        .not('metadata->>source_file', 'is', null)
        .not('metadata->>source_file', 'eq', '');

      if (data) {
        const unique = [
          ...new Set(
            (data as Array<{ source_file: string }>).map((r) => r.source_file).filter(Boolean),
          ),
        ].sort();
        setSourceFiles(unique);
      }
    };
    fetchSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stats
  const standardCount = items.filter((i) => i.answer_standard).length;
  const advancedCount = items.filter((i) => i.answer_advanced).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Q&A Library</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isLoading ? (
              <span className="inline-block h-4 w-48 animate-pulse rounded bg-accent align-middle" />
            ) : (
              <>
                {items.length} Q&A pair{items.length !== 1 ? 's' : ''}
                {standardCount > 0 && (
                  <span> · {standardCount} standard</span>
                )}
                {advancedCount > 0 && (
                  <span> · {advancedCount} advanced</span>
                )}
              </>
            )}
          </p>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search questions and answers..."
            value={filters.search ?? ''}
            onChange={(e) => setFilters({ search: e.target.value || undefined })}
            className="h-9 pl-9"
            aria-label="Search Q&A pairs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.domain ?? '__all__'}
            onValueChange={(v) => setFilters({ domain: v === '__all__' ? undefined : v })}
          >
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="All domains" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All domains</SelectItem>
              {domains.map((d) => (
                <SelectItem key={d.name} value={d.name}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.source_file ?? '__all__'}
            onValueChange={(v) => setFilters({ source_file: v === '__all__' ? undefined : v })}
          >
            <SelectTrigger className="h-9 w-[200px] text-xs">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All sources</SelectItem>
              {sourceFiles.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.variant ?? 'all'}
            onValueChange={(v) =>
              setFilters({ variant: v === 'all' ? undefined : (v as LibraryFilters['variant']) })
            }
          >
            <SelectTrigger className="h-9 w-[150px] text-xs">
              <SelectValue placeholder="All variants" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All variants</SelectItem>
              <SelectItem value="both">Standard + Advanced</SelectItem>
              <SelectItem value="standard_only">Standard only</SelectItem>
              <SelectItem value="advanced_only">Advanced only</SelectItem>
              <SelectItem value="neither">No answer</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.freshness ?? 'all'}
            onValueChange={(v) =>
              setFilters({ freshness: v === 'all' ? undefined : (v as LibraryFilters['freshness']) })
            }
          >
            <SelectTrigger className="h-9 w-[130px] text-xs">
              <SelectValue placeholder="All freshness" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All freshness</SelectItem>
              <SelectItem value="fresh">Fresh</SelectItem>
              <SelectItem value="aging">Ageing</SelectItem>
              <SelectItem value="stale">Stale</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.verified ?? 'all'}
            onValueChange={(v) =>
              setFilters({ verified: v === 'all' ? undefined : (v as LibraryFilters['verified']) })
            }
          >
            <SelectTrigger className="h-9 w-[130px] text-xs">
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="unverified">Unverified</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={groupBy}
            onValueChange={(v) => setGroupBy(v as GroupBy)}
          >
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="No grouping" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No grouping</SelectItem>
              <SelectItem value="source">By source document</SelectItem>
              <SelectItem value="domain">By domain</SelectItem>
            </SelectContent>
          </Select>

          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-xs">
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Q&A List */}
      <div className="mt-6 space-y-2">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
            >
              <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-accent" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Filter className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {activeCount > 0
                ? 'No Q&A pairs match your filters.'
                : 'No Q&A pairs in the library yet.'}
            </p>
            {activeCount > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : groupBy !== 'none' ? (
          <div className="space-y-3">
            {Array.from(groupItems(items, groupBy).entries()).map(([groupName, groupedItems]) => (
              <CollapsibleGroup key={groupName} label={groupName} count={groupedItems.length}>
                {groupedItems.map((item) => <QARow key={item.id} item={item} />)}
              </CollapsibleGroup>
            ))}
          </div>
        ) : (
          items.map((item) => <QARow key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}
