'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Search,
  X,
  LayoutGrid,
  MessageSquareText,
  FileText,
  Link2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { CorpusKind, CorpusSearchFilters } from '@/types/corpus-search';

/**
 * Corpus search controls — search box, kind-narrow, metadata filters
 * (ID-135 {135.8}, Surface A).
 *
 * Copy-and-generalise of the file-private `ReferenceSearchBox` /
 * `ReferenceFilterControls` in `app/reference/reference-content.tsx` (those
 * are NOT exported — duplicated here rather than imported). Unlike the
 * Reference pair, which read/wrote state through a parent hook
 * (`useReferenceData`), these controls are directly URL-driven
 * (`useSearchParams`/`router.push`) since the {135.9}+ `useCorpusSearch` hook
 * has not landed yet — each control owns its own param read/write.
 *
 * Spec: PRODUCT.md BI-4, BI-9, BI-15, BI-16; TECH.md §3/§4.
 */

const KIND_OPTIONS: {
  value: CorpusKind;
  label: string;
  Icon: typeof MessageSquareText;
}[] = [
  { value: 'answer', label: 'Answers', Icon: MessageSquareText },
  { value: 'document', label: 'Documents', Icon: FileText },
  { value: 'reference', label: 'References', Icon: Link2 },
];

function isCorpusKind(value: string): value is CorpusKind {
  return value === 'answer' || value === 'document' || value === 'reference';
}

const controlClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Search box (BI-9). Owns local uncommitted input state so the user can type
 * a multi-character query before submitting, and pushes `?q` to the URL on
 * submit — preserving every other active param (kind/filters).
 *
 * Callers key this component on the current `?q` value (`key={query}`) so a
 * browser back/forward navigation forces a clean remount to the new URL
 * value instead of a `useEffect`-driven sync (components/CLAUDE.md
 * key-reset rule — NO setState-in-effect).
 */
export function CorpusSearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.get('q') ?? '';
  const [value, setValue] = useState(currentQuery);

  const pushQuery = (query: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = query.trim();
    if (trimmed) params.set('q', trimmed);
    else params.delete('q');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        pushQuery(value);
      }}
      className="mt-4"
      role="search"
    >
      <label htmlFor="corpus-search" className="sr-only">
        Search the corpus
      </label>
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="corpus-search"
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search answers, documents and references..."
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="default" size="sm">
          Search
        </Button>
        {currentQuery && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setValue('');
              pushQuery('');
            }}
          >
            <X className="size-4" aria-hidden="true" />
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Kind-narrow control (BI-15). Sets `?kind=` to a single {@link CorpusKind},
 * narrowing the default ALL-grain scope (BI-10) — never widening, since the
 * URL can only ever carry one `kind` value: selecting a second option
 * replaces the param rather than appending to it. Selecting "All kinds"
 * removes the param and returns to the ALL-grain default.
 *
 * Fully URL-controlled (no local state) — each render reads the active kind
 * straight off `searchParams`, so it always reflects the live URL with no
 * remount/sync machinery required.
 */
export function CorpusKindNarrow() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawKind = searchParams.get('kind');
  const activeKind = rawKind && isCorpusKind(rawKind) ? rawKind : undefined;

  const pushKind = (kind: CorpusKind | undefined) => {
    const params = new URLSearchParams(searchParams.toString());
    if (kind) params.set('kind', kind);
    else params.delete('kind');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div
      role="group"
      aria-label="Narrow by kind"
      className="mt-4 flex flex-wrap items-center gap-2"
    >
      <Button
        type="button"
        variant={activeKind === undefined ? 'default' : 'outline'}
        size="sm"
        aria-pressed={activeKind === undefined}
        onClick={() => pushKind(undefined)}
      >
        <LayoutGrid className="size-4" aria-hidden="true" />
        All kinds
      </Button>
      {KIND_OPTIONS.map(({ value, label, Icon }) => (
        <Button
          key={value}
          type="button"
          variant={activeKind === value ? 'default' : 'outline'}
          size="sm"
          aria-pressed={activeKind === value}
          onClick={() => pushKind(value)}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Metadata filter controls (BI-16) — domain / subtopic / date range, pushed
 * to the search params on top of the active query/kind. Fully URL-controlled
 * (no local state), mirroring `CorpusKindNarrow`.
 *
 * `q_a_pair` results are restricted to `publication_status = 'published'`
 * server-side by the `hybrid_search` RPC (id-131 BI-20, shipped) — this is
 * asserted here as a design invariant only; NO client-side publication-status
 * filter is added (there is deliberately no such control below).
 */
export function CorpusFilterControls() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Date-range URL keys are `from`/`to` (TECH §4 canonical param list:
  // `?q, ?domain, ?subtopic, ?source, ?from, ?to`) — DELIBERATELY not
  // `dateFrom`/`dateTo`, even though the CorpusSearchFilters object fields
  // (and the {135.6} useCorpusSearch hook's parsed filter shape) ARE named
  // dateFrom/dateTo. This is the one place field name and URL key diverge;
  // pushFilter below (keyed by CorpusSearchFilters field name) is safe for
  // domain/subtopic ONLY because their field name equals their URL key.
  const filters: CorpusSearchFilters = {
    domain: searchParams.get('domain') ?? undefined,
    subtopic: searchParams.get('subtopic') ?? undefined,
    dateFrom: searchParams.get('from') ?? undefined,
    dateTo: searchParams.get('to') ?? undefined,
  };

  const activeFilterCount = [
    filters.domain,
    filters.subtopic,
    filters.dateFrom || filters.dateTo,
  ].filter(Boolean).length;

  const pushFilter = (key: keyof CorpusSearchFilters, next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set(key, next);
    else params.delete(key);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  // Dedicated writer for the date range — the URL key ('from'/'to') differs
  // from the CorpusSearchFilters field name (dateFrom/dateTo), so it cannot
  // reuse `pushFilter`'s field-name-as-URL-key shortcut.
  const pushDate = (urlKey: 'from' | 'to', next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set(urlKey, next);
    else params.delete(urlKey);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('domain');
    params.delete('subtopic');
    params.delete('from');
    params.delete('to');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="corpus-filter-domain"
          className="text-xs font-medium text-muted-foreground"
        >
          Domain
        </label>
        <input
          id="corpus-filter-domain"
          type="text"
          value={filters.domain ?? ''}
          onChange={(e) => pushFilter('domain', e.target.value)}
          placeholder="Any domain"
          className={controlClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="corpus-filter-subtopic"
          className="text-xs font-medium text-muted-foreground"
        >
          Subtopic
        </label>
        <input
          id="corpus-filter-subtopic"
          type="text"
          value={filters.subtopic ?? ''}
          onChange={(e) => pushFilter('subtopic', e.target.value)}
          placeholder="Any subtopic"
          className={controlClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="corpus-filter-from"
          className="text-xs font-medium text-muted-foreground"
        >
          Date from
        </label>
        <input
          id="corpus-filter-from"
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={(e) => pushDate('from', e.target.value)}
          className={controlClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="corpus-filter-to"
          className="text-xs font-medium text-muted-foreground"
        >
          Date to
        </label>
        <input
          id="corpus-filter-to"
          type="date"
          value={filters.dateTo ?? ''}
          onChange={(e) => pushDate('to', e.target.value)}
          className={controlClass}
        />
      </div>

      {activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
