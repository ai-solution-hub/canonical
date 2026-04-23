'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { BrowseFilters } from '@/types/content';

// Browse filters don't delegate to the shared `useUrlFilters` primitive
// because browse carries a cross-parameter derivation that the shared
// parser can't express: setting `quality_issues=true` auto-enables
// `include_qa` unless the URL explicitly sets `include_qa=false`. The
// shared hook parses each key in isolation, so this auto-include branch
// cannot round-trip through it. Library uses the shared hook directly.

// ---------------------------------------------------------------------------
// Hook: useBrowseFilters
// ---------------------------------------------------------------------------

export function useBrowseFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Search query from URL (?q=) — browse-specific (not a filter dimension)
  const searchQuery = useMemo(
    () => searchParams.get('q') ?? undefined,
    [searchParams],
  );

  // Browse filters need the quality_issues auto-include_qa logic that the
  // shared parser cannot express, so we parse filters with the special case.
  const filters: BrowseFilters = useMemo(() => {
    const domainRaw = searchParams.get('domain')?.split(',').filter(Boolean);
    const typeRaw = searchParams.get('type')?.split(',').filter(Boolean);
    const platformRaw = searchParams
      .get('platform')
      ?.split(',')
      .filter(Boolean);
    const authorRaw = searchParams.get('author')?.split('|').filter(Boolean);
    const priorityRaw = searchParams
      .get('priority')
      ?.split(',')
      .filter(Boolean);

    const userTagsRaw = searchParams
      .get('user_tags')
      ?.split(',')
      .filter(Boolean);

    const freshnessRaw = searchParams
      .get('freshness')
      ?.split(',')
      .filter(Boolean);

    const ownerRaw = searchParams.get('owner') ?? undefined;

    const reviewStatusRaw = searchParams.get('review_status') ?? undefined;

    const sourceRaw = searchParams.get('source') ?? undefined;

    const qualityIssues =
      searchParams.get('quality_issues') === 'true' || undefined;
    const includeQaExplicit =
      searchParams.get('include_qa') === 'true' || undefined;
    // When quality_issues is active, automatically include Q&A pairs so the
    // user sees every flagged item — unless they've explicitly turned it off
    const includeQa =
      includeQaExplicit ||
      (qualityIssues && searchParams.get('include_qa') === null) ||
      undefined;

    return {
      domain: domainRaw?.length ? domainRaw : undefined,
      subtopic: searchParams.get('subtopic') ?? undefined,
      content_type: typeRaw?.length ? typeRaw : undefined,
      platform: platformRaw?.length ? platformRaw : undefined,
      author: authorRaw?.length ? authorRaw : undefined,
      date_from: searchParams.get('from') ?? undefined,
      date_to: searchParams.get('to') ?? undefined,
      keywords:
        searchParams.get('keywords')?.split(',').filter(Boolean) ?? undefined,
      starred: searchParams.get('starred') === 'true' || undefined,
      priority: priorityRaw?.length ? priorityRaw : undefined,
      workspace: searchParams.get('workspace') ?? undefined,
      user_tags: userTagsRaw?.length ? userTagsRaw : undefined,
      freshness: freshnessRaw?.length ? freshnessRaw : undefined,
      layer: searchParams.get('layer') ?? undefined,
      entity: searchParams.get('entity') ?? undefined,
      entity_type: searchParams.get('entity_type') ?? undefined,
      quality_issues: qualityIssues,
      include_drafts:
        searchParams.get('include_drafts') === 'true' || undefined,
      include_qa: includeQa,
      owner: ownerRaw,
      review_status: reviewStatusRaw,
      source: sourceRaw,
      sort:
        (searchParams.get('sort') as BrowseFilters['sort']) ?? 'captured_date',
      order: (searchParams.get('order') as BrowseFilters['order']) ?? 'desc',
    };
  }, [searchParams]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchQuery) count++;
    if (filters.domain?.length) count += filters.domain.length;
    if (filters.subtopic) count++;
    if (filters.content_type?.length) count += filters.content_type.length;
    if (filters.platform?.length) count += filters.platform.length;
    if (filters.author?.length) count += filters.author.length;
    if (filters.date_from || filters.date_to) count++;
    if (filters.keywords?.length) count++;
    if (filters.starred) count++;
    if (filters.priority?.length) count += filters.priority.length;
    if (filters.workspace) count++;
    if (filters.user_tags?.length) count++;
    if (filters.freshness?.length) count += filters.freshness.length;
    if (filters.layer) count++;
    if (filters.entity) count++;
    if (filters.entity_type) count++;
    if (filters.quality_issues) count++;
    if (filters.include_drafts) count++;
    if (filters.include_qa) count++;
    if (filters.owner) count++;
    if (filters.review_status) count++;
    if (filters.source) count++;
    return count;
  }, [filters, searchQuery]);

  const setFilters = useCallback(
    (newFilters: Partial<BrowseFilters>) => {
      const params = new URLSearchParams(searchParams.toString());

      if ('domain' in newFilters) {
        if (newFilters.domain?.length) {
          params.set('domain', newFilters.domain.join(','));
        } else {
          params.delete('domain');
          params.delete('subtopic'); // Clear subtopic when domain cleared
        }
      }
      if ('subtopic' in newFilters) {
        if (newFilters.subtopic) params.set('subtopic', newFilters.subtopic);
        else params.delete('subtopic');
      }
      if ('content_type' in newFilters) {
        if (newFilters.content_type?.length) {
          params.set('type', newFilters.content_type.join(','));
        } else {
          params.delete('type');
        }
      }
      if ('platform' in newFilters) {
        if (newFilters.platform?.length) {
          params.set('platform', newFilters.platform.join(','));
        } else {
          params.delete('platform');
        }
      }
      if ('author' in newFilters) {
        if (newFilters.author?.length) {
          params.set('author', newFilters.author.join('|'));
        } else {
          params.delete('author');
        }
      }
      if ('date_from' in newFilters) {
        if (newFilters.date_from) params.set('from', newFilters.date_from);
        else params.delete('from');
      }
      if ('date_to' in newFilters) {
        if (newFilters.date_to) params.set('to', newFilters.date_to);
        else params.delete('to');
      }
      if ('keywords' in newFilters) {
        if (newFilters.keywords?.length)
          params.set('keywords', newFilters.keywords.join(','));
        else params.delete('keywords');
      }
      if ('starred' in newFilters) {
        if (newFilters.starred) params.set('starred', 'true');
        else params.delete('starred');
      }
      if ('priority' in newFilters) {
        if (newFilters.priority?.length) {
          params.set('priority', newFilters.priority.join(','));
        } else {
          params.delete('priority');
        }
      }
      if ('workspace' in newFilters) {
        if (newFilters.workspace) params.set('workspace', newFilters.workspace);
        else params.delete('workspace');
      }
      if ('user_tags' in newFilters) {
        if (newFilters.user_tags?.length) {
          params.set('user_tags', newFilters.user_tags.join(','));
        } else {
          params.delete('user_tags');
        }
      }
      if ('freshness' in newFilters) {
        if (newFilters.freshness?.length) {
          params.set('freshness', newFilters.freshness.join(','));
        } else {
          params.delete('freshness');
        }
      }
      if ('layer' in newFilters) {
        if (newFilters.layer) params.set('layer', newFilters.layer);
        else params.delete('layer');
      }
      if ('entity' in newFilters) {
        if (newFilters.entity) params.set('entity', newFilters.entity);
        else params.delete('entity');
      }
      if ('entity_type' in newFilters) {
        if (newFilters.entity_type)
          params.set('entity_type', newFilters.entity_type);
        else params.delete('entity_type');
      }
      if ('quality_issues' in newFilters) {
        if (newFilters.quality_issues) params.set('quality_issues', 'true');
        else params.delete('quality_issues');
      }
      if ('include_drafts' in newFilters) {
        if (newFilters.include_drafts) params.set('include_drafts', 'true');
        else params.delete('include_drafts');
      }
      if ('include_qa' in newFilters) {
        if (newFilters.include_qa) params.set('include_qa', 'true');
        else params.delete('include_qa');
      }
      if ('owner' in newFilters) {
        if (newFilters.owner) params.set('owner', newFilters.owner);
        else params.delete('owner');
      }
      if ('review_status' in newFilters) {
        if (newFilters.review_status)
          params.set('review_status', newFilters.review_status);
        else params.delete('review_status');
      }
      if ('source' in newFilters) {
        if (newFilters.source) params.set('source', newFilters.source);
        else params.delete('source');
      }
      if ('sort' in newFilters) {
        if (newFilters.sort && newFilters.sort !== 'captured_date')
          params.set('sort', newFilters.sort);
        else params.delete('sort');
      }
      if ('order' in newFilters) {
        if (newFilters.order && newFilters.order !== 'desc')
          params.set('order', newFilters.order);
        else params.delete('order');
      }

      // Remove cursor on filter change
      params.delete('cursor');

      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname],
  );

  const setSearchQuery = useCallback(
    (query: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (query) {
        params.set('q', query);
      } else {
        params.delete('q');
      }
      params.delete('cursor');
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [searchParams, router, pathname],
  );

  const clearSearchQuery = useCallback(() => {
    setSearchQuery(undefined);
  }, [setSearchQuery]);

  // Preserve from_bid as a sticky URL param — it represents bid context,
  // not a filter. Only cleared on navigating away from /browse (SD-5).
  const clearFilters = useCallback(() => {
    const fromBid = searchParams.get('from_bid');
    if (fromBid) {
      router.push(`${pathname}?from_bid=${encodeURIComponent(fromBid)}`);
    } else {
      router.push(pathname);
    }
  }, [router, pathname, searchParams]);

  const removeFilter = useCallback(
    (key: keyof BrowseFilters) => {
      setFilters({ [key]: undefined });
    },
    [setFilters],
  );

  /** Remove a single value from a multi-select array filter */
  const removeFilterValue = useCallback(
    (
      key:
        | 'domain'
        | 'content_type'
        | 'platform'
        | 'author'
        | 'keywords'
        | 'priority'
        | 'user_tags'
        | 'freshness',
      value: string,
    ) => {
      const current = filters[key];
      if (!current?.length) return;
      const updated = current.filter((v) => v !== value);
      if (key === 'domain' && updated.length !== 1) {
        // Clear subtopic if we no longer have exactly one domain
        setFilters({
          [key]: updated.length ? updated : undefined,
          subtopic: undefined,
        });
      } else {
        setFilters({ [key]: updated.length ? updated : undefined });
      }
    },
    [filters, setFilters],
  );

  return {
    filters,
    activeFilterCount,
    searchQuery,
    setFilters,
    setSearchQuery,
    clearSearchQuery,
    clearFilters,
    removeFilter,
    removeFilterValue,
  };
}
