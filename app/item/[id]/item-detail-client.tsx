'use client';

import { useCallback } from 'react';
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
} from 'react-resizable-panels';
import { FloatingReader } from '@/components/reader/floating-reader';
import { ReaderPanel } from '@/components/reader/reader-panel';
import { ErrorBoundary } from '@/components/shared/error-boundary';

// Hooks
import { useItemDetailData } from '@/hooks/use-item-detail-data';
import { useDetailMode } from '@/hooks/ui/use-detail-mode';
import { useItemDetailShortcuts } from '@/hooks/use-item-detail-shortcuts';

// Views
import { ReaderView } from '@/components/item-detail/reader-view';
import { EditorView } from '@/components/item-detail/editor-view';
import { DetailModeToggle } from '@/components/item-detail/detail-mode-toggle';

import type { ContentListItem, SummaryData } from '@/types/content';
import type { Layout } from 'react-resizable-panels';

export interface ItemData {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content: string | null;
  summary: string | null;
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
  expiry_date?: string | null;
  lifecycle_type?: string | null;
  /** Content layer (promoted from metadata JSONB) */
  layer?: string | null;
  /** Starred flag (promoted from metadata JSONB) */
  starred?: boolean;
  /** Citation count for quality score calculation */
  citation_count?: number | null;
}

export interface ItemDetailClientProps {
  item: ItemData;
  relatedItems: Array<ContentListItem & { similarity: number }>;
}

export function ItemDetailClient({
  item: initialItem,
  relatedItems,
}: ItemDetailClientProps) {
  // All data, state, and mutations extracted into shared hook
  const data = useItemDetailData({ initialItem, relatedItems });

  // Reader/editor mode management
  const { detailMode, toggleDetailMode, isReaderMode, canToggle } =
    useDetailMode({
      canEdit: data.canEdit,
    });

  // Unsaved changes guard: block mode switch while editing
  const handleModeToggle = useCallback(() => {
    if (data.inlineEdit.editingField) {
      if (
        !window.confirm(
          'You have unsaved changes. Discard and switch to reader mode?',
        )
      ) {
        return;
      }
      data.inlineEdit.cancelEdit();
    }
    toggleDetailMode();
  }, [data.inlineEdit, toggleDetailMode]);

  // Keyboard shortcuts — mode-aware (disables edit shortcuts in reader mode)
  useItemDetailShortcuts({
    itemId: data.item.id,
    toggleRead: data.toggleRead,
    handleStarToggle: data.handleStarToggle,
    handlePriorityCycle: data.handlePriorityCycle,
    toggleReader: data.toggleReader,
    readerOpen: data.readerOpen,
    toggleDetached: data.toggleDetached,
    canEdit: data.canEdit,
    startEdit: data.startEdit,
    cancelEdit: data.cancelEdit,
    editingField: data.inlineEdit.editingField,
    router: data.router,
    detailMode,
    toggleDetailMode: handleModeToggle,
  });

  const { setPanelLayout } = data;
  const handleLayoutChanged = useCallback(
    (layout: Layout) => {
      setPanelLayout(layout);
    },
    [setPanelLayout],
  );

  // Build the mode toggle element as a slot for both views
  const detailModeToggle = canToggle ? (
    <DetailModeToggle detailMode={detailMode} onToggle={handleModeToggle} />
  ) : undefined;

  // Reader panel props — shared across split and floating reader
  const readerPanelProps = {
    readerHtml: data.item.metadata?.reader_html as string | undefined,
    contentType: data.item.content_type,
    title: data.title,
    fontSize: data.fontSize,
    maxWidth: data.maxWidth,
    onFontSizeChange: data.setFontSize,
    onMaxWidthChange: data.setMaxWidth,
    onClose: () => data.setReaderOpen(false),
    platform: data.item.platform,
    metadata: data.item.metadata,
    authorName: data.item.author_name,
    sourceUrl: data.item.source_url,
    filePath: data.item.file_path,
    content: data.item.content,
    transcriptChapters: data.transcriptChapters,
    segments: data.segments,
    highlights: data.highlights,
    frameable: data.item.metadata?.frameable === true,
    onDetachToggle: data.toggleDetached,
  };

  // Render the active view based on mode
  const viewContent = isReaderMode ? (
    <ReaderView
      data={data}
      relatedItems={relatedItems}
      onModeToggle={handleModeToggle}
      detailModeToggle={detailModeToggle}
    />
  ) : (
    <EditorView
      data={data}
      relatedItems={relatedItems}
      onModeToggle={data.canEdit ? handleModeToggle : undefined}
      detailModeToggle={detailModeToggle}
    />
  );

  return (
    <ErrorBoundary label="Error loading item details">
      <>
        <PanelGroup
          orientation="horizontal"
          onLayoutChanged={handleLayoutChanged}
          defaultLayout={data.showSplitReader ? data.panelLayout : undefined}
          className="min-h-[calc(100vh-4rem)]"
        >
          <Panel
            id="detail"
            defaultSize={
              data.showSplitReader
                ? `${data.panelLayout.detail ?? 55}%`
                : '100%'
            }
            minSize="30%"
          >
            <div className="mx-auto max-w-7xl overflow-y-auto px-4 py-6 sm:px-6">
              {viewContent}
            </div>
          </Panel>
          {data.showSplitReader && (
            <>
              <PanelResizeHandle
                aria-label="Resize panels"
                className="w-1.5 bg-border transition-colors hover:bg-primary/20 data-[active]:bg-primary/30"
              />
              <Panel
                id="reader"
                defaultSize={`${data.panelLayout.reader ?? 45}%`}
                minSize="25%"
              >
                <div className="h-full border-l border-border bg-card">
                  <ReaderPanel {...readerPanelProps} isDetached={false} />
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
        {data.readerOpen && data.isDetached && (
          <FloatingReader
            readerHtml={data.item.metadata?.reader_html as string | undefined}
            contentType={data.item.content_type}
            title={data.title}
            fontSize={data.fontSize}
            maxWidth={data.maxWidth}
            onFontSizeChange={data.setFontSize}
            onMaxWidthChange={data.setMaxWidth}
            onClose={() => data.setReaderOpen(false)}
            onDock={data.toggleDetached}
            position={data.detachedPosition}
            size={data.detachedSize}
            onPositionChange={data.setDetachedPosition}
            onSizeChange={data.setDetachedSize}
            platform={data.item.platform}
            metadata={data.item.metadata}
            authorName={data.item.author_name}
            sourceUrl={data.item.source_url}
            filePath={data.item.file_path}
            content={data.item.content}
            transcriptChapters={data.transcriptChapters}
            segments={data.segments}
            highlights={data.highlights}
          />
        )}
      </>
    </ErrorBoundary>
  );
}
