'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ProvenanceFieldsetProps {
  authorName: string;
  setAuthorName: (value: string) => void;
  sourceUrl: string;
  setSourceUrl: (value: string) => void;
  tags: string[];
  setTags: (tags: string[]) => void;
  tagsInput: string;
  setTagsInput: (value: string) => void;
  priority: string;
  setPriority: (value: string) => void;
  /** Validation error message for the source URL field */
  sourceUrlError?: string;
}

/**
 * Provenance fieldset for the create content form.
 * Contains author, source URL, tags, and priority fields.
 */
export function ProvenanceFieldset({
  authorName,
  setAuthorName,
  sourceUrl,
  setSourceUrl,
  tags,
  setTags,
  tagsInput,
  setTagsInput,
  priority,
  setPriority,
  sourceUrlError,
}: ProvenanceFieldsetProps) {
  const handleTagsKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = tagsInput.trim();
      if (val && !tags.includes(val)) {
        setTags([...tags, val]);
        setTagsInput('');
      }
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  return (
    <fieldset className="space-y-4 rounded-lg border border-border bg-accent/30 p-4">
      <legend className="px-2 text-sm font-semibold text-muted-foreground">
        Provenance
      </legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="author">Author</Label>
          <Input
            id="author"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="Author name..."
            maxLength={200}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="source-url">Source URL</Label>
          <Input
            id="source-url"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://..."
            maxLength={2000}
            aria-invalid={!!sourceUrlError || undefined}
            aria-describedby={sourceUrlError ? 'source-url-error' : undefined}
            className={sourceUrlError ? 'border-destructive' : ''}
          />
          {sourceUrlError && (
            <p id="source-url-error" className="text-destructive text-sm" role="alert">
              {sourceUrlError}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="tags">Tags</Label>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-foreground/10"
                aria-label={`Remove tag ${tag}`}
              >
                &times;
              </button>
            </span>
          ))}
          <Input
            id="tags"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            onKeyDown={handleTagsKeyDown}
            placeholder="Add tag and press Enter..."
            className="h-7 w-40 border-dashed text-xs"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Priority</Label>
        <div
          className="flex gap-4"
          role="radiogroup"
          aria-label="Priority"
        >
          {['', 'high', 'medium', 'low'].map((p) => (
            <label
              key={p || 'none'}
              className="flex items-center gap-1.5 text-sm"
            >
              <input
                type="radio"
                name="priority"
                value={p}
                checked={priority === p}
                onChange={() => setPriority(p)}
                className="accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              {p ? p.charAt(0).toUpperCase() + p.slice(1) : 'None'}
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
