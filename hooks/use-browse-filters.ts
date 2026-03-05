'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { BrowseFilters } from '@/types/content';

export function useBrowseFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

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
      project: searchParams.get('project') ?? undefined,
      user_tags: userTagsRaw?.length ? userTagsRaw : undefined,
      freshness: freshnessRaw?.length ? freshnessRaw : undefined,
      quality_issues: searchParams.get('quality_issues') === 'true' || undefined,
      sort:
        (searchParams.get('sort') as BrowseFilters['sort']) ?? 'captured_date',
      order: (searchParams.get('order') as BrowseFilters['order']) ?? 'desc',
    };
  }, [searchParams]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.domain?.length) count += filters.domain.length;
    if (filters.subtopic) count++;
    if (filters.content_type?.length) count += filters.content_type.length;
    if (filters.platform?.length) count += filters.platform.length;
    if (filters.author?.length) count += filters.author.length;
    if (filters.date_from || filters.date_to) count++;
    if (filters.keywords?.length) count++;
    if (filters.starred) count++;
    if (filters.priority?.length) count += filters.priority.length;
    if (filters.project) count++;
    if (filters.user_tags?.length) count++;
    if (filters.freshness?.length) count += filters.freshness.length;
    if (filters.quality_issues) count++;
    return count;
  }, [filters]);

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
      if ('project' in newFilters) {
        if (newFilters.project) params.set('project', newFilters.project);
        else params.delete('project');
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
      if ('quality_issues' in newFilters) {
        if (newFilters.quality_issues) params.set('quality_issues', 'true');
        else params.delete('quality_issues');
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

  const clearFilters = useCallback(() => {
    router.push(pathname);
  }, [router, pathname]);

  const removeFilter = useCallback(
    (key: keyof BrowseFilters) => {
      setFilters({ [key]: undefined });
    },
    [setFilters],
  );

  /** Remove a single value from a multi-select array filter */
  const removeFilterValue = useCallback(
    (key: 'domain' | 'content_type' | 'platform' | 'author' | 'keywords' | 'priority' | 'user_tags' | 'freshness', value: string) => {
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
    setFilters,
    clearFilters,
    removeFilter,
    removeFilterValue,
  };
}
