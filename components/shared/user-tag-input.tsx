'use client';

import { useState, useCallback, useEffect } from 'react';
import { X, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { TagAutocomplete } from '@/components/shared/tag-autocomplete';
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

  // Sync with parent
  useEffect(() => {
    setTags(initialTags ?? []);
  }, [initialTags]);

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
      } catch (err) {
        console.error('Failed to update tags:', err);
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
    },
    [tags, updateTags],
  );

  const removeTag = useCallback(
    (tag: string) => {
      updateTags(tags.filter((t) => t !== tag));
    },
    [tags, updateTags],
  );

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Tag className="size-3" />
        User Tags
      </h2>

      <div className="flex flex-wrap items-center gap-1.5">
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
      </div>

      {/* Server-side tag autocomplete via /api/tags/suggest */}
      <div
        onKeyDown={(e) => {
          if (e.key === 'Backspace' && tags.length > 0) {
            // If the input is empty, remove the last tag on Backspace
            const input = e.target as HTMLInputElement;
            if (input.value === '') {
              removeTag(tags[tags.length - 1]);
            }
          }
        }}
      >
        <TagAutocomplete
          type="user"
          excludeTags={tags}
          onSelect={addTag}
          placeholder={tags.length === 0 ? 'Add tags...' : 'Add...'}
          className="text-xs"
        />
      </div>
    </div>
  );
}
