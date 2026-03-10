'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTaxonomy } from '@/contexts/taxonomy-context';

const ContentEditor = dynamic(
  () => import('@/components/content-editor').then((mod) => mod.ContentEditor),
  { ssr: false, loading: () => <div className="h-48 animate-pulse rounded-lg bg-accent" /> },
);
import { toast } from 'sonner';
import { VALID_CONTENT_TYPES } from '@/lib/validation/schemas';

// Content types grouped for the dropdown
const COMMON_TYPES = [
  'q_a_pair',
  'case_study',
  'capability',
  'methodology',
  'policy',
] as const;

function formatContentType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CreateContentClient() {
  const router = useRouter();
  const { getDomainNames, getSubtopics, formatSubtopic, formatDomainName } =
    useTaxonomy();

  // Form state
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [contentType, setContentType] = useState('');
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  // Optional metadata
  const [primaryDomain, setPrimaryDomain] = useState('');
  const [primarySubtopic, setPrimarySubtopic] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [priority, setPriority] = useState('');
  const [keywordsInput, setKeywordsInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagsInput, setTagsInput] = useState('');

  // Progressive depth
  const [brief, setBrief] = useState('');
  const [detail, setDetail] = useState('');
  const [reference, setReference] = useState('');

  // AI options
  const [autoClassify, setAutoClassify] = useState(true);
  const [autoSummarise, setAutoSummarise] = useState(true);

  // Draft toggle
  const [saveAsDraft, setSaveAsDraft] = useState(false);

  // Validation state
  const [titleTouched, setTitleTouched] = useState(false);
  const [contentTypeTouched, setContentTypeTouched] = useState(false);
  const [contentTouched, setContentTouched] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAndContinue, setIsSavingAndContinue] = useState(false);

  // Derived
  const isQAPair = contentType === 'q_a_pair';
  const canSave = title.trim() && contentHtml.trim() && contentType;
  const domainNames = getDomainNames();
  const subtopicNames = primaryDomain ? getSubtopics(primaryDomain) : [];

  // Track whether the form is dirty (any field modified from initial empty state)
  const isDirty =
    title.trim() !== '' ||
    contentHtml.trim() !== '' ||
    contentType !== '' ||
    primaryDomain !== '' ||
    authorName.trim() !== '' ||
    sourceUrl.trim() !== '' ||
    keywordsInput.trim() !== '' ||
    tags.length > 0 ||
    brief.trim() !== '' ||
    detail.trim() !== '' ||
    reference.trim() !== '';

  // Validation error flags
  const showTitleError = !title.trim() && (titleTouched || saveAttempted);
  const showContentTypeError = !contentType && (contentTypeTouched || saveAttempted);
  const showContentError = !contentHtml.trim() && (contentTouched || saveAttempted);

  // IC-4: Unsaved changes guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty && !isSaving && !isSavingAndContinue) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, isSaving, isSavingAndContinue]);

  // Reset subtopic when domain changes
  useEffect(() => {
    setPrimarySubtopic('');
  }, [primaryDomain]);

  const handleSave = useCallback(
    async (continueEditing: boolean) => {
      if (!canSave) return;

      if (continueEditing) {
        setIsSavingAndContinue(true);
      } else {
        setIsSaving(true);
      }

      try {
        // Parse keywords from comma-separated input
        const keywords = keywordsInput
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean);

        const body: Record<string, unknown> = {
          title: title.trim(),
          content: contentHtml,
          content_type: contentType,
          auto_classify: autoClassify,
          auto_summarise: autoSummarise,
          auto_embed: true,
        };

        // Optional fields
        if (primaryDomain) body.primary_domain = primaryDomain;
        if (primarySubtopic) body.primary_subtopic = primarySubtopic;
        if (authorName.trim()) body.author_name = authorName.trim();
        if (sourceUrl.trim()) body.source_url = sourceUrl.trim();
        if (priority) body.priority = priority;
        if (keywords.length > 0) body.ai_keywords = keywords;
        if (tags.length > 0) body.user_tags = tags;
        if (brief.trim()) body.brief = brief.trim();
        if (detail.trim()) body.detail = detail.trim();
        if (reference.trim()) body.reference = reference.trim();
        if (saveAsDraft) body.governance_review_status = 'draft';

        const res = await fetch('/api/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to create content item');
        }

        const tasks: string[] = [];
        if (autoClassify) tasks.push('classification');
        if (autoSummarise) tasks.push('summary');
        const taskMessage =
          tasks.length > 0
            ? ` ${tasks.join(' and ')} ${tasks.length === 1 ? 'is' : 'are'} being generated.`
            : '';

        toast.success(`Content created.${taskMessage}`);

        if (continueEditing) {
          // Stay on the page but show success
          setIsSavingAndContinue(false);
        } else {
          router.push(`/item/${data.id}`);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to create content item',
        );
        setIsSaving(false);
        setIsSavingAndContinue(false);
      }
    },
    [
      canSave,
      title,
      contentHtml,
      contentType,
      autoClassify,
      autoSummarise,
      primaryDomain,
      primarySubtopic,
      authorName,
      sourceUrl,
      priority,
      keywordsInput,
      tags,
      brief,
      detail,
      reference,
      saveAsDraft,
      router,
    ],
  );

  const handleKeywordsKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  };

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

  const saving = isSaving || isSavingAndContinue;

  return (
    <section aria-label="Create content" className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="-ml-2 gap-1.5 text-muted-foreground"
          >
            <Link href="/browse">
              <ArrowLeft className="size-4" />
              Back
            </Link>
          </Button>
          <h1 className="text-xl font-bold">
            {isQAPair ? 'New Q&A Pair' : 'Create New Content'}
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSave(true)}
          disabled={!canSave || saving}
          className="w-full gap-1.5 sm:w-auto"
        >
          {isSavingAndContinue ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Save and Continue Editing
        </Button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSave) {
            setSaveAttempted(true);
            return;
          }
          handleSave(false);
        }}
        className="space-y-6"
      >
        {/* Title / Question */}
        <div className="space-y-2">
          <Label htmlFor="title">
            {isQAPair ? 'Question' : 'Title'}{' '}
            <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setTitleTouched(true)}
            placeholder={
              isQAPair ? 'Enter the question...' : 'Enter title...'
            }
            autoFocus
            required
            maxLength={500}
            aria-invalid={showTitleError || undefined}
            className={showTitleError ? 'border-destructive' : ''}
          />
          {showTitleError && (
            <p className="text-destructive text-sm">
              {isQAPair ? 'Question' : 'Title'} is required
            </p>
          )}
        </div>

        {/* Content Type */}
        <div className="space-y-2">
          <Label htmlFor="content-type">
            Content Type <span className="text-destructive">*</span>
          </Label>
          <Select value={contentType} onValueChange={(val) => { setContentType(val); setContentTypeTouched(true); }}>
            <SelectTrigger
              id="content-type"
              onBlur={() => setContentTypeTouched(true)}
              className={showContentTypeError ? 'border-destructive' : ''}
              aria-invalid={showContentTypeError || undefined}
            >
              <SelectValue placeholder="Select content type..." />
            </SelectTrigger>
            <SelectContent>
              {/* Common types first */}
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                Common
              </div>
              {COMMON_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {formatContentType(type)}
                </SelectItem>
              ))}
              {/* All other types */}
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                More types
              </div>
              {VALID_CONTENT_TYPES.filter(
                (t) => !(COMMON_TYPES as readonly string[]).includes(t),
              ).map((type) => (
                <SelectItem key={type} value={type}>
                  {formatContentType(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showContentTypeError && (
            <p className="text-destructive text-sm">Content type is required</p>
          )}
        </div>

        {/* Content / Answer */}
        <div className="space-y-2">
          <Label>
            {isQAPair ? 'Answer' : 'Content'}{' '}
            <span className="text-destructive">*</span>
          </Label>
          <div onBlur={() => setContentTouched(true)}>
            <ContentEditor
              content={contentHtml}
              onChange={setContentHtml}
              placeholder={
                isQAPair ? 'Write the answer...' : 'Start writing...'
              }
              minHeight="300px"
            />
          </div>
          {showContentError && (
            <p className="text-destructive text-sm">
              {isQAPair ? 'Answer' : 'Content'} is required
            </p>
          )}
        </div>

        {/* More details toggle */}
        <button
          type="button"
          onClick={() => setShowMoreDetails(!showMoreDetails)}
          aria-expanded={showMoreDetails}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {showMoreDetails ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
          More details
        </button>

        {showMoreDetails && (
          <div className="space-y-6">
            {/* Classification */}
            <fieldset className="space-y-4 rounded-lg border border-border p-4">
              <legend className="px-2 text-sm font-semibold text-muted-foreground">
                Classification
              </legend>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="domain">Domain</Label>
                  <Select
                    value={primaryDomain}
                    onValueChange={setPrimaryDomain}
                  >
                    <SelectTrigger id="domain">
                      <SelectValue placeholder="Select domain..." />
                    </SelectTrigger>
                    <SelectContent>
                      {domainNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {formatDomainName(name)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subtopic">Subtopic</Label>
                  <Select
                    value={primarySubtopic}
                    onValueChange={setPrimarySubtopic}
                    disabled={!primaryDomain}
                  >
                    <SelectTrigger id="subtopic">
                      <SelectValue
                        placeholder={
                          primaryDomain
                            ? 'Select subtopic...'
                            : 'Select domain first'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {subtopicNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {formatSubtopic(name)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="keywords">
                  Keywords{' '}
                  <span className="text-xs text-muted-foreground">
                    (comma-separated)
                  </span>
                </Label>
                <Input
                  id="keywords"
                  value={keywordsInput}
                  onChange={(e) => setKeywordsInput(e.target.value)}
                  onKeyDown={handleKeywordsKeyDown}
                  placeholder="Add keywords (comma-separated)..."
                />
              </div>
            </fieldset>

            {/* Provenance */}
            <fieldset className="space-y-4 rounded-lg border border-border p-4">
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
                  />
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

            {/* Progressive depth */}
            <fieldset className="space-y-4 rounded-lg border border-border p-4">
              <legend className="px-2 text-sm font-semibold text-muted-foreground">
                Progressive Depth (optional)
              </legend>

              <div className="space-y-2">
                <Label htmlFor="brief">Brief (executive summary)</Label>
                <Textarea
                  id="brief"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="A brief executive summary..."
                  rows={3}
                  maxLength={5000}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="detail">Detail (expanded explanation)</Label>
                <Textarea
                  id="detail"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Detailed explanation..."
                  rows={4}
                  maxLength={50000}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="reference">
                  Reference (technical/source detail)
                </Label>
                <Textarea
                  id="reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Technical or reference detail..."
                  rows={4}
                  maxLength={50000}
                />
              </div>
            </fieldset>
          </div>
        )}

        {/* Bottom bar: Save + AI options */}
        <div className="flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="auto-classify"
                  checked={autoClassify}
                  onCheckedChange={(checked) =>
                    setAutoClassify(checked === true)
                  }
                />
                <Label htmlFor="auto-classify" className="text-sm font-normal">
                  Classify automatically
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="auto-summarise"
                  checked={autoSummarise}
                  onCheckedChange={(checked) =>
                    setAutoSummarise(checked === true)
                  }
                />
                <Label htmlFor="auto-summarise" className="text-sm font-normal">
                  Generate summary
                </Label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="save-as-draft"
                checked={saveAsDraft}
                onCheckedChange={(checked) =>
                  setSaveAsDraft(checked === true)
                }
              />
              <Label htmlFor="save-as-draft" className="text-sm font-normal">
                Save as draft (hidden from search and matching)
              </Label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              asChild
            >
              <Link href="/browse">Cancel</Link>
            </Button>
            <Button type="submit" disabled={!canSave || saving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
