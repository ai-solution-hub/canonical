'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FilterSection } from '@/components/browse/filter-section';

interface AuthorFilterProps {
  selectedAuthors: string[];
  authorSearch: string;
  allAuthors: { name: string; count: number }[];
  onAuthorSearchChange: (search: string) => void;
  onAddAuthor: (name: string) => void;
  onRemoveAuthor: (name: string) => void;
  /** Whether the section starts expanded (defaults to true) */
  defaultOpen?: boolean;
}

export function AuthorFilter({
  selectedAuthors,
  authorSearch,
  allAuthors,
  onAuthorSearchChange,
  onAddAuthor,
  onRemoveAuthor,
  defaultOpen = true,
}: AuthorFilterProps) {
  // Compute filtered author suggestions
  const authorSuggestions = useMemo(() => {
    const search = authorSearch.toLowerCase().trim();
    const selected = new Set(selectedAuthors);
    let filtered = allAuthors.filter((a) => !selected.has(a.name));
    if (search) {
      filtered = filtered.filter((a) => a.name.toLowerCase().includes(search));
    }
    return filtered.slice(0, 10);
  }, [authorSearch, allAuthors, selectedAuthors]);

  const showSuggestions =
    (authorSearch || selectedAuthors.length === 0) &&
    authorSuggestions.length > 0;

  return (
    <FilterSection title="Author" defaultOpen={defaultOpen}>
      <div className="relative">
        <Input
          placeholder="Search authors..."
          value={authorSearch}
          onChange={(e) => onAuthorSearchChange(e.target.value)}
          className="h-8 text-sm"
          role="combobox"
          aria-expanded={!!showSuggestions}
          aria-controls="author-suggestions"
          aria-label="Search authors"
          autoComplete="off"
        />
        {/* Suggestions dropdown */}
        {showSuggestions && (
          <div
            id="author-suggestions"
            role="listbox"
            className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover p-1"
          >
            {authorSuggestions.map((a) => (
              <button
                key={a.name}
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                onClick={() => {
                  onAddAuthor(a.name);
                  onAuthorSearchChange('');
                }}
              >
                <span className="truncate">{a.name}</span>
                <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {a.count}
                </span>
              </button>
            ))}
          </div>
        )}
        {!showSuggestions && (
          <div id="author-suggestions" role="listbox" hidden />
        )}
        {authorSearch && authorSuggestions.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            No matching authors
          </p>
        )}
      </div>
      {/* Selected chips */}
      {selectedAuthors.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {selectedAuthors.map((name) => (
            <Badge
              key={name}
              variant="secondary"
              className="flex items-center gap-1 py-0.5 pl-2 pr-1"
            >
              <span className="max-w-48 truncate" title={name}>
                {name}
              </span>
              <button
                type="button"
                onClick={() => onRemoveAuthor(name)}
                aria-label={`Remove author filter: ${name}`}
                className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </FilterSection>
  );
}
