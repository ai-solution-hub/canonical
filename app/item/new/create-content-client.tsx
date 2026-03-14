'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import {
  ClassificationFieldset,
  ProvenanceFieldset,
  ProgressiveDepthFieldset,
  SaveActionsBar,
  MobileStepIndicator,
} from '@/components/create-content';

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
          // Reset the form so the user can create another item
          setTitle('');
          setContentHtml('');
          setContentType('');
          setPrimaryDomain('');
          setPrimarySubtopic('');
          setAuthorName('');
          setSourceUrl('');
          setPriority('');
          setKeywordsInput('');
          setTags([]);
          setTagsInput('');
          setBrief('');
          setDetail('');
          setReference('');
          setSaveAsDraft(false);
          setTitleTouched(false);
          setContentTypeTouched(false);
          setContentTouched(false);
          setSaveAttempted(false);
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

  // Mobile step indicator — tracks which section is in view
  const [activeStep, setActiveStep] = useState(1);
  const basicsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Only observe on mobile-sized screens
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 639px)');
    if (!mql.matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const step = Number(entry.target.getAttribute('data-step'));
            if (step) setActiveStep(step);
          }
        }
      },
      { rootMargin: '-40% 0px -40% 0px', threshold: 0 },
    );

    const refs = [basicsRef.current, contentRef.current, detailsRef.current];
    refs.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section aria-label="Create content" className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      {/* Breadcrumb + Header */}
      <BreadcrumbNav
        title={isQAPair ? 'New Q&A Pair' : 'New Item'}
        className="mb-4"
      />
      <div className="mb-6">
        <h1 className="text-xl font-bold">
          {isQAPair ? 'New Q&A Pair' : 'Create New Content'}
        </h1>
      </div>

      {/* Mobile step indicator */}
      <MobileStepIndicator activeStep={activeStep} />

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
        <div ref={basicsRef} data-step="1" className="space-y-2">
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
        <div ref={contentRef} data-step="2" className="space-y-2">
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
          ref={detailsRef as React.RefObject<HTMLButtonElement>}
          data-step="3"
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
            <ClassificationFieldset
              primaryDomain={primaryDomain}
              setPrimaryDomain={setPrimaryDomain}
              primarySubtopic={primarySubtopic}
              setPrimarySubtopic={setPrimarySubtopic}
              keywordsInput={keywordsInput}
              setKeywordsInput={setKeywordsInput}
              domainNames={domainNames}
              subtopicNames={subtopicNames}
              formatDomainName={formatDomainName}
              formatSubtopic={formatSubtopic}
            />

            <ProvenanceFieldset
              authorName={authorName}
              setAuthorName={setAuthorName}
              sourceUrl={sourceUrl}
              setSourceUrl={setSourceUrl}
              tags={tags}
              setTags={setTags}
              tagsInput={tagsInput}
              setTagsInput={setTagsInput}
              priority={priority}
              setPriority={setPriority}
            />

            <ProgressiveDepthFieldset
              brief={brief}
              setBrief={setBrief}
              detail={detail}
              setDetail={setDetail}
              reference={reference}
              setReference={setReference}
            />
          </div>
        )}

        {/* Bottom bar: AI options + save buttons */}
        <SaveActionsBar
          autoClassify={autoClassify}
          setAutoClassify={setAutoClassify}
          autoSummarise={autoSummarise}
          setAutoSummarise={setAutoSummarise}
          saveAsDraft={saveAsDraft}
          setSaveAsDraft={setSaveAsDraft}
          canSave={canSave}
          isSaving={isSaving}
          isSavingAndContinue={isSavingAndContinue}
          onSaveAndContinue={() => handleSave(true)}
        />
      </form>
    </section>
  );
}
