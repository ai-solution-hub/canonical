'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { createClient } from '@/lib/supabase/client';
import { escapePostgrestValue } from '@/lib/supabase/escape';
import type { ContentListItem } from '@/types/content';
import type { PublicationStatus } from '@/lib/governance/publication-transitions';
import type { LibraryFilters } from '@/hooks/browse/use-library-filters';

// ---------------------------------------------------------------------------
// q_a_pairs -> ContentListItem row mapping (ID-131 {131.21} G-MANUAL-QA)
// ---------------------------------------------------------------------------

/** The columns read off `q_a_pairs` for the /library list — a narrow subset
 *  of ContentListItem's full field set (q_a_pairs carries no domain,
 *  freshness, verification, or source-file columns — see the mapping note
 *  below). */
const QA_PAIR_LIST_COLUMNS =
  'id, question_text, answer_standard, answer_advanced, publication_status, source_document_id, created_at';

interface QAPairListRow {
  id: string;
  question_text: string;
  answer_standard: string;
  answer_advanced: string | null;
  publication_status: string | null;
  source_document_id: string | null;
  created_at: string;
}

/**
 * Maps a `q_a_pairs` row onto the `ContentListItem` shape the shared
 * library/browse UI (QARow, bulk-actions stat counts, grouping) already
 * consumes.
 *
 * `q_a_pairs` has NO domain/subtopic, freshness, verification, quality-score,
 * source-file, or layer columns (those facets live on `record_lifecycle` /
 * `source_documents`, which no manually-authored or corpus-promoted pair is
 * guaranteed to have a row in yet — see record_lifecycle facet migration,
 * currently zero-row). Fields with no q_a_pairs equivalent map to `null` —
 * an honest "not yet available" rather than a fabricated value. Richer
 * per-pair classification/verification parity is deferred to id-135
 * {135.22} (S440 owner-ratified narrowing for {131.21}).
 */
function mapQAPairToContentListItem(row: QAPairListRow): ContentListItem {
  return {
    id: row.id,
    title: row.question_text,
    suggested_title: null,
    summary: null,
    // q_a_pairs has no domain/subtopic column (that facet lives on
    // record_lifecycle, currently zero-row) — empty string reads as
    // "unclassified" to the UI's `item.primary_domain && <DomainBadge …>`
    // conditional-rendering checks, same as null would for an optional field.
    primary_domain: '',
    primary_subtopic: '',
    content_type: 'q_a_pair',
    platform: null,
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: row.created_at,
    ai_keywords: null,
    classification_confidence: null,
    priority: null,
    freshness: null,
    user_tags: null,
    governance_review_status: null,
    metadata: null,
    verified_at: null,
    verified_by: null,
    brief: null,
    content: row.answer_standard,
    answer_standard: row.answer_standard,
    answer_advanced: row.answer_advanced,
    content_owner_id: null,
    quality_score: null,
    source_document_id: row.source_document_id,
    citation_count: null,
    source_file: null,
    layer: null,
    // starred is optional (boolean | undefined) — omitted entirely rather
    // than forcing a value; no q_a_pairs equivalent exists.
    next_review_date: null,
    review_cadence_days: null,
    publication_status: row.publication_status as PublicationStatus | null,
  };
}

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
 *
 * ID-131 {131.21} G-MANUAL-QA: re-pointed off `content_items` onto the typed
 * `q_a_pairs` table (LIST-level only, S440 owner-ratified narrowing) — the
 * manual Q&A authoring write path (hooks/use-batch-create.ts) now writes
 * q_a_pairs, so the list read must target the same table for newly-created
 * pairs to appear. `domain` / `source_file` / `freshness` / `verified`
 * filters are honest no-ops here (q_a_pairs has no equivalent columns yet —
 * see mapQAPairToContentListItem); richer filtering parity is deferred to
 * id-135 {135.22}.
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
        .from('q_a_pairs')
        .select(QA_PAIR_LIST_COLUMNS)
        // Exclude retired/replaced pairs — the direct q_a_pairs analogue of
        // the old draft-hiding governance_review_status filter.
        .is('superseded_by', null)
        .order('question_text', { ascending: true });

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

      if (filters.search) {
        const escaped = escapePostgrestValue(filters.search);
        query = query.or(
          `question_text.ilike.%${escaped}%,answer_standard.ilike.%${escaped}%`,
        );
      }

      const { data, error } = await query;

      // P4 minor: throw on error instead of silently returning []
      if (error) throw error;

      return ((data ?? []) as unknown as QAPairListRow[]).map(
        mapQAPairToContentListItem,
      );
    },
  });

  // ─── Source files for filter dropdown (Task 6: use centralised key) ───
  //
  // ID-131 {131.21}: q_a_pairs carries no source_file string column (only the
  // FK-LESS source_document_id uuid — supabase/migrations/20260621105625).
  // Returning [] is an honest "no source-file filter data yet" rather than a
  // fabricated value; richer source-document filtering is deferred to id-135
  // {135.22}.
  const sourceFiles: string[] = [];

  return { items, isLoading, sourceFiles, refetch };
}
