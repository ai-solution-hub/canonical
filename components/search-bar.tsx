'use client';

import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Clock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useModifierKey } from '@/hooks/use-modifier-key';

const MAX_RECENT_SEARCHES = 10;
const STORAGE_KEY = 'kb-recent-searches';

function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addRecentSearch(query: string) {
  const searches = getRecentSearches().filter((s) => s !== query);
  searches.unshift(query);
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(searches.slice(0, MAX_RECENT_SEARCHES)),
  );
}

interface SearchBarProps {
  variant?: 'hero' | 'compact';
  defaultValue?: string;
  totalCount?: number;
  autoFocus?: boolean;
}

export function SearchBar({
  variant = 'compact',
  defaultValue = '',
  totalCount,
  autoFocus = false,
}: SearchBarProps) {
  const router = useRouter();
  const mod = useModifierKey();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(defaultValue);
  const [showRecent, setShowRecent] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAutoFocusing = useRef(autoFocus);

  useEffect(() => {
    if (autoFocus && window.matchMedia('(pointer: fine)').matches) {
      inputRef.current?.focus();
      // isAutoFocusing stays true until user clicks into the input
    } else {
      isAutoFocusing.current = false;
    }
  }, [autoFocus]);

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

  // Build flat list of all dropdown items for keyboard navigation
  const allItems: string[] = [];
  if (showRecent) {
    allItems.push(...recentSearches);
    allItems.push(...suggestions);
  }
  const dropdownVisible = showRecent && allItems.length > 0;
  const listboxId = 'search-listbox';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      addRecentSearch(trimmed);
      setShowRecent(false);
      setActiveIndex(-1);
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  }

  function handleSelectRecent(search: string) {
    setQuery(search);
    setShowRecent(false);
    setActiveIndex(-1);
    addRecentSearch(search);
    router.push(`/search?q=${encodeURIComponent(search)}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!dropdownVisible) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        setActiveIndex((prev) =>
          prev < allItems.length - 1 ? prev + 1 : 0,
        );
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setActiveIndex((prev) =>
          prev > 0 ? prev - 1 : allItems.length - 1,
        );
        break;
      }
      case 'Enter': {
        if (activeIndex >= 0 && activeIndex < allItems.length) {
          e.preventDefault();
          handleSelectRecent(allItems[activeIndex]);
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
  }, [recentSearches, suggestions]);

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

  const placeholder = totalCount
    ? `Search your ${totalCount.toLocaleString()} items...`
    : 'Search your knowledge base...';

  const activeDescendantId =
    activeIndex >= 0 ? `search-option-${activeIndex}` : undefined;

  function renderDropdown(recentList: string[], suggestionList: string[]) {
    let itemIndex = -1;

    return (
      <div
        id={listboxId}
        role="listbox"
        aria-label="Search suggestions"
      >
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
        {suggestionList.length > 0 && (
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
                      activeIndex === idx ? 'bg-accent' : 'bg-muted hover:bg-accent'
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
              onMouseDown={() => { isAutoFocusing.current = false; }}
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
              className="h-12 rounded-xl border-2 bg-card pl-12 pr-4 text-base shadow-sm transition-[border-color,box-shadow] duration-150 focus:border-primary focus:shadow-md"
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
              setShowRecent(true);
            }}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-label="Search the knowledge base"
            aria-expanded={dropdownVisible}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeDescendantId}
            className="h-9 bg-card pl-9 pr-16"
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
