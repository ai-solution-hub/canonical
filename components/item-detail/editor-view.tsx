'use client';

import { Thumbnail } from '@/components/shared/thumbnail';
import { ContentTabs } from '@/components/item-detail/content-tabs';
import { MetadataSidebar } from '@/components/item-detail/metadata-sidebar';
import { OrganiseSection } from '@/components/item-detail/organise-section';
import { EntityBadges } from '@/components/item-detail/entity-badges';
import { SourceDocumentInfo } from '@/components/source-document/source-document-info';
import { VersionHistory } from '@/components/item-detail/version-history';
import { isFeatureEnabled } from '@/lib/client-config';
import { getDisplayTitle } from '@/lib/format';
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';
import {
  generateIngestUrlPrompt,
  generateSummariseAndIngestPrompt,
} from '@/lib/claude-prompts';
import { ItemActionBar } from '@/components/item-detail/item-action-bar';
import { CollapsibleSection } from '@/components/item-detail/collapsible-section';
import { RelatedContentSection } from '@/components/item-detail/related-content-section';
import { QAUsedInBids, QARelatedPairs } from '@/components/item-detail/qa-provenance-sections';
import { ContentEffectivenessPanel } from '@/components/item-detail/content-effectiveness-panel';
import { ContentBody } from '@/components/item-detail/content-body';
import { LayerSwitcherNav } from '@/components/item-detail/layer-switcher-nav';
import { ItemTitleSection } from '@/components/item-detail/item-title-section';
import { ItemBreadcrumb } from '@/components/item-detail/item-breadcrumb';
import { TopicLayerComparison } from '@/components/browse/topic-layer-comparison';

import type { ReactNode } from 'react';
import type { ItemDetailData } from '@/hooks/use-item-detail-data';
import type { ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorViewProps {
  /** Complete data and handlers from useItemDetailData */
  data: ItemDetailData;
  /** Related items for the current content item */
  relatedItems: Array<ContentListItem & { similarity: number }>;
  /** Optional callback when mode toggle is clicked */
  onModeToggle?: () => void;
  /** Optional React node for the detail mode toggle control */
  detailModeToggle?: ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Editor view for the item detail page.
 *
 * Preserves ALL current editing functionality. This is the full editing
 * interface for curators/editors — functionally identical to the pre-split
 * monolithic rendering.
 *
 * Receives data through props (via useItemDetailData) rather than managing
 * its own state.
 */
export function EditorView({
  data,
  relatedItems,
  onModeToggle: _onModeToggle,
  detailModeToggle,
}: EditorViewProps) {
  const {
    item,
    setItem,
    title,
    isQAPair,
    hasReaderContent,
    transcriptChapters,
    visionAnalysis,
    isMobile,
    canEdit,
    canAdmin,
    router,
    segments,
    highlights,
    inlineEdit,
    qaEditMode,
    isAnalysing,
    handleVisionAnalysis,
    qaProvenance,
    layerContent,
    isLayerContentLoading,
    copied,
    handleCopyLink,
    handleCopyAnswer,
    readerOpen,
    toggleReader,
    tabEditConfig,
    getActiveTabContent,
  } = data;

  // Destructure sub-hook values
  const { editingField, editValue, saveSuccess, saveAnnouncement } = inlineEdit;
  const {
    isEditing,
    editDirty,
    editTitle,
    setEditTitle,
    setEditDirty,
    editStandard,
    editAdvanced,
    setEditStandard,
    setEditAdvanced,
    enterEditMode,
    cancelEditMode,
    handleSaveAll,
  } = qaEditMode;
  const { usedInWorkspaces, relatedQA, topicLayers, handleLayerChange } =
    qaProvenance;

  // --- Content tabs element ---
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
      showSourceToggle={true}
      className="mb-6"
    />
  );

  return (
    <>
      {/* Screen reader: save announcements */}
      <div aria-live="polite" className="sr-only">
        {saveAnnouncement}
      </div>

      {/* Screen reader: keyboard shortcut help */}
      <div className="sr-only" role="note" aria-label="Keyboard shortcuts">
        Available shortcuts: M to toggle read, S to toggle star, P to cycle
        priority, E to toggle edit, R to open reader panel, Shift+D to switch to
        reader mode.
      </div>

      {/* Breadcrumb navigation */}
      <ItemBreadcrumb
        isQAPair={isQAPair}
        primaryDomain={item.primary_domain}
        title={title}
      />

      {/* Layer switcher — shows linked items sharing the same topic_id (editors only) */}
      {canEdit && (
        <LayerSwitcherNav currentItemId={item.id} topicLayers={topicLayers} />
      )}

      {/* Layer comparison — inline tabbed preview of sibling layer content (editors only) */}
      {canEdit &&
        isFeatureEnabled('content_layers') &&
        topicLayers.length > 1 && (
          <TopicLayerComparison
            currentItem={{
              id: item.id as string,
              layer: item.layer ?? '',
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
        <article
          className="min-w-0 flex-1"
          aria-label={item.title ?? 'Untitled'}
        >
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

          {/* Action bar — full editor controls */}
          <div className="sticky top-0 z-10 mb-6 flex flex-wrap items-center gap-2 bg-background py-2 sm:static sm:z-auto">
            <ItemActionBar
              item={item}
              canEdit={canEdit}
              canAdmin={canAdmin}
              isEditing={isEditing}
              detailModeToggle={detailModeToggle}
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
          </div>

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
            {isQAPair && <QAUsedInBids workspaces={usedInWorkspaces} />}

            {/* Q&A related pairs from the same source document */}
            {isQAPair && <QARelatedPairs relatedQA={relatedQA} />}

            {/* OrganiseSection — replaces separate keywords/workspaces/tags (editors only) */}
            {canEdit && (
              <OrganiseSection
                itemId={item.id}
                keywords={(item.ai_keywords as string[]) ?? []}
                workspaces={[]}
                tags={(item.user_tags as string[]) ?? []}
                canEdit={canEdit}
                onKeywordsChanged={(kw) =>
                  setItem((prev) => ({ ...prev, ai_keywords: kw }))
                }
                onTagsChanged={(newTags) =>
                  setItem((prev) => ({ ...prev, user_tags: newTags }))
                }
                onWorkspacesChanged={() => {}}
                className="mb-6"
              />
            )}
          </CollapsibleSection>

          {/* Claude actions — contextual ingestion prompts (editors only) */}
          {canEdit &&
            (item.source_url ||
              (item.content && item.content.length > 5000)) && (
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
                    prompt={
                      generateSummariseAndIngestPrompt(
                        item.title ?? 'Untitled',
                        item.content.slice(0, 500),
                      ).prompt
                    }
                    label="Summarise and add to KB"
                    size="sm"
                  />
                )}
              </div>
            )}

          {/* Content effectiveness — win rate feedback loop */}
          <ContentEffectivenessPanel
            contentItemId={item.id}
            className="mt-6"
          />

          {/* Relationships group (collapsed by default) */}
          <CollapsibleSection
            title="Relationships"
            defaultOpen={false}
            lazy
            className="mt-6"
            contentClassName="mt-2 rounded-xl border border-border bg-card p-6"
          >
            {/* Entity mentions — shows badges grouped by entity type */}
            <EntityBadges contentItemId={item.id} className="mb-6" />

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
        <CollapsibleSection
          title="Metadata"
          defaultOpen={!isMobile}
          className="w-full max-w-md shrink-0 lg:max-w-none lg:w-72"
          contentClassName="mt-2 rounded-xl border border-border bg-card p-4"
        >
          <MetadataSidebar
            item={item}
            editingField={editingField}
            editValue={editValue}
            saveSuccess={saveSuccess}
            startEdit={data.startEdit}
            saveEdit={data.saveEdit}
            readOnly={false}
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
}
