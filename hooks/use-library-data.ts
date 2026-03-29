'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { escapePostgrestValue } from '@/lib/supabase/escape';
import { queryKeys } from '@/lib/query/query-keys';
import { CONTENT_LIST_COLUMNS, type ContentListItem } from '@/types/content';
import type { LibraryFilters } from '@/hooks/browse/use-library-filters';

// ---------------------------------------------------------------------------
// Fetcher: Q&A pairs with filters
// ---------------------------------------------------------------------------

async function fetchLibraryItems(
  filters: LibraryFilters,
): Promise<ContentListItem[]> {
  const supabase = createClient();

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
    query = query.eq('source_file', filters.source_file);
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
    const escaped = escapePostgrestValue(filters.search);
    query = query.or(
      `title.ilike.%${escaped}%,content.ilike.%${escaped}%`,
    );
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch Q&A pairs: ${error.message}`);
  }

  return Array.isArray(data) ? (data as unknown as ContentListItem[]) : [];
}

// ---------------------------------------------------------------------------
// Fetcher: distinct source files for filter dropdown
// ---------------------------------------------------------------------------

async function fetchSourceFiles(): Promise<string[]> {
  const supabase = createClient();

  const { data } = await supabase
    .from('content_items')
    .select('source_file')
    .eq('content_type', 'q_a_pair')
    .not('source_file', 'is', null)
    .neq('source_file', '');

  if (!data) return [];

  return [
    ...new Set(
      (data as Array<{ source_file: string }>)
        .map((r) => r.source_file)
        .filter(Boolean),
    ),
  ].sort();
}

// ---------------------------------------------------------------------------
// Query key for source files (stable, no filters)
// ---------------------------------------------------------------------------

const sourceFilesKey = ['content-items', 'library', 'source-files'] as const;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseLibraryDataReturn {
  items: ContentListItem[];
  isLoading: boolean;
  sourceFiles: string[];
}

export function useLibraryData(filters: LibraryFilters): UseLibraryDataReturn {
  const itemsQuery = useQuery({
    queryKey: queryKeys.contentItems.library({
      domain: filters.domain,
      source_file: filters.source_file,
      variant: filters.variant,
      search: filters.search,
      freshness: filters.freshness,
      verified: filters.verified,
    }),
    queryFn: () => fetchLibraryItems(filters),
  });

  const sourceFilesQuery = useQuery({
    queryKey: sourceFilesKey,
    queryFn: fetchSourceFiles,
    // Source files rarely change — keep fresh for 5 minutes
    staleTime: 5 * 60 * 1000,
  });

  return {
    items: itemsQuery.data ?? [],
    isLoading: itemsQuery.isLoading,
    sourceFiles: sourceFilesQuery.data ?? [],
  };
}
