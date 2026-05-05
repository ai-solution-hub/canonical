/**
 * Shared search history utilities.
 *
 * Extracted from components/browse/search-bar.tsx so that both the SearchBar
 * and SearchPromptCards (P1-10) can write to the same localStorage-backed
 * recent-searches list without duplicating the write logic.
 */

const RECENT_SEARCHES_KEY = 'kb-recent-searches';
const MAX_RECENT_SEARCHES = 10;

// Preview constants — single source of truth for Phase 2 consumers (SD-1/2/3)
export const PREVIEW_DEBOUNCE_MS = 300;
export const PREVIEW_MIN_QUERY_LENGTH = 3;
export const PREVIEW_MAX_RESULTS = 8;

export function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string): void {
  const searches = getRecentSearches().filter((s) => s !== query);
  searches.unshift(query);
  localStorage.setItem(
    RECENT_SEARCHES_KEY,
    JSON.stringify(searches.slice(0, MAX_RECENT_SEARCHES)),
  );
}
