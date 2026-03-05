'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  BookOpen,
  Copy,
  Check,
  Pencil,
  X,
  Eye,
  Loader2,
} from 'lucide-react';
import { ReadToggleButton } from '@/components/read-toggle-button';
import { StarButton } from '@/components/star-button';
import { PrioritySelector, type Priority } from '@/components/priority-selector';
import { useReadMarks } from '@/contexts/read-marks-context';
import { useTranscript } from '@/hooks/use-transcript';
import { useReaderPreferences } from '@/hooks/use-reader-preferences';
import { TranscriptReader } from '@/components/transcript-reader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Thumbnail } from '@/components/thumbnail';
import { SummaryTabs } from '@/components/summary-tabs';
import { MetadataSidebar } from '@/components/metadata-sidebar';
import { RelatedItems } from '@/components/related-items';
import { VersionHistory } from '@/components/version-history';
import { ContentTypeHeader } from '@/components/content-type-header';
import { VerificationBadge } from '@/components/verification-badge';
import dynamic from 'next/dynamic';

const PdfViewer = dynamic(
  () => import('@/components/pdf-viewer').then((mod) => mod.PdfViewer),
  { ssr: false, loading: () => <div className="h-9 w-24 animate-pulse rounded bg-accent" /> },
);
const ImageGallery = dynamic(
  () => import('@/components/image-gallery').then((mod) => mod.ImageGallery),
  { ssr: false, loading: () => <div className="h-32 animate-pulse rounded-lg bg-accent" /> },
);
import { FloatingReader } from '@/components/floating-reader';
import { ReaderPanel } from '@/components/reader-panel';
import { ProjectSelector } from '@/components/project-selector';
import { UserTagInput } from '@/components/user-tag-input';
import { DeleteContentDialog } from '@/components/delete-content-dialog';
import { ContentRenderer } from '@/components/content-renderer';
import { useUserRole } from '@/hooks/use-user-role';
import { createClient } from '@/lib/supabase/client';
import { getDisplayTitle } from '@/lib/format';
import { validateEditableField } from '@/lib/validation';
import { toast } from 'sonner';

const ContentEditor = dynamic(
  () => import('@/components/content-editor').then((mod) => mod.ContentEditor),
  { ssr: false, loading: () => <div className="h-48 animate-pulse rounded-lg bg-accent" /> },
);
import type {
  ContentListItem,
  SummaryData,
  TranscriptChapter,
} from '@/types/content';
import type { Layout } from 'react-resizable-panels';

export interface ItemData {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content: string | null;
  ai_summary: string | null;
  ai_keywords: string[] | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  secondary_domain: string | null;
  secondary_subtopic: string | null;
  content_type: string | null;
  platform: string | null;
  author_name: string | null;
  source_url: string | null;
  file_path: string | null;
  source_domain: string | null;
  thumbnail_url: string | null;
  captured_date: string | null;
  classification_confidence: number | null;
  classification_reasoning: string | null;
  classified_at: string | null;
  summary_data: SummaryData | null;
  priority: string | null;
  user_tags: string[] | null;
  freshness: string | null;
  governance_review_status: string | null;
  metadata: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  // Phase 5 fields
  verified_at?: string | null;
  verified_by?: string | null;
  source_document?: string | null;
  source_bid?: string | null;
  brief?: string | null;
  detail?: string | null;
  reference?: string | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// AI Processing Indicators (classify / summarise prompts)
// ---------------------------------------------------------------------------

function AiProcessingIndicators({
  item,
  onItemUpdated,
}: {
  item: ItemData;
  onItemUpdated: React.Dispatch<React.SetStateAction<ItemData>>;
}) {
  const [classifying, setClassifying] = useState(false);
  const [summarising, setSummarising] = useState(false);

  const needsClassification = !item.classified_at;
  const needsSummary = !item.ai_summary;

  if (!needsClassification && !needsSummary) return null;

  const handleClassify = async () => {
    setClassifying(true);
    try {
      const res = await fetch(`/api/items/${item.id}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Classification failed');
        return;
      }
      onItemUpdated((prev) => ({
        ...prev,
        primary_domain: data.primary_domain,
        primary_subtopic: data.primary_subtopic,
        secondary_domain: data.secondary_domain,
        secondary_subtopic: data.secondary_subtopic,
        ai_keywords: data.ai_keywords,
        ai_summary: data.ai_summary,
        suggested_title: data.suggested_title,
        classification_confidence: data.classification_confidence,
        classification_reasoning: data.classification_reasoning,
        classified_at: new Date().toISOString(),
      }));
      toast.success('Classification complete');
    } catch {
      toast.error('Failed to classify content');
    } finally {
      setClassifying(false);
    }
  };

  const handleSummarise = async () => {
    setSummarising(true);
    try {
      const res = await fetch('/api/summaries/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Summary generation failed');
        return;
      }
      onItemUpdated((prev) => ({
        ...prev,
        ai_summary: data.ai_summary ?? prev.ai_summary,
        summary_data: data.summary_data ?? prev.summary_data,
      }));
      toast.success('Summary generated');
    } catch {
      toast.error('Failed to generate summary');
    } finally {
      setSummarising(false);
    }
  };

  return (
    <div className="mb-6 flex flex-col gap-2">
      {needsClassification && (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Classification pending
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClassify}
            disabled={classifying}
            className="h-7 gap-1.5 text-xs"
          >
            {classifying ? (
              <Loader2 className="size-3 animate-spin" />
            ) : null}
            {classifying ? 'Classifying...' : 'Classify now'}
          </Button>
        </div>
      )}
      {needsSummary && (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Summary not yet generated
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSummarise}
            disabled={summarising}
            className="h-7 gap-1.5 text-xs"
          >
            {summarising ? (
              <Loader2 className="size-3 animate-spin" />
            ) : null}
            {summarising ? 'Generating...' : 'Generate summary'}
          </Button>
        </div>
      )}
    </div>
  );
}

interface ItemDetailClientProps {
  item: ItemData;
  relatedItems: Array<ContentListItem & { similarity: number }>;
}

export function ItemDetailClient({
  item: initialItem,
  relatedItems,
}: ItemDetailClientProps) {
  const router = useRouter();
  const { canEdit, canAdmin } = useUserRole();
  const [item, setItem] = useState<ItemData>(initialItem);
  const {
    segments,
    highlights,
  } = useTranscript({
    itemId: item.id as string,
    initialSegments: null,
    initialHighlights: null,
  });
  const [copied, setCopied] = useState(false);
  const {
    fontSize,
    maxWidth,
    panelLayout,
    readerOpen,
    isDetached,
    detachedPosition,
    detachedSize,
    setFontSize,
    setMaxWidth,
    setPanelLayout,
    setReaderOpen,
    toggleReader,
    toggleDetached,
    setDetachedPosition,
    setDetachedSize,
  } = useReaderPreferences();
  const showSplitReader = readerOpen && !isDetached;

  // Editable field states
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveAnnouncement, setSaveAnnouncement] = useState('');

  // Content body editing state
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editContentHtml, setEditContentHtml] = useState('');
  const [isSavingContent, setIsSavingContent] = useState(false);
  const [regenerateEmbedding, setRegenerateEmbedding] = useState(false);
  const [reclassifyAfterSave, setReclassifyAfterSave] = useState(false);

  // Progressive depth editing state
  const [editingDepthField, setEditingDepthField] = useState<string | null>(null);
  const [editDepthValue, setEditDepthValue] = useState('');
  const [isSavingDepth, setIsSavingDepth] = useState(false);

  // Vision analysis state
  const [isAnalysing, setIsAnalysing] = useState(false);
  const visionAnalysis = item.metadata?.vision_analysis as
    | { analysis: string; analysed_at: string; model: string; tokens_used: number }
    | undefined;

  const title = getDisplayTitle({
    suggested_title: item.suggested_title,
    title: item.title,
    content: item.content,
  });

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  }, []);

  const handleVisionAnalysis = useCallback(async () => {
    setIsAnalysing(true);
    try {
      const res = await fetch(`/api/items/${item.id}/vision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Vision analysis failed');
        return;
      }
      // Update local item state with the analysis
      setItem((prev) => ({
        ...prev,
        metadata: {
          ...prev.metadata,
          vision_analysis: {
            analysis: data.analysis,
            analysed_at: new Date().toISOString(),
            model: data.model,
            tokens_used: data.tokens_used,
          },
        },
      }));
      toast.success('Visual analysis complete');
    } catch {
      toast.error('Failed to perform visual analysis');
    } finally {
      setIsAnalysing(false);
    }
  }, [item.id]);

  const startEdit = (field: string) => {
    setEditingField(field);
    setEditValue(String(item[field] ?? ''));
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const saveEdit = async (field: string, value: unknown) => {
    if (!validateEditableField(field)) {
      console.error(`Field "${field}" is not editable`);
      toast.error('This field cannot be edited');
      return;
    }

    const previousValue = item[field];

    // Optimistic update
    setItem((prev) => ({ ...prev, [field]: value }));
    setEditingField(null);

    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Update failed');
      }

      setSaveSuccess(field);
      setSaveAnnouncement('Title saved');
      setTimeout(() => {
        setSaveSuccess(null);
        setSaveAnnouncement('');
      }, 1500);
    } catch {
      // Rollback
      setItem((prev) => ({ ...prev, [field]: previousValue }));
      setSaveAnnouncement('Save failed');
      setTimeout(() => setSaveAnnouncement(''), 1500);
      toast.error('Failed to save — please try again');
    }
  };

  const handleKeywordRemove = (keyword: string) => {
    const current = (item.ai_keywords as string[]) ?? [];
    const updated = current.filter((k) => k !== keyword);
    saveEdit('ai_keywords', updated);
  };

  const handleKeywordAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = (e.target as HTMLInputElement).value.trim();
      if (!val) return;
      const current = (item.ai_keywords as string[]) ?? [];
      if (!current.includes(val)) {
        saveEdit('ai_keywords', [...current, val]);
      }
      (e.target as HTMLInputElement).value = '';
    }
  };

  // Content body editing handlers
  const startContentEdit = useCallback(() => {
    setEditContentHtml(item.content ?? '');
    setIsEditingContent(true);
    setRegenerateEmbedding(false);
    setReclassifyAfterSave(false);
  }, [item.content]);

  const cancelContentEdit = useCallback(() => {
    setIsEditingContent(false);
    setEditContentHtml('');
  }, []);

  const saveContentEdit = useCallback(async () => {
    if (!editContentHtml.trim()) return;
    setIsSavingContent(true);

    const previousContent = item.content;
    setItem((prev) => ({ ...prev, content: editContentHtml }));
    setIsEditingContent(false);

    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'content',
          value: editContentHtml,
          regenerate_embedding: regenerateEmbedding,
          reclassify: reclassifyAfterSave,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Update failed');
      }

      toast.success('Content saved');
    } catch {
      setItem((prev) => ({ ...prev, content: previousContent }));
      setIsEditingContent(true);
      setEditContentHtml(previousContent ?? '');
      toast.error('Failed to save content — please try again');
    } finally {
      setIsSavingContent(false);
    }
  }, [editContentHtml, item.id, item.content, regenerateEmbedding, reclassifyAfterSave]);

  // Progressive depth field editing handlers
  const startDepthEdit = useCallback((field: string) => {
    setEditingDepthField(field);
    setEditDepthValue(String(item[field] ?? ''));
  }, [item]);

  const cancelDepthEdit = useCallback(() => {
    setEditingDepthField(null);
    setEditDepthValue('');
  }, []);

  const saveDepthEdit = useCallback(async (field: string) => {
    setIsSavingDepth(true);
    const previousValue = item[field];
    const newValue = editDepthValue.trim() || null;

    setItem((prev) => ({ ...prev, [field]: newValue }));
    setEditingDepthField(null);

    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value: newValue }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Update failed');
      }

      toast.success(`${field.charAt(0).toUpperCase() + field.slice(1)} saved`);
    } catch {
      setItem((prev) => ({ ...prev, [field]: previousValue }));
      toast.error('Failed to save — please try again');
    } finally {
      setIsSavingDepth(false);
    }
  }, [editDepthValue, item]);

  const { toggleRead, loadReadMarks, checkReadStatus } = useReadMarks();

  // Trigger lazy loading of read marks counts for this page
  useEffect(() => { loadReadMarks(); }, [loadReadMarks]);

  // Check read status for this specific item
  useEffect(() => {
    if (item?.id) {
      checkReadStatus([item.id]);
    }
  }, [item?.id, checkReadStatus]);

  // Star toggle handler for keyboard shortcut
  const handleStarToggle = useCallback(async () => {
    const newStarred = item.metadata?.starred !== true;
    setItem((prev) => ({
      ...prev,
      metadata: { ...prev.metadata, starred: newStarred || undefined },
    }));
    try {
      const supabase = createClient();
      await supabase.rpc('toggle_star', {
        p_item_id: item.id,
        p_starred: newStarred,
      });
      toast(newStarred ? 'Starred' : 'Unstarred', { duration: 1500 });
    } catch {
      // Rollback
      setItem((prev) => ({
        ...prev,
        metadata: { ...prev.metadata, starred: !newStarred || undefined },
      }));
    }
  }, [item.id, item.metadata]);

  // Cycle priority: null -> high -> medium -> low -> null
  const handlePriorityCycle = useCallback(async () => {
    const cycle: Priority[] = [null, 'high', 'medium', 'low'];
    const currentIdx = cycle.indexOf((item.priority as Priority) ?? null);
    const next = cycle[(currentIdx + 1) % cycle.length];
    setItem((prev) => ({ ...prev, priority: next }));
    try {
      const res = await fetch(`/api/items/${item.id}/priority`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: next }),
      });
      if (!res.ok) throw new Error();
      toast(next ? `Priority: ${next}` : 'Priority cleared', { duration: 1500 });
    } catch {
      setItem((prev) => ({ ...prev, priority: item.priority }));
    }
  }, [item.id, item.priority]);

  // Keyboard shortcuts: m = toggle read, s = toggle star, p = cycle priority, r = toggle reader, Shift+R = review
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
        return;

      if (e.key === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleRead(item.id as string);
        toast('Read state toggled', { duration: 1500 });
      }
      if (e.key === 's' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        handleStarToggle();
      }
      if (e.key === 'p' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        handlePriorityCycle();
      }
      if (e.key === 'r' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleReader();
      }
      if (
        e.key === 'R' &&
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        if (readerOpen) {
          toggleDetached();
        } else {
          router.push('/review');
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [item.id, toggleRead, router, handleStarToggle, handlePriorityCycle, toggleReader, readerOpen, toggleDetached]);

  const transcriptChapters =
    item.metadata &&
    Array.isArray((item.metadata as Record<string, unknown>).chapters)
      ? ((item.metadata as Record<string, unknown>)
          .chapters as TranscriptChapter[])
      : undefined;

  const handleLayoutChanged = useCallback(
    (layout: Layout) => {
      setPanelLayout(layout);
    },
    [setPanelLayout],
  );

  // Item detail content -- extracted to keep the PanelGroup JSX clean
  const itemDetailContent = (
    <>
      {/* Screen reader: save announcements */}
      <div aria-live="polite" className="sr-only">{saveAnnouncement}</div>

      {/* Screen reader: keyboard shortcut help */}
      <div className="sr-only" role="note" aria-label="Keyboard shortcuts">
        Available shortcuts: M to toggle read, S to toggle star, P to cycle priority, R to open reader panel.
      </div>

      {/* Header: back + actions */}
      <div className="mb-4 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="-ml-2 gap-1.5 text-muted-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <div className="flex items-center gap-1">
          <PrioritySelector
            itemId={item.id}
            priority={(item.priority as Priority) ?? null}
            size="md"
            onChanged={(p) => setItem((prev) => ({ ...prev, priority: p }))}
          />
          <StarButton
            itemId={item.id}
            starred={item.metadata?.starred === true}
            size="md"
          />
        </div>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Main content */}
        <article className="min-w-0 flex-1">
          {/* Thumbnail */}
          {item.thumbnail_url ? (
            <Thumbnail
              src={item.thumbnail_url as string | null}
              alt={title}
              contentType={item.content_type as string}
              domain={item.primary_domain as string}
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 80vw, 800px"
              className="mb-6 max-w-2xl"
            />
          ) : null}

          {/* Title (editable) */}
          <div className="group mb-4 flex items-start gap-2">
            {editingField === 'suggested_title' ? (
              <div className="flex w-full items-center gap-2">
                <Input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')
                      saveEdit('suggested_title', editValue);
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  className="text-xl font-bold"
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => saveEdit('suggested_title', editValue)}
                  className="min-h-[44px] min-w-[44px]"
                >
                  <Check className="size-4" />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={cancelEdit} className="min-h-[44px] min-w-[44px]">
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <>
                <h1 className="text-fluid-xl font-bold leading-tight">
                  {title}
                </h1>
                {saveSuccess === 'suggested_title' ? (
                  <Check className="mt-1 size-4 shrink-0 text-[var(--success)]" />
                ) : canEdit ? (
                  <button
                    onClick={() => startEdit('suggested_title')}
                    className="mt-1 shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    aria-label="Edit title"
                  >
                    <Pencil className="size-3.5 text-muted-foreground" />
                  </button>
                ) : null}
              </>
            )}
          </div>

          {/* Keywords (editable) */}
          {((item.ai_keywords as string[])?.length > 0 ||
            editingField === 'ai_keywords') && (
            <section className="mb-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Keywords
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {((item.ai_keywords as string[]) ?? []).map((keyword) => (
                  <Badge
                    key={keyword}
                    variant="secondary"
                    className="group/kw gap-1 pr-1"
                  >
                    <Link
                      href={`/browse?keywords=${encodeURIComponent(keyword)}`}
                      className="hover:underline"
                    >
                      {keyword}
                    </Link>
                    {canEdit && (
                      <button
                        onClick={() => handleKeywordRemove(keyword)}
                        className="rounded-full p-0.5 opacity-100 transition-opacity hover:bg-foreground/10 sm:opacity-0 sm:group-hover/kw:opacity-100 sm:group-focus-within/kw:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Remove ${keyword}`}
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </Badge>
                ))}
                {canEdit && (
                  <Input
                    placeholder="Add keyword..."
                    onKeyDown={handleKeywordAdd}
                    className="h-6 w-28 border-dashed text-xs"
                  />
                )}
              </div>
            </section>
          )}

          {/* Projects (editor+ only) */}
          {canEdit && (
            <ProjectSelector itemId={item.id} className="mb-6" />
          )}

          {/* User tags (editor+ only) */}
          {canEdit && (
            <UserTagInput
              itemId={item.id}
              tags={(item.user_tags as string[]) ?? []}
              onTagsChanged={(newTags) =>
                setItem((prev) => ({ ...prev, user_tags: newTags }))
              }
              className="mb-6"
            />
          )}

          {/* Verification status + source provenance */}
          {(item.verified_at || item.source_document) && (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <VerificationBadge
                verified={!!item.verified_at}
                size="md"
              />
              {item.source_document && (
                <span className="text-xs text-muted-foreground">
                  Source: <span className="font-medium text-foreground/80">{item.source_document}</span>
                </span>
              )}
            </div>
          )}

          {/* Content body section (Q&A pair or regular) — editable */}
          {item.content_type === 'q_a_pair' ? (
            <section className="mb-6 rounded-lg border border-border bg-muted/30 p-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Question
              </h2>
              <p className="mb-4 text-sm font-medium leading-relaxed text-foreground">
                {item.suggested_title || item.title || 'Untitled question'}
              </p>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Answer
                </h2>
                {canEdit && !isEditingContent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={startContentEdit}
                    className="gap-1.5 text-xs"
                  >
                    <Pencil className="size-3" />
                    Edit
                  </Button>
                )}
              </div>
              {isEditingContent ? (
                <div className="space-y-3">
                  <ContentEditor
                    content={editContentHtml}
                    onChange={setEditContentHtml}
                    placeholder="Write the answer..."
                    minHeight="200px"
                  />
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={regenerateEmbedding}
                        onChange={(e) => setRegenerateEmbedding(e.target.checked)}
                        className="accent-primary"
                      />
                      Re-generate embedding
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={reclassifyAfterSave}
                        onChange={(e) => setReclassifyAfterSave(e.target.checked)}
                        className="accent-primary"
                      />
                      Re-classify after save
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={saveContentEdit} disabled={isSavingContent}>
                      {isSavingContent ? 'Saving...' : 'Save'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelContentEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : item.content ? (
                <ContentRenderer content={item.content} />
              ) : null}
            </section>
          ) : item.content && !['transcript', 'pdf'].includes(item.content_type ?? '') ? (
            <section className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Content
                </h2>
                {canEdit && !isEditingContent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={startContentEdit}
                    className="gap-1.5 text-xs"
                  >
                    <Pencil className="size-3" />
                    Edit
                  </Button>
                )}
              </div>
              {isEditingContent ? (
                <div className="space-y-3">
                  <ContentEditor
                    content={editContentHtml}
                    onChange={setEditContentHtml}
                    placeholder="Edit content..."
                    minHeight="200px"
                  />
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={regenerateEmbedding}
                        onChange={(e) => setRegenerateEmbedding(e.target.checked)}
                        className="accent-primary"
                      />
                      Re-generate embedding
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={reclassifyAfterSave}
                        onChange={(e) => setReclassifyAfterSave(e.target.checked)}
                        className="accent-primary"
                      />
                      Re-classify after save
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={saveContentEdit} disabled={isSavingContent}>
                      {isSavingContent ? 'Saving...' : 'Save'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelContentEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : item.content ? (
                <ContentRenderer content={item.content} />
              ) : null}
            </section>
          ) : null}

          {/* AI processing indicators (classify / summarise) */}
          {canEdit && item.content && (
            <AiProcessingIndicators
              item={item}
              onItemUpdated={setItem}
            />
          )}

          {/* Progressive depth sections (editable) */}
          {(item.brief || item.detail || item.reference || canEdit) && (
            <section className="mb-6 space-y-4">
              <p className="mb-2 text-xs text-muted-foreground">
                Human-authored content layers
              </p>
              {['brief', 'detail', 'reference'].map((field) => {
                const fieldValue = item[field] as string | null;
                const isEditing = editingDepthField === field;
                const labels: Record<string, string> = {
                  brief: 'Summary',
                  detail: 'Full Detail',
                  reference: 'Reference Material',
                };

                if (!fieldValue && !isEditing && !canEdit) return null;

                return (
                  <div key={field}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {labels[field]}
                      </h2>
                      {canEdit && !isEditing && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startDepthEdit(field)}
                          className="gap-1.5 text-xs"
                        >
                          <Pencil className="size-3" />
                          {fieldValue ? 'Edit' : 'Add'}
                        </Button>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editDepthValue}
                          onChange={(e) => setEditDepthValue(e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          rows={4}
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => saveDepthEdit(field)}
                            disabled={isSavingDepth}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={cancelDepthEdit}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : fieldValue ? (
                      <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                        {fieldValue}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          )}

          {/* Content-type specific header */}
          <ContentTypeHeader
            contentType={item.content_type}
            platform={item.platform}
            metadata={item.metadata}
            sourceUrl={item.source_url}
            authorName={item.author_name}
          />

          {/* Multi-level summary */}
          <SummaryTabs
            itemId={item.id as string}
            summaryData={item.summary_data ?? null}
            contentType={item.content_type as string}
            content={item.content}
            aiSummary={item.ai_summary}
            readerHtml={item.metadata?.reader_html as string | undefined}
            hideFullText={
              item.content_type === 'transcript' &&
              !!transcriptChapters &&
              transcriptChapters.length > 0
            }
            platform={item.platform}
            metadata={item.metadata}
            authorName={item.author_name}
            sourceUrl={item.source_url}
            transcriptChapters={transcriptChapters}
            segments={segments}
            highlights={highlights}
            frameable={item.metadata?.frameable === true}
            className="mb-6"
          />

          {/* Vision analysis (PDF items) */}
          {visionAnalysis && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold">Visual Analysis</h2>
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                {visionAnalysis.analysis}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Analysed {new Date(visionAnalysis.analysed_at).toLocaleDateString('en-GB')} · {visionAnalysis.model} · {visionAnalysis.tokens_used.toLocaleString()} tokens
              </p>
            </section>
          )}

          {/* Extracted images gallery (PDF items) */}
          {item.content_type === 'pdf' &&
            (item.file_path || item.source_url) && (
              <ImageGallery
                itemId={item.id}
                hasExtractedImages={
                  Array.isArray(
                    (item.metadata as Record<string, unknown> | null)
                      ?.extracted_images,
                  )
                }
                className="mb-6"
              />
            )}

          {/* Transcript reader (for transcripts with chapters -- Full Text tab is hidden for these) */}
          {item.content &&
            item.content_type === 'transcript' &&
            transcriptChapters &&
            transcriptChapters.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Transcript
                </h2>
                <TranscriptReader
                  content={item.content}
                  chapters={transcriptChapters}
                  segments={segments ?? undefined}
                  highlights={highlights ?? undefined}
                />
              </section>
            )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap">
            <ReadToggleButton itemId={item.id as string} />
            <Button
              variant={readerOpen ? 'default' : 'outline'}
              size="sm"
              onClick={toggleReader}
              className="gap-1.5"
            >
              <BookOpen className="size-3.5" />
              {readerOpen ? 'Close Reader' : 'Open Reader'}
            </Button>
            {item.content_type === 'pdf' && (item.source_url || item.file_path) && (
              <>
                <PdfViewer
                  sourceUrl={item.source_url ?? undefined}
                  filePath={item.file_path ?? undefined}
                  title={title}
                />
                <Button
                  variant={visionAnalysis ? 'outline' : 'default'}
                  size="sm"
                  onClick={handleVisionAnalysis}
                  disabled={isAnalysing}
                  className="gap-1.5"
                >
                  {isAnalysing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Eye className="size-3.5" />
                  )}
                  {isAnalysing
                    ? 'Analysing…'
                    : visionAnalysis
                      ? 'Re-analyse'
                      : 'Visual Analysis'}
                </Button>
              </>
            )}
            {item.source_url && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(item.source_url as string, '_blank')}
                className="gap-1.5"
              >
                {item.content_type === 'pdf' ? (
                  <FileText className="size-3.5" />
                ) : (
                  <ExternalLink className="size-3.5" />
                )}
                {item.content_type === 'pdf'
                  ? 'Open PDF'
                  : 'Open original'}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyLink}
              className="gap-1.5"
            >
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            {canAdmin && (
              <div className="ml-auto">
                <DeleteContentDialog
                  itemId={item.id}
                  itemTitle={title}
                />
              </div>
            )}
          </div>
        </article>

        {/* Metadata sidebar */}
        <MetadataSidebar
          item={item}
          editingField={editingField}
          editValue={editValue}
          saveSuccess={saveSuccess}
          startEdit={startEdit}
          saveEdit={saveEdit}
          readOnly={!canEdit}
        />
      </div>

      {/* Version history */}
      <VersionHistory
        itemId={item.id}
        currentContent={item.content ?? ''}
        currentTitle={getDisplayTitle({
          suggested_title: item.suggested_title,
          title: item.title,
          content: item.content,
        })}
        onRollback={() => router.refresh()}
        className="mt-8"
      />

      {/* Related content */}
      <RelatedItems relatedItems={relatedItems} />
    </>
  );

  const readerPanelProps = {
    readerHtml: item.metadata?.reader_html as string | undefined,
    contentType: item.content_type,
    title,
    fontSize,
    maxWidth,
    onFontSizeChange: setFontSize,
    onMaxWidthChange: setMaxWidth,
    onClose: () => setReaderOpen(false),
    platform: item.platform,
    metadata: item.metadata,
    authorName: item.author_name,
    sourceUrl: item.source_url,
    filePath: item.file_path,
    content: item.content,
    transcriptChapters,
    segments,
    highlights,
    frameable: item.metadata?.frameable === true,
    onDetachToggle: toggleDetached,
  };

  return (
    <>
    <PanelGroup
      orientation="horizontal"
      onLayoutChanged={handleLayoutChanged}
      defaultLayout={showSplitReader ? panelLayout : undefined}
      className="min-h-[calc(100vh-4rem)]"
    >
      <Panel
        id="detail"
        defaultSize={showSplitReader ? `${panelLayout.detail ?? 55}%` : '100%'}
        minSize="30%"
      >
        <div className="mx-auto max-w-7xl overflow-y-auto px-4 py-6 sm:px-6">
          {itemDetailContent}
        </div>
      </Panel>
      {showSplitReader && (
        <>
          <PanelResizeHandle className="w-1.5 bg-border transition-colors hover:bg-primary/20 data-[active]:bg-primary/30" />
          <Panel
            id="reader"
            defaultSize={`${panelLayout.reader ?? 45}%`}
            minSize="25%"
          >
            <div className="h-full border-l border-border bg-background">
              <ReaderPanel
                {...readerPanelProps}
                isDetached={false}
              />
            </div>
          </Panel>
        </>
      )}
    </PanelGroup>
    {readerOpen && isDetached && (
      <FloatingReader
        readerHtml={item.metadata?.reader_html as string | undefined}
        contentType={item.content_type}
        title={title}
        fontSize={fontSize}
        maxWidth={maxWidth}
        onFontSizeChange={setFontSize}
        onMaxWidthChange={setMaxWidth}
        onClose={() => setReaderOpen(false)}
        onDock={toggleDetached}
        position={detachedPosition}
        size={detachedSize}
        onPositionChange={setDetachedPosition}
        onSizeChange={setDetachedSize}
        platform={item.platform}
        metadata={item.metadata}
        authorName={item.author_name}
        sourceUrl={item.source_url}
        filePath={item.file_path}
        content={item.content}
        transcriptChapters={transcriptChapters}
        segments={segments}
        highlights={highlights}
      />
    )}
    </>
  );
}
