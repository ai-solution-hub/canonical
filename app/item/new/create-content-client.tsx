'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { LayerSuggestionBanner, type LayerSuggestionData } from '@/components/layer-suggestion-banner';
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
import {
  CreateContentFormSchema,
  CREATE_CONTENT_DEFAULTS,
} from '@/lib/validation/create-content-schema';
import type { CreateContentFormValues } from '@/lib/validation/create-content-schema';

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

  const methods = useForm<CreateContentFormValues>({
    resolver: zodResolver(CreateContentFormSchema),
    defaultValues: CREATE_CONTENT_DEFAULTS,
    mode: 'onTouched',
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
    trigger,
  } = methods;

  // Watch key values
  const contentType = watch('content_type');
  const contentHtml = watch('content');
  const primaryDomain = watch('primary_domain');
  const tags = watch('user_tags') ?? [];
  const tagsInput = watch('tags_input');
  const autoClassify = watch('auto_classify');
  const autoSummarise = watch('auto_summarise');
  const saveAsDraft = watch('save_as_draft');

  // UI state
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [isSavingAndContinue, setIsSavingAndContinue] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Layer suggestion state (shown after item creation)
  const [layerSuggestion, setLayerSuggestion] = useState<{
    itemId: string;
    data: LayerSuggestionData;
  } | null>(null);

  // Derived
  const isQAPair = contentType === 'q_a_pair';
  const domainNames = getDomainNames();
  const subtopicNames = primaryDomain ? getSubtopics(primaryDomain) : [];

  const title = watch('title');

  // Minimum required fields check for button state — use watched values
  // rather than formState.isValid so the button enables as soon as required
  // fields are filled, without waiting for all optional fields to validate.
  const canSave = !!title.trim() && !!contentHtml.trim() && !!contentType;

  // Reset subtopic when domain changes
  useEffect(() => {
    setValue('primary_subtopic', '');
  }, [primaryDomain, setValue]);

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

  const onSubmit = useCallback(
    async (data: CreateContentFormValues, continueEditing: boolean) => {
      if (continueEditing) {
        setIsSavingAndContinue(true);
      } else {
        setIsSaving(true);
      }

      try {
        // Parse keywords from comma-separated input
        const keywords = (data.keywords_input ?? '')
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean);

        const body: Record<string, unknown> = {
          title: data.title.trim(),
          content: data.content,
          content_type: data.content_type,
          auto_classify: data.auto_classify,
          auto_summarise: data.auto_summarise,
          auto_embed: true,
        };

        // Optional fields
        if (data.primary_domain) body.primary_domain = data.primary_domain;
        if (data.primary_subtopic) body.primary_subtopic = data.primary_subtopic;
        if (data.author_name?.trim()) body.author_name = data.author_name.trim();
        if (data.source_url?.trim()) body.source_url = data.source_url.trim();
        if (data.priority) body.priority = data.priority;
        if (keywords.length > 0) body.ai_keywords = keywords;
        if (data.user_tags && data.user_tags.length > 0) body.user_tags = data.user_tags;
        if (data.brief?.trim()) body.brief = data.brief.trim();
        if (data.detail?.trim()) body.detail = data.detail.trim();
        if (data.reference?.trim()) body.reference = data.reference.trim();
        if (data.save_as_draft) body.governance_review_status = 'draft';

        const res = await fetch('/api/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const responseData = await res.json();

        if (!res.ok) {
          throw new Error(responseData.error || 'Failed to create content item');
        }

        const tasks: string[] = [];
        if (data.auto_classify) tasks.push('classification');
        if (data.auto_summarise) tasks.push('summary');
        const taskMessage =
          tasks.length > 0
            ? ` ${tasks.join(' and ')} ${tasks.length === 1 ? 'is' : 'are'} being generated.`
            : '';

        toast.success(`Content created.${taskMessage}`);

        // Show layer suggestion banner if the API returned one
        if (responseData.suggested_layer) {
          setLayerSuggestion({
            itemId: responseData.id,
            data: responseData.suggested_layer as LayerSuggestionData,
          });
        }

        if (continueEditing) {
          reset(CREATE_CONTENT_DEFAULTS);
          setLayerSuggestion(null);
          setIsSavingAndContinue(false);
        } else {
          router.push(`/item/${responseData.id}`);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to create content item',
        );
        setIsSaving(false);
        setIsSavingAndContinue(false);
      }
    },
    [reset, router],
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

      {/* Layer suggestion banner (shown after item creation) */}
      {layerSuggestion && (
        <div className="mb-6">
          <LayerSuggestionBanner
            itemId={layerSuggestion.itemId}
            suggestedLayer={layerSuggestion.data}
            onDismiss={() => setLayerSuggestion(null)}
          />
        </div>
      )}

      {/* Mobile step indicator */}
      <MobileStepIndicator activeStep={activeStep} />

      <FormProvider {...methods}>
        <form
          onSubmit={handleSubmit((data) => onSubmit(data, false))}
          noValidate
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
              {...register('title')}
              placeholder={
                isQAPair ? 'Enter the question...' : 'Enter title...'
              }
              autoFocus
              maxLength={500}
              aria-invalid={!!errors.title || undefined}
              aria-describedby={errors.title ? 'title-error' : undefined}
              className={errors.title ? 'border-destructive' : ''}
            />
            {errors.title && (
              <p id="title-error" className="text-destructive text-sm" role="alert">
                {isQAPair
                  ? errors.title.message?.replace('Title', 'Question')
                  : errors.title.message}
              </p>
            )}
          </div>

          {/* Content Type */}
          <div className="space-y-2">
            <Label htmlFor="content-type">
              Content Type <span className="text-destructive">*</span>
            </Label>
            <Select
              value={contentType}
              onValueChange={(val) => {
                setValue('content_type', val, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
              }}
            >
              <SelectTrigger
                id="content-type"
                onBlur={() => trigger('content_type')}
                className={errors.content_type ? 'border-destructive' : ''}
                aria-invalid={!!errors.content_type || undefined}
                aria-describedby={errors.content_type ? 'content-type-error' : undefined}
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
            {errors.content_type && (
              <p id="content-type-error" className="text-destructive text-sm" role="alert">
                {errors.content_type.message}
              </p>
            )}
          </div>

          {/* Content / Answer */}
          <div ref={contentRef} data-step="2" className="space-y-2">
            <Label>
              {isQAPair ? 'Answer' : 'Content'}{' '}
              <span className="text-destructive">*</span>
            </Label>
            <div
              onBlur={() => trigger('content')}
            >
              <ContentEditor
                content={contentHtml}
                onChange={(val: string) => {
                  setValue('content', val, { shouldValidate: true, shouldDirty: true });
                }}
                placeholder={
                  isQAPair ? 'Write the answer...' : 'Start writing...'
                }
                minHeight="300px"
              />
            </div>
            {errors.content && (
              <p id="content-error" className="text-destructive text-sm" role="alert">
                {isQAPair
                  ? errors.content.message?.replace('Content', 'Answer')
                  : errors.content.message}
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
                primaryDomain={primaryDomain ?? ''}
                setPrimaryDomain={(val) => setValue('primary_domain', val, { shouldDirty: true })}
                primarySubtopic={watch('primary_subtopic') ?? ''}
                setPrimarySubtopic={(val) => setValue('primary_subtopic', val, { shouldDirty: true })}
                keywordsInput={watch('keywords_input') ?? ''}
                setKeywordsInput={(val) => setValue('keywords_input', val, { shouldDirty: true })}
                domainNames={domainNames}
                subtopicNames={subtopicNames}
                formatDomainName={formatDomainName}
                formatSubtopic={formatSubtopic}
              />

              <ProvenanceFieldset
                authorName={watch('author_name') ?? ''}
                setAuthorName={(val) => setValue('author_name', val, { shouldDirty: true })}
                sourceUrl={watch('source_url') ?? ''}
                setSourceUrl={(val) => setValue('source_url', val, { shouldDirty: true })}
                tags={tags}
                setTags={(val) => setValue('user_tags', val, { shouldDirty: true })}
                tagsInput={tagsInput ?? ''}
                setTagsInput={(val) => setValue('tags_input', val, { shouldDirty: true })}
                priority={watch('priority') ?? ''}
                setPriority={(val) => setValue('priority', val as '' | 'high' | 'medium' | 'low', { shouldDirty: true })}
                sourceUrlError={errors.source_url?.message}
              />

              <ProgressiveDepthFieldset
                brief={watch('brief') ?? ''}
                setBrief={(val) => setValue('brief', val, { shouldDirty: true })}
                detail={watch('detail') ?? ''}
                setDetail={(val) => setValue('detail', val, { shouldDirty: true })}
                reference={watch('reference') ?? ''}
                setReference={(val) => setValue('reference', val, { shouldDirty: true })}
                briefError={errors.brief?.message}
                detailError={errors.detail?.message}
                referenceError={errors.reference?.message}
              />
            </div>
          )}

          {/* Bottom bar: AI options + save buttons */}
          <SaveActionsBar
            autoClassify={autoClassify}
            setAutoClassify={(val) => setValue('auto_classify', val, { shouldDirty: true })}
            autoSummarise={autoSummarise}
            setAutoSummarise={(val) => setValue('auto_summarise', val, { shouldDirty: true })}
            saveAsDraft={saveAsDraft}
            setSaveAsDraft={(val) => setValue('save_as_draft', val, { shouldDirty: true })}
            canSave={canSave}
            isSaving={isSaving}
            isSavingAndContinue={isSavingAndContinue}
            onSaveAndContinue={() => handleSubmit((data) => onSubmit(data, true))()}
          />
        </form>
      </FormProvider>
    </section>
  );
}
