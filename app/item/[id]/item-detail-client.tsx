'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useReadMarks } from '@/contexts/read-marks-context';
import { useTranscript } from '@/hooks/use-transcript';
import { useReaderPreferences } from '@/hooks/use-reader-preferences';
import { TranscriptReader } from '@/components/transcript-reader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Thumbnail } from '@/components/thumbnail';
import { ContentTabs } from '@/components/content-tabs';
import { MetadataSidebar } from '@/components/metadata-sidebar';
import { RelatedItems } from '@/components/related-items';
import { RelatedByTags } from '@/components/related-by-tags';
import { VersionHistory } from '@/components/version-history';
import { ContentTypeHeader } from '@/components/content-type-header';
import { VerificationBadge } from '@/components/verification-badge';
import dynamic from 'next/dynamic';

const ImageGallery = dynamic(
  () => import('@/components/image-gallery').then((mod) => mod.ImageGallery),
  { ssr: false, loading: () => <div className="h-32 animate-pulse rounded-lg bg-accent" /> },
);
import { FloatingReader } from '@/components/floating-reader';
import { ReaderPanel } from '@/components/reader-panel';

import { TableOfContents } from '@/components/table-of-contents';
import { OrganiseSection } from '@/components/organise-section';
import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { useUserRole } from '@/hooks/use-user-role';
import { createClient } from '@/lib/supabase/client';
import { getDisplayTitle } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useInlineFieldEdit } from '@/hooks/use-inline-field-edit';
import { isFeatureEnabled } from '@/lib/client-config';
import { getLayerLabel } from '@/lib/validation/layer-schemas';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

// Extracted hooks
import { useQAEditMode } from '@/hooks/use-qa-edit-mode';
import { useVisionAnalysis } from '@/hooks/use-vision-analysis';
import { useQAProvenance } from '@/hooks/use-qa-provenance';
import { useItemDetailShortcuts } from '@/hooks/use-item-detail-shortcuts';
import type { VisionAnalysisResult } from '@/hooks/use-vision-analysis';

// Extracted sub-components
import { ItemActionBar } from '@/components/item-action-bar';
import { QAAnswerDisplay } from '@/components/qa-answer-display';
import { ContentLayerSelector } from '@/components/content-layer-selector';
import { AiProcessingIndicators } from '@/components/ai-processing-indicators';

import type {
  ContentListItem,
  SummaryData,
  TranscriptChapter,
} from '@/types/content';
import type { Priority } from '@/components/priority-selector';
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
  answer_standard?: string | null;
  answer_advanced?: string | null;
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

  // Editable field states (extracted hook)
  const inlineEdit = useInlineFieldEdit({
    itemId: item.id,
    onItemUpdate: (updater) => setItem((prev) => updater(prev as unknown as Record<string, unknown>) as unknown as ItemData),
  });
  const { editingField, editValue, saveSuccess, saveAnnouncement } = inlineEdit;

  const title = getDisplayTitle({
    suggested_title: item.suggested_title,
    title: item.title,
    content: item.content,
  });

  const isQAPair = item.content_type === 'q_a_pair';

  // Extracted hook: Q&A edit mode
  const {
    isEditing,
    setIsEditing,
    editDirty,
    setEditDirty,
    editTitle,
    setEditTitle,
    editStandard,
    setEditStandard,
    editAdvanced,
    setEditAdvanced,
    isSavingTab,
    setIsSavingTab,
    enterEditMode,
    cancelEditMode,
    handleSaveAll,
  } = useQAEditMode({
    itemId: item.id,
    title,
    answerStandard: item.answer_standard,
    answerAdvanced: item.answer_advanced,
    isQAPair,
    onFieldSaved: useCallback((field: string, value: string | null) => {
      setItem((prev) => ({ ...prev, [field]: value }));
    }, []),
  });

  // Extracted hook: Vision analysis
  const { isAnalysing, handleVisionAnalysis } = useVisionAnalysis({
    itemId: item.id,
    onAnalysisComplete: useCallback((result: VisionAnalysisResult) => {
      setItem((prev) => ({
        ...prev,
        metadata: { ...prev.metadata, vision_analysis: result },
      }));
    }, []),
  });
  const visionAnalysis = item.metadata?.vision_analysis as VisionAnalysisResult | undefined;

  // Extracted hook: Q&A provenance (workspaces, related Q&A, topic layers, layer change)
  const { usedInWorkspaces, relatedQA, topicLayers, handleLayerChange } = useQAProvenance({
    itemId: item.id,
    isQAPair,
    metadata: item.metadata,
    onMetadataUpdate: useCallback((updater: (prev: Record<string, unknown> | null) => Record<string, unknown> | null) => {
      setItem((prev) => ({ ...prev, metadata: updater(prev.metadata) }));
    }, []),
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

  const startEdit = (field: string) => {
    inlineEdit.startEdit(field, (item as unknown as Record<string, unknown>)[field]);
  };

  const cancelEdit = inlineEdit.cancelEdit;
  const saveEdit = inlineEdit.saveEdit;

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
    } catch (err) {
      console.error('Failed to toggle star:', err);
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
    } catch (err) {
      console.error('Failed to cycle priority:', err);
      setItem((prev) => ({ ...prev, priority: item.priority }));
    }
  }, [item.id, item.priority]);

  // Copy answer handler (Q&A pairs)
  const handleCopyAnswer = useCallback(async (variant?: 'standard' | 'advanced') => {
    let text: string;
    if (variant === 'standard') {
      text = item.answer_standard ?? item.content ?? '';
    } else if (variant === 'advanced') {
      text = item.answer_advanced ?? item.content ?? '';
    } else {
      text = item.content ?? '';
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(variant ? `${variant.charAt(0).toUpperCase() + variant.slice(1)} answer copied` : 'Answer copied');
    } catch {
      toast.error('Failed to copy answer');
    }
  }, [item.content, item.answer_standard, item.answer_advanced]);

  // Helper: get active tab content for TableOfContents
  const getActiveTabContent = useCallback((): string => {
    if (item.brief) return item.brief;
    if (item.summary_data?.executive) return item.summary_data.executive;
    if (item.ai_summary) return item.ai_summary;
    if (item.content) return item.content;
    return '';
  }, [item.brief, item.summary_data, item.ai_summary, item.content]);

  // Navigate away prompt when dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (editDirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editDirty]);

  // Keyboard shortcuts (extracted hook)
  useItemDetailShortcuts({
    itemId: item.id,
    toggleRead,
    handleStarToggle,
    handlePriorityCycle,
    toggleReader,
    readerOpen,
    toggleDetached,
    canEdit,
    title,
    answerStandard: item.answer_standard,
    answerAdvanced: item.answer_advanced,
    setIsEditing,
    setEditTitle,
    setEditStandard,
    setEditAdvanced,
    setEditDirty,
    router,
  });

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

  const hasReaderContent = !!(item.metadata?.reader_html) && !isQAPair;

  // Build editConfig for ContentTabs — bridges existing saveEdit / startEdit
  const tabFields = ['brief', 'detail', 'reference', 'content'] as const;
  type TabField = (typeof tabFields)[number];
  const tabEditingField: TabField | null = tabFields.includes(editingField as TabField)
    ? (editingField as TabField)
    : null;

  const tabEditConfig = canEdit
    ? {
        editingField: tabEditingField,
        editValue,
        isSaving: isSavingTab,
        onStartEdit: (field: TabField) => startEdit(field),
        onEditValueChange: inlineEdit.setEditValue,
        onSaveEdit: async (field: string) => {
          setIsSavingTab(true);
          try {
            await saveEdit(field, editValue);
          } finally {
            setIsSavingTab(false);
          }
        },
        onCancelEdit: cancelEdit,
      }
    : undefined;

  const contentTabsElement = (
    <ContentTabs
      itemId={item.id as string}
      summaryData={item.summary_data ?? null}
      contentType={item.content_type as string}
      content={item.content}
      aiSummary={item.ai_summary}
      brief={item.brief}
      detail={item.detail}
      reference={item.reference}
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
      canEdit={canEdit}
      editConfig={tabEditConfig}
      className="mb-6"
    />
  );

  // Item detail content -- extracted to keep the PanelGroup JSX clean
  const itemDetailContent = (
    <>
      {/* Screen reader: save announcements */}
      <div aria-live="polite" className="sr-only">{saveAnnouncement}</div>

      {/* Screen reader: keyboard shortcut help */}
      <div className="sr-only" role="note" aria-label="Keyboard shortcuts">
        Available shortcuts: M to toggle read, S to toggle star, P to cycle priority, E to toggle edit, R to open reader panel.
      </div>

      {/* Breadcrumb navigation */}
      {isQAPair ? (
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <li>
              <Link href="/library" className="hover:text-foreground transition-colors">
                Q&A Library
              </Link>
            </li>
            {item.primary_domain && (
              <>
                <li aria-hidden="true">/</li>
                <li>{item.primary_domain}</li>
              </>
            )}
          </ol>
        </nav>
      ) : (
        <BreadcrumbNav
          domain={item.primary_domain as string | null}
          title={title}
          className="mb-4"
        />
      )}

      {/* Layer switcher — shows linked items sharing the same topic_id */}
      {isFeatureEnabled('content_layers') && topicLayers.length > 1 && (
        <nav aria-label="Content layers" className="mb-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground mr-1">Layers:</span>
            {topicLayers.map((layerItem) => {
              const isCurrent = layerItem.id === item.id;
              const label = layerItem.layer
                ? getLayerLabel(layerItem.layer)
                : layerItem.title ?? 'Untitled';
              return isCurrent ? (
                <Badge
                  key={layerItem.id}
                  variant="default"
                  className="text-xs"
                >
                  {label}
                </Badge>
              ) : (
                <Link key={layerItem.id} href={`/item/${layerItem.id}`}>
                  <Badge
                    variant="outline"
                    className="text-xs cursor-pointer hover:bg-accent transition-colors"
                  >
                    {label}
                  </Badge>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Main content */}
        <article className="min-w-0 flex-1">
          {/* Thumbnail (not shown for Q&A pairs) */}
          {item.thumbnail_url && !isQAPair ? (
            <Thumbnail
              src={item.thumbnail_url as string | null}
              alt={title}
              contentType={item.content_type as string}
              domain={item.primary_domain as string}
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 80vw, 800px"
              className="mb-6 max-w-2xl"
            />
          ) : null}

          {/* Title + inline badges */}
          <div className="mb-2">
            {isEditing ? (
              <Input
                autoFocus
                value={editTitle}
                onChange={(e) => {
                  setEditTitle(e.target.value);
                  setEditDirty(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveAll();
                  if (e.key === 'Escape') cancelEditMode();
                }}
                className="text-xl font-bold"
              />
            ) : (
              <h1 className="text-fluid-xl font-bold leading-tight break-words">{title}</h1>
            )}
            {/* Inline badges */}
            {(item.verified_at || item.source_document) && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <VerificationBadge verified={!!item.verified_at} size="md" />
                {item.source_document && (
                  <span className="text-xs text-muted-foreground">
                    Source: <span className="font-medium text-foreground/80">{item.source_document}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Editing banner */}
          {isEditing && (
            <div className="mb-4 flex items-center justify-between rounded-md border border-status-warning/30 bg-quality-moderate-bg px-4 py-2 text-sm">
              <span className="font-medium text-status-warning">
                Editing{editDirty ? ' \u2014 unsaved changes' : ''}
              </span>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveAll}>Save</Button>
                <Button size="sm" variant="outline" onClick={cancelEditMode}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Action bar */}
          <ItemActionBar
            item={item}
            canEdit={canEdit}
            canAdmin={canAdmin}
            isEditing={isEditing}
            isQAPair={isQAPair}
            isAnalysing={isAnalysing}
            copied={copied}
            hasReaderContent={hasReaderContent}
            title={title}
            readerOpen={readerOpen}
            enterEditMode={enterEditMode}
            cancelEditMode={cancelEditMode}
            handleCopyLink={handleCopyLink}
            handleCopyAnswer={handleCopyAnswer}
            handleVisionAnalysis={handleVisionAnalysis}
            toggleReader={toggleReader}
            setItem={setItem}
          />

          {/* Content-type specific header */}
          <ContentTypeHeader
            contentType={item.content_type}
            platform={item.platform}
            metadata={item.metadata}
            sourceUrl={item.source_url}
            authorName={item.author_name}
          />

          {/* AI processing indicators (classify / summarise — not for Q&A pairs) */}
          {canEdit && item.content && !isQAPair && (
            <AiProcessingIndicators
              item={item}
              onItemUpdated={setItem}
            />
          )}

          {/* Content display — Q&A pair gets dedicated layout, others get tabs */}
          {isQAPair ? (
            <QAAnswerDisplay
              item={item}
              isEditing={isEditing}
              editStandard={editStandard}
              editAdvanced={editAdvanced}
              setEditStandard={setEditStandard}
              setEditAdvanced={setEditAdvanced}
              setEditDirty={setEditDirty}
              handleCopyAnswer={handleCopyAnswer}
            />
          ) : (
            contentTabsElement
          )}

          {/* Q&A provenance: bids using this pair */}
          {isQAPair && usedInWorkspaces.length > 0 && (
            <div className="mb-6 rounded-xl border border-border bg-card p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Used in {usedInWorkspaces.length} bid{usedInWorkspaces.length !== 1 ? 's' : ''}
              </h3>
              <div className="flex flex-wrap gap-2">
                {usedInWorkspaces.map((w) => (
                  <Link
                    key={w.id}
                    href={`/bid/${w.id}`}
                    className="rounded-md border border-border px-2.5 py-1 text-sm text-foreground hover:bg-accent transition-colors"
                  >
                    {w.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Q&A related pairs from the same source document */}
          {isQAPair && relatedQA.length > 0 && (
            <div className="mb-6 rounded-xl border border-border bg-card p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Related Q&A pairs (same source)
              </h3>
              <ul className="space-y-1">
                {relatedQA.map((q) => (
                  <li key={q.id}>
                    <Link
                      href={`/item/${q.id}`}
                      className="block rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent transition-colors"
                    >
                      {q.title ?? 'Untitled'}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Table of Contents (not shown for Q&A pairs) */}
          {!isQAPair && (
            <TableOfContents content={getActiveTabContent()} className="mb-6" />
          )}

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

          {/* Transcript reader (for transcripts with chapters) */}
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

          {/* Content Layer selector */}
          <ContentLayerSelector
            item={item}
            canEdit={canEdit}
            handleLayerChange={handleLayerChange}
          />

          {/* Draft toggle (editors only, when draft_status feature enabled) */}
          {isFeatureEnabled('draft_status') && canEdit && (
            <section className="mb-6 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </h3>
                <button
                  type="button"
                  onClick={async () => {
                    const isDraft = item.governance_review_status === 'draft';
                    const newStatus = isDraft ? null : 'draft';
                    setItem((prev) => ({ ...prev, governance_review_status: newStatus }));
                    try {
                      const supabase = createClient();
                      const { error } = await supabase
                        .from('content_items')
                        .update({ governance_review_status: newStatus })
                        .eq('id', item.id);
                      if (error) throw error;
                      toast.success(isDraft ? 'Published' : 'Marked as draft');
                    } catch (err) {
                      console.error('Failed to update governance review status:', err);
                      setItem((prev) => ({ ...prev, governance_review_status: isDraft ? 'draft' : null }));
                      toast.error('Failed to update status');
                    }
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    item.governance_review_status === 'draft'
                      ? 'border-status-warning bg-quality-moderate-bg text-status-warning hover:bg-freshness-aging-bg'
                      : 'border-status-success bg-freshness-fresh-bg text-status-success hover:bg-freshness-fresh-bg',
                  )}
                >
                  {item.governance_review_status === 'draft' ? 'Draft — click to publish' : 'Published — click to draft'}
                </button>
              </div>
            </section>
          )}

          {/* OrganiseSection (Item 6) — replaces separate keywords/workspaces/tags */}
          <OrganiseSection
            itemId={item.id}
            keywords={(item.ai_keywords as string[]) ?? []}
            workspaces={[]}
            tags={(item.user_tags as string[]) ?? []}
            canEdit={canEdit}
            onKeywordsChanged={(kw) => setItem((prev) => ({ ...prev, ai_keywords: kw }))}
            onTagsChanged={(newTags) => setItem((prev) => ({ ...prev, user_tags: newTags }))}
            onWorkspacesChanged={() => {}}
            className="mb-6"
          />
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

      {/* Related by shared tags */}
      {(item.user_tags?.length ?? 0) > 0 && (
        <RelatedByTags
          itemId={item.id}
          tags={(item.user_tags as string[]) ?? []}
        />
      )}
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
