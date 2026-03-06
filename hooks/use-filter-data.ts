'use client';

import { useState, useEffect, useRef } from 'react';
import {
  parseJsonb,
  parseJsonbArray,
  FilterCountsSchema,
  AuthorCountSchema,
} from '@/lib/validation/jsonb';
import { createClient } from '@/lib/supabase/client';
import type { Workspace } from '@/types/content';

export type FilterCounts = {
  domain: Record<string, number>;
  content_type: Record<string, number>;
  platform: Record<string, number>;
};

interface UseFilterDataParams {
  isOpen: boolean;
}

/**
 * Manages async data loading for filter panel options.
 *
 * All fetches are lazy-loaded: they only fire when the panel is opened,
 * and each category is fetched at most once per mount. Filter counts
 * are cached with a 30-second TTL.
 */
export function useFilterData({ isOpen }: UseFilterDataParams) {
  const supabase = createClient();

  // Filter counts (M8) — cached with a 30-second TTL to avoid re-fetching on every panel open
  const [counts, setCounts] = useState<FilterCounts>({
    domain: {},
    content_type: {},
    platform: {},
  });
  const countsCache = useRef<{ data: FilterCounts; timestamp: number } | null>(null);
  const COUNTS_CACHE_TTL_MS = 30_000;

  // Author autocomplete state
  const [authorSearch, setAuthorSearch] = useState('');
  const [allAuthors, setAllAuthors] = useState<
    { name: string; count: number }[]
  >([]);
  const [authorsLoaded, setAuthorsLoaded] = useState(false);

  // Popular keywords for quick-filter chips
  const [popularKeywords, setPopularKeywords] = useState<string[]>([]);
  const [keywordsLoaded, setKeywordsLoaded] = useState(false);

  // Workspaces for filter
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);

  // User tags for filter
  const [allUserTags, setAllUserTags] = useState<{ tag: string; count: number }[]>([]);
  const [userTagsLoaded, setUserTagsLoaded] = useState(false);

  // Fetch counts when panel opens via server-side aggregation RPC.
  // Results are cached for 30 seconds to avoid redundant fetches.
  useEffect(() => {
    if (!isOpen) return;

    // Serve from cache if still fresh
    if (
      countsCache.current &&
      Date.now() - countsCache.current.timestamp < COUNTS_CACHE_TTL_MS
    ) {
      setCounts(countsCache.current.data);
      return;
    }

    const fetchCounts = async () => {
      const { data, error } = await supabase.rpc('get_filter_counts');

      if (error || !data) {
        console.error('Failed to fetch filter counts:', error?.message);
        return;
      }

      const parsed = parseJsonb(FilterCountsSchema, data);
      const result: FilterCounts = {
        domain: parsed?.domain ?? {},
        content_type: parsed?.content_type ?? {},
        platform: parsed?.platform ?? {},
      };
      countsCache.current = { data: result, timestamp: Date.now() };
      setCounts(result);
    };

    fetchCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [isOpen]);

  // Fetch unique authors when panel opens
  useEffect(() => {
    if (!isOpen || authorsLoaded) return;

    const fetchAuthors = async () => {
      const { data, error } = await supabase.rpc('get_unique_authors');

      if (error || !data) {
        console.error('Failed to fetch authors:', error?.message);
        return;
      }

      const authors = parseJsonbArray(AuthorCountSchema, data).map((row) => ({
        name: row.author_name,
        count: Number(row.count),
      }));
      setAllAuthors(authors);
      setAuthorsLoaded(true);
    };

    fetchAuthors();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [isOpen, authorsLoaded]);

  // Fetch popular keywords when panel opens
  useEffect(() => {
    if (!isOpen || keywordsLoaded) return;

    const fetchKeywords = async () => {
      try {
        const res = await fetch('/api/search/suggestions');
        if (res.ok) {
          const data = await res.json();
          setPopularKeywords(data.keywords ?? []);
        }
      } catch {
        // Non-critical — fail silently
      }
      setKeywordsLoaded(true);
    };

    fetchKeywords();
  }, [isOpen, keywordsLoaded]);

  // Fetch workspaces when panel opens
  useEffect(() => {
    if (!isOpen || workspacesLoaded) return;
    const fetchWorkspaces = async () => {
      try {
        const res = await fetch('/api/workspaces');
        if (res.ok) {
          setAllWorkspaces(await res.json());
        }
      } catch {
        // Non-critical
      }
      setWorkspacesLoaded(true);
    };
    fetchWorkspaces();
  }, [isOpen, workspacesLoaded]);

  // Fetch user tags when panel opens
  useEffect(() => {
    if (!isOpen || userTagsLoaded) return;
    const fetchUserTags = async () => {
      try {
        const { data } = await supabase.rpc('get_user_tag_counts');
        if (data && typeof data === 'object') {
          const tagCounts = data as Record<string, number>;
          setAllUserTags(
            Object.entries(tagCounts)
              .map(([tag, count]) => ({ tag, count }))
              .sort((a, b) => b.count - a.count),
          );
        }
      } catch {
        // Non-critical
      }
      setUserTagsLoaded(true);
    };
    fetchUserTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [isOpen, userTagsLoaded]);

  return {
    counts,
    authorSearch,
    setAuthorSearch,
    allAuthors,
    popularKeywords,
    allWorkspaces,
    allUserTags,
  };
}
