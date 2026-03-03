'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface UserTagInputProps {
  itemId: string;
  tags: string[];
  onTagsChanged?: (tags: string[]) => void;
  className?: string;
}

export function UserTagInput({
  itemId,
  tags: initialTags,
  onTagsChanged,
  className,
}: UserTagInputProps) {
  const [tags, setTags] = useState<string[]>(initialTags ?? []);
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const allTagsRef = useRef<Record<string, number>>({});

  // Sync with parent
  useEffect(() => {
    setTags(initialTags ?? []);
  }, [initialTags]);

  // Fetch all existing tags for autocomplete
  useEffect(() => {
    const fetchTags = async () => {
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();
        const { data } = await supabase.rpc('get_user_tag_counts');
        if (data && typeof data === 'object') {
          allTagsRef.current = data as Record<string, number>;
        }
      } catch {
        // Non-critical -- autocomplete just won't work
      }
    };
    fetchTags();
  }, []);

  const updateTags = useCallback(
    async (newTags: string[]) => {
      const previousTags = tags;
      setTags(newTags);
      onTagsChanged?.(newTags);

      try {
        const res = await fetch(`/api/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field: 'user_tags', value: newTags }),
        });
        if (!res.ok) throw new Error();
      } catch {
        // Rollback
        setTags(previousTags);
        onTagsChanged?.(previousTags);
        toast.error('Failed to update tags');
      }
    },
    [itemId, tags, onTagsChanged],
  );

  const addTag = useCallback(
    (tag: string) => {
      const normalised = tag.trim().toLowerCase();
      if (!normalised) return;
      if (tags.includes(normalised)) {
        toast('Tag already exists', { duration: 1500 });
        return;
      }
      updateTags([...tags, normalised]);
      setInput('');
      setShowSuggestions(false);
      setSelectedIndex(-1);
    },
    [tags, updateTags],
  );

  const removeTag = useCallback(
    (tag: string) => {
      updateTags(tags.filter((t) => t !== tag));
    },
    [tags, updateTags],
  );

  const handleInputChange = (value: string) => {
    setInput(value);
    if (value.trim()) {
      const existing = Object.keys(allTagsRef.current);
      const filtered = existing
        .filter(
          (t) =>
            t.toLowerCase().includes(value.toLowerCase()) &&
            !tags.includes(t),
        )
        .slice(0, 5);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setSelectedIndex(-1);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggestions && selectedIndex >= 0) {
        addTag(suggestions[selectedIndex]);
      } else {
        addTag(input);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    } else if (e.key === 'ArrowDown' && showSuggestions) {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : 0,
      );
    } else if (e.key === 'ArrowUp' && showSuggestions) {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : suggestions.length - 1,
      );
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Tag className="size-3" />
        User Tags
      </h2>

      <div className="relative">
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="gap-1 pr-1 text-xs"
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="rounded-full p-0.5 transition-colors hover:bg-foreground/10"
                aria-label={`Remove tag ${tag}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            onFocus={() => {
              if (input.trim() && suggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            placeholder={tags.length === 0 ? 'Add tags...' : 'Add...'}
            className="h-6 min-w-[60px] flex-1 border-0 p-0 text-xs shadow-none focus-visible:ring-0"
          />
        </div>

        {/* Autocomplete suggestions */}
        {showSuggestions && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover p-1 shadow-md">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(suggestion);
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-sm px-2 py-1 text-sm transition-colors',
                  index === selectedIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent',
                )}
              >
                <span>{suggestion}</span>
                <span className="text-xs text-muted-foreground">
                  {allTagsRef.current[suggestion]}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
