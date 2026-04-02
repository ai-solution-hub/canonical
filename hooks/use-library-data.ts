'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { createClient } from '@/lib/supabase/client';
import { escapePostgrestValue } from '@/lib/supabase/escape';
import { CONTENT_LIST_COLUMNS, type ContentListItem } from '@/types/content';
import type { LibraryFilters } from '@/hooks/browse/use-library-filters';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages Q&A library data with TanStack Query.
 *
 * Replaces the manual useEffect/useState fetch pattern in library-content.tsx
 * with query-key reactivity: TanStack Query automatically re-fetches when
 * `filters` change, and `invalidateQueries` after bulk mutations replaces
 * the `fetchTrigger` counter.
 *
 * Task 6: `sourceFilesKey` is defined in the centralised `queryKeys` factory
 * (`queryKeys.sourceDocuments.sourceFiles`) instead of inline.
 *
 * P4 minor: `fetchSourceFiles` throws on error instead of silently returning [].
 */
export function useLibraryData(filters: LibraryFilters) {
  // ─── Q&A pairs query ───

  const {
    data: items = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.contentItems.library(
      filters as Record<string, unknown>,
    ),
    queryFn: async () => {
      const supabase = createClient();

      let query = supabase
        .from('content_items')
        .select(CONTENT_LIST_COLUMNS.trim())
        .eq('content_type', 'q_a_pair')
        .or(
          'governance_review_status.is.null,governance_review_status.neq.draft',
        )
        .order('primary_domain', { ascending: true })
        .order('title', { ascending: true });

      if (filters.domain) {
        query = query.eq('primary_domain', filters.domain);
      }

      if (filters.source_file) {
        query = query.eq('source_file', filters.source_file);
      }

      if (filters.variant === 'both') {
        query = query
          .not('answer_standard', 'is', null)
          .not('answer_advanced', 'is', null);
      } else if (filters.variant === 'standard_only') {
        query = query
          .not('answer_standard', 'is', null)
          .is('answer_advanced', null);
      } else if (filters.variant === 'advanced_only') {
        query = query
          .is('answer_standard', null)
          .not('answer_advanced', 'is', null);
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
        query = query.or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`);
      }

      const { data, error } = await query;

      // P4 minor: throw on error instead of silently returning []
      if (error) throw error;

      return (data ?? []) as unknown as ContentListItem[];
    },
  });

  // ─── Source files for filter dropdown (Task 6: use centralised key) ───

  const { data: sourceFiles = [] } = useQuery({
    queryKey: queryKeys.sourceDocuments.sourceFiles,
    queryFn: async () => {
      const supabase = createClient();

      const { data, error } = await supabase
        .from('content_items')
        .select('source_file')
        .eq('content_type', 'q_a_pair')
        .not('source_file', 'is', null)
        .neq('source_file', '');

      // P4 minor: throw on error instead of silently returning []
      if (error) throw error;
      if (!data) return [];

      return [
        ...new Set(
          (data as Array<{ source_file: string }>)
            .map((r) => r.source_file)
            .filter(Boolean),
        ),
      ].sort();
    },
    staleTime: 5 * 60 * 1000, // Source files change rarely
  });

  return { items, isLoading, sourceFiles, refetch };
}
