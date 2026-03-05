'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ContentLibraryResult } from '@/components/content-library-result';
import { useSearch } from '@/hooks/use-search';
import { isMacPlatform } from '@/lib/utils';
import type { SearchResult } from '@/types/content';

interface ContentLibraryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questionText?: string;
}

type ContentTypeFilter = 'all' | 'q_a_pair';

/**
 * Content Library Drawer — slides in from the right in the bid session page.
 * Provides search, browse, and copy access to the full Knowledge Base.
 * Triggered via Cmd+L / Ctrl+L or toolbar button.
 */
export function ContentLibraryDrawer({
  open,
  onOpenChange,
  questionText,
}: ContentLibraryDrawerProps) {
  const { results, isLoading, error, search } = useSearch();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ContentTypeFilter>('all');
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevOpenRef = useRef(false);

  // Pre-populate search with question text on open + focus input
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;

    if (justOpened) {
      if (questionText) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: pre-populate search on drawer open, not during render
        setQuery(questionText);
        setHasSearched(true);
        search(questionText, 0.3, 15);
      }
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open, questionText, search]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      // Delay reset slightly so the closing animation isn't jarring
      const timer = setTimeout(() => {
        setQuery('');
        setTypeFilter('all');
        setHasSearched(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Debounced search
  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!value.trim()) {
        setHasSearched(false);
        return;
      }

      debounceRef.current = setTimeout(() => {
        setHasSearched(true);
        search(value, 0.3, 15);
      }, 300);
    },
    [search],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Filter results client-side by content type
  const filteredResults = useMemo(() => {
    if (typeFilter === 'all') return results;
    return results.filter((r) => r.content_type === typeFilter);
  }, [results, typeFilter]);

  // Group Q&A results by source document
  const groupedResults = useMemo(() => {
    if (typeFilter !== 'q_a_pair') return null;

    const groups = new Map<string, SearchResult[]>();
    const ungrouped: SearchResult[] = [];

    for (const result of filteredResults) {
      const sourceDoc = (result.metadata as Record<string, unknown> | null)?.source_file as string | undefined
        ?? result.source_document;
      if (sourceDoc) {
        const existing = groups.get(sourceDoc) ?? [];
        existing.push(result);
        groups.set(sourceDoc, existing);
      } else {
        ungrouped.push(result);
      }
    }

    return { groups, ungrouped };
  }, [filteredResults, typeFilter]);

  const handleCopy = useCallback(() => {
    // Copy callback — currently just for tracking; toast is handled by the result component
  }, []);

  const shortcutLabel = isMacPlatform() ? '⌘L' : 'Ctrl+L';

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="flex w-full flex-col sm:max-w-md"
        aria-label="Content Library"
      >
        <SheetHeader className="space-y-0 pb-3">
          <SheetTitle className="text-base">Content Library</SheetTitle>
        </SheetHeader>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search content library..."
            className="h-9 pl-9 pr-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                handleQueryChange('');
              }
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => handleQueryChange('')}
              className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="mt-2 flex items-center gap-1.5">
          <Badge
            variant={typeFilter === 'all' ? 'default' : 'secondary'}
            className="cursor-pointer text-xs"
            onClick={() => setTypeFilter('all')}
          >
            All types
          </Badge>
          <Badge
            variant={typeFilter === 'q_a_pair' ? 'default' : 'secondary'}
            className="cursor-pointer text-xs"
            onClick={() => setTypeFilter('q_a_pair')}
          >
            Q&A pairs
          </Badge>
          {hasSearched && !isLoading && (
            <span className="ml-auto text-xs text-muted-foreground">
              {filteredResults.length} result{filteredResults.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Results area */}
        <div className="mt-3 flex-1 overflow-y-auto">
          {/* Loading */}
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-1.5">
                    <Skeleton className="h-5 w-14 rounded-full" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="mt-2 h-4 w-3/4" />
                  <Skeleton className="mt-1.5 h-3 w-full" />
                  <Skeleton className="mt-1 h-3 w-2/3" />
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && !isLoading && (
            <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-8 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => query && search(query, 0.3, 15)}
                className="mt-3"
              >
                Retry
              </Button>
            </div>
          )}

          {/* Empty — no search yet */}
          {!hasSearched && !isLoading && !error && (
            <div className="flex flex-col items-center py-12 text-center">
              <Search className="size-8 text-muted-foreground/30" aria-hidden="true" />
              <p className="mt-3 text-sm text-muted-foreground">
                Search the content library to find answers, policies, and reference material.
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Shortcut: <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">{shortcutLabel}</kbd>
              </p>
            </div>
          )}

          {/* Empty — no results */}
          {hasSearched && !isLoading && !error && filteredResults.length === 0 && (
            <div className="flex flex-col items-center py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No results for &ldquo;{query.slice(0, 60)}{query.length > 60 ? '...' : ''}&rdquo;
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Try different search terms or broaden your filters.
              </p>
              {typeFilter !== 'all' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTypeFilter('all')}
                  className="mt-2"
                >
                  Show all types
                </Button>
              )}
            </div>
          )}

          {/* Results — grouped (Q&A filter active) */}
          {hasSearched && !isLoading && !error && groupedResults && (
            <div className="space-y-4">
              {Array.from(groupedResults.groups.entries()).map(([sourceDoc, items]) => (
                <div key={sourceDoc}>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    From: {sourceDoc}
                    <span className="h-px flex-1 bg-border" />
                  </p>
                  <div className="space-y-2">
                    {items.map((result) => (
                      <ContentLibraryResult
                        key={result.id}
                        result={result}
                        onCopy={handleCopy}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {groupedResults.ungrouped.length > 0 && (
                <div className="space-y-2">
                  {groupedResults.ungrouped.map((result) => (
                    <ContentLibraryResult
                      key={result.id}
                      result={result}
                      onCopy={handleCopy}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Results — flat (all types filter) */}
          {hasSearched && !isLoading && !error && !groupedResults && filteredResults.length > 0 && (
            <div className="space-y-2">
              {/* Contextual suggestions header */}
              {questionText && query === questionText && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  Suggested for this question
                  <span className="h-px flex-1 bg-border" />
                </p>
              )}
              {filteredResults.map((result) => (
                <ContentLibraryResult
                  key={result.id}
                  result={result}
                  onCopy={handleCopy}
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
