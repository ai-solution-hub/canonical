'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TagSuggestion {
  tag: string;
  count: number;
}

interface TagAutocompleteProps {
  /** Tag type to search: 'user' or 'ai' */
  type: 'user' | 'ai';
  /** Called when a tag is selected */
  onSelect: (tag: string) => void;
  /** Tags to exclude from suggestions (already applied) */
  excludeTags?: string[];
  /** Placeholder text */
  placeholder?: string;
  /** Additional className for the input */
  className?: string;
}

/**
 * Tag autocomplete input with dropdown suggestions.
 * Fetches suggestions from /api/tags/suggest as the user types.
 */
export function TagAutocomplete({
  type,
  onSelect,
  excludeTags = [],
  placeholder = 'Search tags...',
  className,
}: TagAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchSuggestions = useCallback(
    async (prefix: string) => {
      if (prefix.length < 1) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }

      try {
        const res = await fetch(
          `/api/tags/suggest?prefix=${encodeURIComponent(prefix)}&type=${type}`,
        );
        if (!res.ok) return;
        const data: TagSuggestion[] = await res.json();
        const filtered = data.filter((s) => !excludeTags.includes(s.tag));
        setSuggestions(filtered);
        setIsOpen(filtered.length > 0);
        setActiveIndex(-1);
      } catch {
        // Non-critical — fail silently
      }
    },
    [type, excludeTags],
  );

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchSuggestions(value), 200);
    },
    [fetchSuggestions],
  );

  const handleSelect = useCallback(
    (tag: string) => {
      onSelect(tag);
      setQuery('');
      setSuggestions([]);
      setIsOpen(false);
      inputRef.current?.focus();
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || suggestions.length === 0) {
        if (e.key === 'Enter' && query.trim()) {
          e.preventDefault();
          handleSelect(query.trim());
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0,
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1,
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < suggestions.length) {
            handleSelect(suggestions[activeIndex].tag);
          } else if (query.trim()) {
            handleSelect(query.trim());
          }
          break;
        case 'Escape':
          setIsOpen(false);
          setActiveIndex(-1);
          break;
      }
    },
    [isOpen, suggestions, activeIndex, query, handleSelect],
  );

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target as Node) &&
        listRef.current &&
        !listRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) setIsOpen(true);
        }}
        placeholder={placeholder}
        className={cn('h-8 text-sm', className)}
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-controls="tag-suggestions"
      />
      {isOpen && suggestions.length > 0 && (
        <ul
          ref={listRef}
          id="tag-suggestions"
          role="listbox"
          className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.tag}
              role="option"
              aria-selected={i === activeIndex}
              className={cn(
                'flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm',
                i === activeIndex && 'bg-accent text-accent-foreground',
              )}
              onClick={() => handleSelect(s.tag)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span>{s.tag}</span>
              <span className="text-xs text-muted-foreground">{s.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
