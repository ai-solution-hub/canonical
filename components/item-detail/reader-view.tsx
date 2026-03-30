'use client';

import { Copy, BookOpen, ExternalLink, MoreHorizontal, FileText, ChevronDown } from 'lucide-react';
import { Thumbnail } from '@/components/shared/thumbnail';
import { ContentTabs } from '@/components/item-detail/content-tabs';
import { MetadataSidebar } from '@/components/item-detail/metadata-sidebar';
import { EntityBadges } from '@/components/item-detail/entity-badges';
import { SourceDocumentInfo } from '@/components/source-document/source-document-info';
import { VersionHistory } from '@/components/item-detail/version-history';
import { ReadToggleButton } from '@/components/shared/read-toggle-button';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { QAAnswerDisplay } from '@/components/qa/qa-answer-display';
import { ContentTypeHeader } from '@/components/shared/content-type-header';
import { TableOfContents } from '@/components/item-detail/table-of-contents';
import { TranscriptReader } from '@/components/reader/transcript-reader';
import { VerificationBadge } from '@/components/shared/verification-badge';
import { FreshnessBadge } from '@/components/shared/freshness-badge';
import { getDisplayTitle } from '@/lib/format';
import dynamic from 'next/dynamic';

import { CollapsibleSection } from '@/components/item-detail/collapsible-section';
import { RelatedContentSection } from '@/components/item-detail/related-content-section';
import { QAUsedInBids, QARelatedPairs } from '@/components/item-detail/qa-provenance-sections';
import { ContentEffectivenessPanel } from '@/components/item-detail/content-effectiveness-panel';
import { ItemBreadcrumb } from '@/components/item-detail/item-breadcrumb';

import type { ReactNode } from 'react';
import type { ItemDetailData } from '@/hooks/use-item-detail-data';
import type { ContentListItem } from '@/types/content';

const PdfViewer = dynamic(
  () => import('@/components/reader/pdf-viewer').then((mod) => mod.PdfViewer),
  { ssr: false, loading: () => <div className="h-9 w-24 animate-pulse rounded bg-accent" /> },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReaderViewProps {
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
 * Reader view for the item detail page.
 *
 * Designed for the reading experience — clean, content-first layout without
 * editing controls, governance machinery, or AI source messaging. This is
 * NOT "editor with buttons hidden" — it is a purpose-built reading interface.
 *
 * Shown to:
 * - Viewers (always)
 * - Editors who toggle to reader mode (via DetailModeToggle)
 */
export function ReaderView({
  data,
  relatedItems,
  onModeToggle: _onModeToggle,
  detailModeToggle,
}: ReaderViewProps) {
  const {
    item,
    title,
    isQAPair,
    hasReaderContent,
    transcriptChapters,
    isMobile,
    router,
    segments,
    highlights,
    copied,
    handleCopyLink,
    handleCopyAnswer,
    readerOpen,
    toggleReader,
    getActiveTabContent,
    qaProvenance,
  } = data;

  const { usedInWorkspaces, relatedQA } = qaProvenance;

  // --- Reader-mode content tabs (no edit controls, no source toggle) ---
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
      canEdit={false}
      showSourceToggle={false}
      className="mb-6"
    />
  );

  return (
    <>
      {/* Screen reader: keyboard shortcut help */}
      <div className="sr-only" role="note" aria-label="Keyboard shortcuts">
        {data.canEdit
          ? 'Available shortcuts: M to toggle read, R to open reader panel, Shift+D to switch to editor mode.'
          : 'Available shortcuts: M to toggle read, R to open reader panel.'}
      </div>

      {/* Breadcrumb navigation */}
      <ItemBreadcrumb
        isQAPair={isQAPair}
        primaryDomain={item.primary_domain}
        title={title}
      />

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Main content */}
        <article className="min-w-0 flex-1" aria-label={item.title ?? 'Untitled'}>
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

          {/* Clean title — no editing banner, no edit affordances */}
          <div className="mb-2">
            <h1 className="text-fluid-xl font-bold leading-tight break-words">{title}</h1>
            {/* Metadata strip — freshness, verification, and source at a glance */}
            <div className="mt-2 flex flex-wrap items-center gap-3" role="group" aria-label="Content metadata">
              {item.freshness && (
                <FreshnessBadge freshness={item.freshness as string} />
              )}
              <VerificationBadge
                verified={!!item.verified_at}
                verifiedAt={item.verified_at}
                size="md"
                showLabel={true}
                showDetailedTrust={false}
                liveRegion={false}
              />
              {item.updated_at && (
                <span className="text-xs text-muted-foreground">
                  Updated {new Date(item.updated_at).toLocaleDateString('en-GB')}
                </span>
              )}
              {item.source_document && (
                <span className="text-xs text-muted-foreground">
                  Source: <span className="font-medium text-foreground/80">{item.source_document}</span>
                </span>
              )}
            </div>
          </div>

          {/* Minimal action bar — read, copy, overflow only */}
          <div className="mb-6 flex flex-wrap items-center gap-2 py-2" role="toolbar" aria-label="Content actions">
            {detailModeToggle}
            <ReadToggleButton itemId={item.id as string} />
            {isQAPair ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Copy className="size-3.5" aria-hidden="true" />
                    Copy answer
                    <ChevronDown className="size-3" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {item.answer_standard && (
                    <DropdownMenuItem onClick={() => handleCopyAnswer('standard')}>
                      Copy Standard
                    </DropdownMenuItem>
                  )}
                  {item.answer_advanced && (
                    <DropdownMenuItem onClick={() => handleCopyAnswer('advanced')}>
                      Copy Advanced
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => handleCopyAnswer()}>
                    Copy All
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => handleCopyAnswer()}
                aria-label="Copy content to clipboard"
              >
                <Copy className="size-3.5" aria-hidden="true" />
                Copy content
              </Button>
            )}

            {/* Overflow menu — reader actions only */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="size-9 p-0" aria-label="More actions">
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {hasReaderContent && (
                  <DropdownMenuItem onClick={toggleReader}>
                    <BookOpen className="size-4" aria-hidden="true" />
                    {readerOpen ? 'Close Reader' : 'Open Reader'}
                  </DropdownMenuItem>
                )}
                {item.source_url && (
                  <DropdownMenuItem onClick={() => window.open(item.source_url as string, '_blank')}>
                    <ExternalLink className="size-4" aria-hidden="true" />
                    Open original
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleCopyLink}>
                  <Copy className="size-4" aria-hidden="true" />
                  {copied ? 'Copied!' : 'Copy link'}
                </DropdownMenuItem>
                {item.content_type === 'pdf' && (item.source_url || item.file_path) && (
                  <DropdownMenuItem onClick={() => {
                    const btn = document.querySelector<HTMLButtonElement>('[data-pdf-trigger]');
                    btn?.click();
                  }}>
                    <FileText className="size-4" aria-hidden="true" />
                    View PDF
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Hidden PDF trigger */}
            {item.content_type === 'pdf' && (item.source_url || item.file_path) && (
              <div className="hidden">
                <PdfViewer
                  sourceUrl={item.source_url ?? undefined}
                  filePath={item.file_path ?? undefined}
                  title={title}
                />
              </div>
            )}
          </div>

          {/* Content — reader-optimised (no edit controls, no source toggle, no AI messaging) */}
          <section aria-label="Content">
            {/* Content-type specific header */}
            <ContentTypeHeader
              contentType={item.content_type}
              platform={item.platform}
              metadata={item.metadata}
              sourceUrl={item.source_url}
              authorName={item.author_name}
            />

            {/* Content display — Q&A pair gets dedicated layout, others get tabs */}
            {isQAPair ? (
              <QAAnswerDisplay
                item={item}
                isEditing={false}
                editStandard=""
                editAdvanced=""
                setEditStandard={() => {}}
                setEditAdvanced={() => {}}
                setEditDirty={() => {}}
                handleCopyAnswer={handleCopyAnswer}
              />
            ) : (
              contentTabsElement
            )}

            {/* Table of Contents (not shown for Q&A pairs) */}
            {!isQAPair && (
              <TableOfContents content={getActiveTabContent()} className="mb-6" />
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
          </section>

          {/* Q&A provenance: bids using this pair */}
          {isQAPair && (
            <QAUsedInBids workspaces={usedInWorkspaces} />
          )}

          {/* Q&A related pairs from the same source document */}
          {isQAPair && (
            <QARelatedPairs relatedQA={relatedQA} />
          )}

          {/* Content effectiveness — win rate feedback loop */}
          <ContentEffectivenessPanel
            contentItemId={item.id}
            className="mt-6"
          />

          {/* Relationships group (collapsed by default) */}
          <CollapsibleSection title="Relationships" defaultOpen={false} lazy className="mt-6" contentClassName="mt-2 rounded-xl border border-border bg-card p-6">
            {/* Entity mentions — shows badges grouped by entity type */}
            <EntityBadges
              contentItemId={item.id}
              className="mb-6"
            />

            {/* Version history (read-only) */}
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

        {/* Metadata sidebar — read-only (no pencil icons, no edit affordances) */}
        <CollapsibleSection title="Metadata" defaultOpen={!isMobile} className="w-full max-w-md shrink-0 lg:max-w-none lg:w-72" contentClassName="mt-2 rounded-xl border border-border bg-card p-4">
          <MetadataSidebar
            item={item}
            editingField={null}
            editValue=""
            saveSuccess={null}
            startEdit={() => {}}
            saveEdit={async () => {}}
            readOnly={true}
            onOwnerChanged={() => {}}
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
