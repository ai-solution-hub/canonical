'use client';

import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Search, Clock, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useModifierKey } from '@/hooks/ui/use-modifier-key';
import {
  addRecentSearch,
  getRecentSearches,
  PREVIEW_MIN_QUERY_LENGTH,
} from '@/lib/search-history';
import {
  useDebouncedPreview,
  type PreviewResult,
} from '@/hooks/browse/use-debounced-preview';
import { ContentTypeIcon } from '@/components/shared/content-type-icon';
import { DomainBadge } from '@/components/shared/domain-badge';

interface SearchBarProps {
  variant?: 'hero' | 'compact' | 'inline';
  defaultValue?: string;
  autoFocus?: boolean;
  /** inline variant: called instead of navigation on submit */
  onSearch?: (query: string) => void;
  /** inline variant: called when search is cleared */
  onClear?: () => void;
  /** Ref forwarded to the underlying <input> */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

// Flat dropdown item list used for ArrowUp/ArrowDown keyboard nav across
// the Recent / Preview / See-all / Suggestion sections (spec §4.1).
type DropdownItem =
  | { type: 'recent'; value: string }
  | { type: 'preview'; result: PreviewResult }
  | { type: 'see-all' }
  | { type: 'suggestion'; value: string };

export function SearchBar({
  variant = 'compact',
  defaultValue = '',
  autoFocus = false,
  onSearch,
  onClear,
  inputRef: externalInputRef,
}: SearchBarProps) {
  const router = useRouter();
  const mod = useModifierKey();
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalInputRef;
  const [query, setQuery] = useState(defaultValue);
  const [showRecent, setShowRecent] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAutoFocusing = useRef(autoFocus);

  // Live preview — inline variant only (SD-7). The `enabled` gate
  // ensures the hook never fetches for hero/compact variants and only
  // fetches while the dropdown is visible (focus-gated via showRecent).
  const isInline = variant === 'inline';
  const { results: rawPreviewResults, isLoading: previewLoading } =
    useDebouncedPreview(query, {
      enabled: isInline && showRecent,
    });

  // Stable reference for empty preview results to avoid downstream
  // re-renders from inline `?? []` (see CLAUDE.md gotcha).
  const previewResults = useMemo(() => rawPreviewResults, [rawPreviewResults]);

  // Whether the preview section should render: inline variant, dropdown
  // open, and query meets minimum length threshold.
  const showPreview =
    isInline && showRecent && query.trim().length >= PREVIEW_MIN_QUERY_LENGTH;

  // Sync internal query state when defaultValue changes externally
  // (e.g. prompt card selection in Browse, or URL param change).
  // Using key={defaultValue} at call site would reset dropdown state,
  // so we sync explicitly. Only the inline variant consumes defaultValue
  // today; guarding by variant prevents hero/compact regressions if a
  // future call site passes defaultValue.
  useEffect(() => {
    if (variant === 'inline') {
      setQuery(defaultValue);
    }
  }, [defaultValue, variant]);

  useEffect(() => {
    if (autoFocus && window.matchMedia('(pointer: fine)').matches) {
      inputRef.current?.focus();
      // isAutoFocusing stays true until user clicks into the input
    } else {
      isAutoFocusing.current = false;
    }
  }, [autoFocus, inputRef]);

  const loadRecent = useCallback(() => {
    setRecentSearches(getRecentSearches());
  }, []);

  const loadSuggestions = useCallback(async () => {
    if (suggestionsLoaded) return;
    try {
      const res = await fetch('/api/search/suggestions');
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.keywords ?? []);
      }
    } catch {
      // Suggestions are non-critical -- fail silently
    }
    setSuggestionsLoaded(true);
  }, [suggestionsLoaded]);

  // Build flat list of all dropdown items for keyboard navigation.
  // Preview results and the "See all results" button are interleaved
  // between recent searches and popular topics (spec §4.1).
  // `DropdownItem` type is declared at module level.
  const allItems: DropdownItem[] = [];
  if (showRecent) {
    // Section 1: Recent searches
    for (const s of recentSearches) {
      allItems.push({ type: 'recent', value: s });
    }
    // Section 2: Preview results (inline-only, when query >= 3 chars)
    if (showPreview) {
      for (const r of previewResults) {
        allItems.push({ type: 'preview', result: r });
      }
      // "See all results" footer counts as a navigable item
      if (previewResults.length > 0 || previewLoading) {
        allItems.push({ type: 'see-all' });
      }
    }
    // Section 3: Popular topics (hidden when preview is showing per spec)
    if (!showPreview) {
      for (const kw of suggestions) {
        allItems.push({ type: 'suggestion', value: kw });
      }
    }
  }
  // Dropdown is visible when there are navigable items OR preview is loading
  // (the loading spinner still needs to show even with 0 cached results).
  const dropdownVisible =
    showRecent && (allItems.length > 0 || (showPreview && previewLoading));
  const listboxId = 'search-listbox';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (variant === 'inline') {
      if (trimmed) {
        addRecentSearch(trimmed);
        setShowRecent(false);
        setActiveIndex(-1);
        onSearch?.(trimmed);
      } else {
        setShowRecent(false);
        setActiveIndex(-1);
        onClear?.();
      }
      return;
    }
    if (trimmed) {
      addRecentSearch(trimmed);
      setShowRecent(false);
      setActiveIndex(-1);
      router.push(`/browse?q=${encodeURIComponent(trimmed)}`);
    }
  }

  function handleSelectRecent(search: string) {
    setQuery(search);
    setShowRecent(false);
    setActiveIndex(-1);
    addRecentSearch(search);
    if (variant === 'inline') {
      onSearch?.(search);
    } else {
      router.push(`/browse?q=${encodeURIComponent(search)}`);
    }
  }

  /** Submit the full semantic search (triggered by "See all results"). */
  function handleSeeAllResults() {
    const trimmed = query.trim();
    if (!trimmed) return;
    addRecentSearch(trimmed);
    setShowRecent(false);
    setActiveIndex(-1);
    if (variant === 'inline') {
      onSearch?.(trimmed);
    } else {
      router.push(`/browse?q=${encodeURIComponent(trimmed)}`);
    }
  }

  /** Dispatch Enter on a focused dropdown item based on its type. */
  function handleDropdownItemActivate(item: DropdownItem) {
    switch (item.type) {
      case 'recent':
      case 'suggestion':
        handleSelectRecent(item.value);
        break;
      case 'preview':
        // Navigate to item detail — use router.push for SPA nav
        setShowRecent(false);
        setActiveIndex(-1);
        router.push(`/item/${item.result.id}`);
        break;
      case 'see-all':
        handleSeeAllResults();
        break;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!dropdownVisible) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        setActiveIndex((prev) => (prev < allItems.length - 1 ? prev + 1 : 0));
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : allItems.length - 1));
        break;
      }
      case 'Enter': {
        if (activeIndex >= 0 && activeIndex < allItems.length) {
          e.preventDefault();
          handleDropdownItemActivate(allItems[activeIndex]);
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        setShowRecent(false);
        setActiveIndex(-1);
        break;
      }
    }
  }

  // Reset activeIndex when dropdown items change
  useEffect(() => {
    setActiveIndex(-1);
  }, [recentSearches, suggestions, previewResults]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowRecent(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const placeholder =
    variant === 'hero'
      ? 'Search your knowledge base...'
      : variant === 'inline'
        ? 'Search your knowledge...'
        : 'Search...';

  const activeDescendantId =
    activeIndex >= 0 ? `search-option-${activeIndex}` : undefined;

  function renderDropdown(recentList: string[], suggestionList: string[]) {
    let itemIndex = -1;

    return (
      <div id={listboxId} role="listbox" aria-label="Search suggestions">
        {/* Section 1: Recent searches */}
        {recentList.length > 0 && (
          <>
            <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">
              Recent searches
            </p>
            {recentList.map((search) => {
              itemIndex++;
              const idx = itemIndex;
              return (
                <div
                  key={`recent-${search}`}
                  id={`search-option-${idx}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={activeIndex === idx}
                  onClick={() => handleSelectRecent(search)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors ${
                    activeIndex === idx ? 'bg-accent' : 'hover:bg-accent'
                  }`}
                >
                  <Clock className="size-3.5 text-muted-foreground" />
                  {search}
                </div>
              );
            })}
          </>
        )}

        {/* Section 2: Preview results (inline variant only, query >= 3 chars) */}
        {showPreview && (
          <>
            {recentList.length > 0 && (
              <div className="my-1.5 border-t border-border" />
            )}
            <div
              aria-live="polite"
              aria-busy={previewLoading}
              data-testid="preview-results-region"
            >
              {previewLoading && previewResults.length === 0 && (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                  <Loader2
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  Searching...
                </div>
              )}
              {previewResults.length > 0 && (
                <>
                  <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">
                    Preview results ({previewResults.length})
                  </p>
                  {previewResults.map((result) => {
                    itemIndex++;
                    const idx = itemIndex;
                    return (
                      <a
                        key={`preview-${result.id}`}
                        id={`search-option-${idx}`}
                        href={`/item/${result.id}`}
                        role="option"
                        tabIndex={-1}
                        aria-selected={activeIndex === idx}
                        onClick={(e) => {
                          e.preventDefault();
                          setShowRecent(false);
                          setActiveIndex(-1);
                          router.push(`/item/${result.id}`);
                        }}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors ${
                          activeIndex === idx ? 'bg-accent' : 'hover:bg-accent'
                        }`}
                      >
                        <ContentTypeIcon
                          contentType={result.content_type}
                          size="size-3.5"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {result.title}
                        </span>
                        {result.primary_domain && (
                          <DomainBadge domain={result.primary_domain} />
                        )}
                      </a>
                    );
                  })}
                </>
              )}
              {/* "See all results" footer */}
              {(previewResults.length > 0 || previewLoading) &&
                (() => {
                  itemIndex++;
                  const idx = itemIndex;
                  return (
                    <button
                      key="see-all-results"
                      id={`search-option-${idx}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={activeIndex === idx}
                      onClick={handleSeeAllResults}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`mt-1 flex w-full cursor-pointer items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium text-primary transition-colors ${
                        activeIndex === idx ? 'bg-accent' : 'hover:bg-accent'
                      }`}
                    >
                      See all results
                    </button>
                  );
                })()}
            </div>
          </>
        )}

        {/* Section 3: Popular topics (hidden when preview is showing) */}
        {!showPreview && suggestionList.length > 0 && (
          <>
            {recentList.length > 0 && (
              <div className="my-1.5 border-t border-border" />
            )}
            <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">
              Popular topics
            </p>
            <div className="flex flex-wrap gap-1 px-1 py-1">
              {suggestionList.map((kw) => {
                itemIndex++;
                const idx = itemIndex;
                return (
                  <div
                    key={`suggestion-${kw}`}
                    id={`search-option-${idx}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={activeIndex === idx}
                    onClick={() => handleSelectRecent(kw)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`cursor-pointer rounded-full border border-border px-2.5 py-1 text-xs text-foreground transition-colors ${
                      activeIndex === idx
                        ? 'bg-accent'
                        : 'bg-muted hover:bg-accent'
                    }`}
                  >
                    {kw}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  if (variant === 'hero') {
    return (
      <div ref={containerRef} className="relative mx-auto w-full max-w-xl">
        <form onSubmit={handleSubmit} role="search">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="search"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onMouseDown={() => {
                isAutoFocusing.current = false;
              }}
              onFocus={() => {
                if (isAutoFocusing.current) return;
                loadRecent();
                loadSuggestions();
                setShowRecent(true);
              }}
              onKeyDown={(e) => {
                isAutoFocusing.current = false;
                handleKeyDown(e);
              }}
              role="combobox"
              aria-label="Search the knowledge base"
              aria-expanded={dropdownVisible}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeDescendantId}
              className="h-12 rounded-xl border-2 bg-white pl-12 pr-4 text-base shadow-md transition-[border-color,box-shadow] duration-150 focus:border-primary focus:shadow-lg dark:bg-input/30"
            />
          </div>
        </form>
        {dropdownVisible && (
          <div className="absolute top-full z-50 mt-2 w-full rounded-lg border border-border bg-popover p-2 shadow-lg ring-1 ring-border backdrop-blur-sm">
            {renderDropdown(recentSearches, suggestions)}
          </div>
        )}
      </div>
    );
  }

  // Inline variant (browse page in-page search)
  if (variant === 'inline') {
    return (
      <div ref={containerRef} className="relative">
        <form onSubmit={handleSubmit} role="search" aria-label="Search content">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="search"
              placeholder={placeholder}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // Fire onClear when input is emptied (e.g. native clear button)
                if (e.target.value === '' && query !== '') {
                  onClear?.();
                }
              }}
              onFocus={() => {
                loadRecent();
                loadSuggestions();
                setShowRecent(true);
              }}
              onKeyDown={handleKeyDown}
              role="combobox"
              aria-label="Search the knowledge base"
              aria-expanded={dropdownVisible}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeDescendantId}
              className="h-10 border bg-white pl-10 pr-4 shadow-sm dark:bg-input/30"
            />
          </div>
        </form>
        {dropdownVisible && (
          <div className="absolute top-full z-50 mt-1 w-full rounded-lg border border-border bg-popover p-2 shadow-lg ring-1 ring-border backdrop-blur-sm">
            {renderDropdown(recentSearches, suggestions)}
          </div>
        )}
      </div>
    );
  }

  // Compact variant (header)
  return (
    <div ref={containerRef} className="relative">
      <form onSubmit={handleSubmit} role="search">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="search"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              loadRecent();
              loadSuggestions();
              setShowRecent(true);
            }}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-label="Search the knowledge base"
            aria-expanded={dropdownVisible}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeDescendantId}
            className="h-9 border bg-white pl-9 pr-16 shadow-sm dark:bg-input/30"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 select-none rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">{mod}</span>K
          </kbd>
        </div>
      </form>
      {dropdownVisible && (
        <div className="absolute top-full z-50 mt-1 w-full min-w-[240px] rounded-lg border border-border bg-popover p-2 shadow-lg ring-1 ring-border backdrop-blur-sm">
          {renderDropdown(recentSearches, suggestions)}
        </div>
      )}
    </div>
  );
}
