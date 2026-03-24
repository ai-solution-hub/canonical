import type { SortOption } from '@/components/filter-bar';
import type { ContentListItem } from '@/types/content';

/** Sorts that use offset-based pagination instead of cursor-based. */
const OFFSET_SORTS = new Set(['freshness', 'quality_score']);

/** Returns true when the given sort key requires offset-based pagination. */
export function isOffsetSort(sort: string): boolean {
  return OFFSET_SORTS.has(sort);
}

export function getSortOptionFromFilters(
  sort?: string,
  order?: string,
): SortOption {
  if (sort === 'primary_domain') return 'domain';
  if (sort === 'classification_confidence') return 'confidence';
  if (sort === 'freshness' && order === 'asc') return 'freshness-stale';
  if (sort === 'quality_score' && order === 'asc') return 'quality-lowest';
  if (order === 'asc') return 'date-asc';
  return 'date-desc';
}

export function getSortFiltersFromOption(option: SortOption) {
  switch (option) {
    case 'date-desc':
      return {
        sort: 'captured_date' as const,
        order: 'desc' as const,
      };
    case 'date-asc':
      return {
        sort: 'captured_date' as const,
        order: 'asc' as const,
      };
    case 'domain':
      return {
        sort: 'primary_domain' as const,
        order: 'asc' as const,
      };
    case 'confidence':
      return {
        sort: 'classification_confidence' as const,
        order: 'desc' as const,
      };
    case 'freshness-stale':
      return {
        sort: 'freshness' as const,
        order: 'asc' as const,
      };
    case 'quality-lowest':
      return {
        sort: 'quality_score' as const,
        order: 'asc' as const,
      };
  }
}

export function getCursorFromItem(
  item: ContentListItem,
  sort: string,
): string | null {
  if (sort === 'classification_confidence') {
    return item.classification_confidence != null
      ? `${item.classification_confidence}|${item.id}`
      : null;
  }
  if (sort === 'primary_domain') {
    return item.primary_domain && item.captured_date
      ? `${item.primary_domain}|${item.captured_date}|${item.id}`
      : null;
  }
  // Freshness and quality_score use offset-based pagination (no cursor)
  if (sort === 'freshness' || sort === 'quality_score') {
    return null;
  }
  // Default: captured_date
  return item.captured_date ?? null;
}
