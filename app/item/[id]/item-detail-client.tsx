'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useReadMarks } from '@/contexts/read-marks-context';
import { useTranscript } from '@/hooks/use-transcript';
import { useReaderPreferences } from '@/hooks/use-reader-preferences';
import { Thumbnail } from '@/components/thumbnail';
import { ContentTabs } from '@/components/content-tabs';
import { MetadataSidebar } from '@/components/metadata-sidebar';
import { FloatingReader } from '@/components/floating-reader';
import { ReaderPanel } from '@/components/reader-panel';
import { OrganiseSection } from '@/components/organise-section';
import { EntityBadges } from '@/components/entity-badges';
import { SourceDocumentInfo } from '@/components/source-document-info';
import { VersionHistory } from '@/components/version-history';
import { useUserRole } from '@/hooks/use-user-role';
import { createClient } from '@/lib/supabase/client';
import { isFeatureEnabled } from '@/lib/client-config';
import { getDisplayTitle } from '@/lib/format';
import { ClaudePromptButton } from '@/components/claude-prompt-button';
import {
  generateIngestUrlPrompt,
  generateSummariseAndIngestPrompt,
} from '@/lib/claude-prompts';
import { useInlineFieldEdit } from '@/hooks/use-inline-field-edit';
import { toast } from 'sonner';

// Extracted hooks
import { useQAEditMode } from '@/hooks/use-qa-edit-mode';
import { useVisionAnalysis } from '@/hooks/use-vision-analysis';
import { useQAProvenance } from '@/hooks/use-qa-provenance';
import { useTopicLayerContent } from '@/hooks/use-topic-layer-content';
import { useItemDetailShortcuts } from '@/hooks/use-item-detail-shortcuts';
import type { VisionAnalysisResult } from '@/hooks/use-vision-analysis';

// Extracted sub-components
import { ItemActionBar } from '@/components/item-action-bar';
import {
  CollapsibleSection,
  RelatedContentSection,
  QAUsedInBids,
  QARelatedPairs,
  ContentBody,
  LayerSwitcherNav,
  ItemTitleSection,
  ItemBreadcrumb,
} from '@/components/item-detail';
import { TopicLayerComparison } from '@/components/topic-layer-comparison';
import { ErrorBoundary } from '@/components/error-boundary';

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
  content_owner_id?: string | null;
  source_document_id?: string | null;
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

  // Detect mobile for collapsible section defaults
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)');
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
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
  const inlineEdit = useInlineFieldEdit<ItemData>({
    itemId: item.id,
    onItemUpdate: setItem,
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

  // Fetch sibling layer content for inline comparison
  const { layerContent, isLoading: isLayerContentLoading } = useTopicLayerContent(
    topicLayers,
    item.id as string,
  );

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
      <ItemBreadcrumb
        isQAPair={isQAPair}
        primaryDomain={item.primary_domain}
        title={title}
      />

      {/* Layer switcher — shows linked items sharing the same topic_id */}
      <LayerSwitcherNav
        currentItemId={item.id}
        topicLayers={topicLayers}
      />

      {/* Layer comparison — inline tabbed preview of sibling layer content */}
      {isFeatureEnabled('content_layers') && topicLayers.length > 1 && (
        <TopicLayerComparison
          currentItem={{
            id: item.id as string,
            layer: (item.metadata?.layer as string) ?? '',
            title: item.title ?? '',
            brief: item.brief ?? null,
            detail: item.detail ?? null,
            content: item.content ?? null,
            content_type: item.content_type as string,
            metadata: item.metadata,
          }}
          layerContent={layerContent}
          isLoading={isLayerContentLoading}
        />
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

          {/* Title + inline badges + editing banner */}
          <ItemTitleSection
            item={item}
            title={title}
            isEditing={isEditing}
            editDirty={editDirty}
            editTitle={editTitle}
            setEditTitle={setEditTitle}
            setEditDirty={setEditDirty}
            handleSaveAll={handleSaveAll}
            cancelEditMode={cancelEditMode}
          />

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

          {/* Content group (expanded by default) */}
          <CollapsibleSection title="Content" defaultOpen>
            <ContentBody
              item={item}
              setItem={setItem}
              isQAPair={isQAPair}
              canEdit={canEdit}
              contentTabsElement={contentTabsElement}
              isEditing={isEditing}
              editStandard={editStandard}
              editAdvanced={editAdvanced}
              setEditStandard={setEditStandard}
              setEditAdvanced={setEditAdvanced}
              setEditDirty={setEditDirty}
              handleCopyAnswer={handleCopyAnswer}
              visionAnalysis={visionAnalysis}
              transcriptChapters={transcriptChapters}
              segments={segments}
              highlights={highlights}
              handleLayerChange={handleLayerChange}
              getActiveTabContent={getActiveTabContent}
            />

            {/* Q&A provenance: bids using this pair */}
            {isQAPair && (
              <QAUsedInBids workspaces={usedInWorkspaces} />
            )}

            {/* Q&A related pairs from the same source document */}
            {isQAPair && (
              <QARelatedPairs relatedQA={relatedQA} />
            )}

            {/* OrganiseSection — replaces separate keywords/workspaces/tags */}
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
          </CollapsibleSection>

          {/* Claude actions — contextual ingestion prompts */}
          {(item.source_url || (item.content && item.content.length > 5000)) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {item.source_url && (
                <ClaudePromptButton
                  prompt={generateIngestUrlPrompt(item.source_url).prompt}
                  label="Re-ingest source"
                  size="sm"
                />
              )}
              {item.content && item.content.length > 5000 && (
                <ClaudePromptButton
                  prompt={generateSummariseAndIngestPrompt(
                    item.title ?? 'Untitled',
                    item.content.slice(0, 500),
                  ).prompt}
                  label="Summarise and add to KB"
                  size="sm"
                />
              )}
            </div>
          )}

          {/* Relationships group (collapsed by default) */}
          <CollapsibleSection title="Relationships" defaultOpen={false} className="mt-6" contentClassName="mt-2 rounded-xl border border-border bg-card p-6">
            {/* Entity mentions — shows badges grouped by entity type */}
            <EntityBadges
              contentItemId={item.id}
              className="mb-6"
            />

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
              className="mb-6"
            />

            {/* Consolidated related content section */}
            <RelatedContentSection
              relatedItems={relatedItems}
              itemId={item.id}
              userTags={(item.user_tags as string[]) ?? []}
            />
          </CollapsibleSection>
        </article>

        {/* Metadata sidebar (expanded on desktop, collapsed on mobile) */}
        <CollapsibleSection title="Metadata" defaultOpen={!isMobile} className="w-full max-w-md shrink-0 lg:max-w-none lg:w-72" contentClassName="mt-2 rounded-xl border border-border bg-card p-4">
          <MetadataSidebar
            item={item}
            editingField={editingField}
            editValue={editValue}
            saveSuccess={saveSuccess}
            startEdit={startEdit}
            saveEdit={saveEdit}
            readOnly={!canEdit}
            onOwnerChanged={(ownerId) =>
              setItem((prev) => ({ ...prev, content_owner_id: ownerId }))
            }
          />
          {/* Source document lineage */}
          {item.source_document_id && (
            <div className="mt-4 border-t border-border pt-4">
              <SourceDocumentInfo sourceDocumentId={item.source_document_id} />
            </div>
          )}
        </CollapsibleSection>
      </div>
    </>
  );

  return (
    <ErrorBoundary label="Error loading item details">
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
    </ErrorBoundary>
  );
}
