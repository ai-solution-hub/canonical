'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { isFeatureEnabled } from '@/lib/client-config';
import { cn } from '@/lib/utils';
import { ContentTypeHeader } from '@/components/shared/content-type-header';

import { ContentLayerSelector } from '@/components/content/content-layer-selector';
import { TableOfContents } from '@/components/item-detail/table-of-contents';
import { TranscriptReader } from '@/components/reader/transcript-reader';
import { ToggleLeft, ToggleRight, Loader2 } from 'lucide-react';

import type { ItemData } from '@/app/item/[id]/item-detail-client';
import type { VisionAnalysisResult } from '@/hooks/use-vision-analysis';
import type {
  TranscriptChapter,
  TranscriptSegment,
  TranscriptHighlight,
} from '@/types/content';

const ImageGallery = dynamic(
  () =>
    import('@/components/reader/image-gallery').then((mod) => mod.ImageGallery),
  {
    ssr: false,
    loading: () => <div className="h-32 animate-pulse rounded-lg bg-accent" />,
  },
);

export interface ContentBodyProps {
  item: ItemData;
  setItem: React.Dispatch<React.SetStateAction<ItemData>>;
  isQAPair: boolean;
  canEdit: boolean;
  /** The content tabs element (rendered by parent, varies by Q&A vs regular) */
  contentTabsElement: React.ReactNode;
  /** Q&A answer display element (rendered by parent for Q&A items) */
  qaAnswerElement?: React.ReactNode;
  /** Vision analysis */
  visionAnalysis: VisionAnalysisResult | undefined;
  /** Transcript data */
  transcriptChapters: TranscriptChapter[] | undefined;
  segments: TranscriptSegment[] | null;
  highlights: TranscriptHighlight[] | null;
  /** Content layer change handler */
  handleLayerChange: (newLayer: string | null) => Promise<void>;
  /** Active tab content getter for table of contents */
  getActiveTabContent: () => string;
  /** Inline field save callback -- used by DraftToggle to route through PATCH */
  saveEdit?: (
    field: string,
    value: unknown,
    changeReason?: string | null,
  ) => Promise<void>;
}

/**
 * The main content body within the item detail page.
 * Contains content type header, AI processing indicators, content display,
 * vision analysis, image gallery, transcript reader, draft toggle,
 * and table of contents.
 */
export function ContentBody({
  item,
  setItem,
  isQAPair,
  canEdit,
  contentTabsElement,
  qaAnswerElement,
  visionAnalysis,
  transcriptChapters,
  segments,
  highlights,
  handleLayerChange,
  getActiveTabContent,
  saveEdit,
}: ContentBodyProps) {
  return (
    <>
      {/* Content-type specific header */}
      <ContentTypeHeader
        contentType={item.content_type}
        platform={item.platform}
        metadata={item.metadata}
        sourceUrl={item.source_url}
        authorName={item.author_name}
      />


      {/* Content display — Q&A pair gets dedicated layout, others get tabs */}
      {isQAPair && qaAnswerElement ? qaAnswerElement : contentTabsElement}

      {/* Table of Contents (not shown for Q&A pairs) */}
      {!isQAPair && (
        <TableOfContents content={getActiveTabContent()} className="mb-6" />
      )}

      {/* Vision analysis (PDF items) */}
      {visionAnalysis && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold">Visual Analysis</h2>
          <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {visionAnalysis.analysis}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Analysed{' '}
            {new Date(visionAnalysis.analysed_at).toLocaleDateString('en-GB')}
          </p>
        </section>
      )}

      {/* Extracted images gallery (PDF items) */}
      {item.content_type === 'pdf' && (item.file_path || item.source_url) && (
        <ImageGallery
          itemId={item.id}
          hasExtractedImages={Array.isArray(
            (item.metadata as Record<string, unknown> | null)?.extracted_images,
          )}
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
        <DraftToggle item={item} setItem={setItem} saveEdit={saveEdit} />
      )}
    </>
  );
}

/**
 * Draft status toggle -- routes through the PATCH /api/items/:id endpoint
 * via `saveEdit('governance_review_status', ...)` so the change gets:
 *   - content_history audit trail
 *   - governance checks
 *   - embedding regeneration on publish
 */
function DraftToggle({
  item,
  setItem,
  saveEdit,
}: {
  item: ItemData;
  setItem: React.Dispatch<React.SetStateAction<ItemData>>;
  saveEdit?: (
    field: string,
    value: unknown,
    changeReason?: string | null,
  ) => Promise<void>;
}) {
  const [isSaving, setIsSaving] = React.useState(false);

  return (
    <section className="mb-6 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Status
        </h3>
        <button
          type="button"
          disabled={isSaving}
          onClick={async () => {
            const isDraft = item.governance_review_status === 'draft';
            const newStatus = isDraft ? null : 'draft';

            if (saveEdit) {
              // Route through PATCH for audit trail + embedding regen on publish
              setIsSaving(true);
              try {
                await saveEdit(
                  'governance_review_status',
                  newStatus,
                  isDraft ? 'Published from draft' : 'Marked as draft',
                );
              } finally {
                setIsSaving(false);
              }
            } else {
              // Fallback: optimistic update only (should not happen in practice)
              setItem((prev) => ({
                ...prev,
                governance_review_status: newStatus,
              }));
            }
          }}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
            isSaving && 'opacity-60 cursor-not-allowed',
            item.governance_review_status === 'draft'
              ? 'border-status-warning bg-quality-moderate-bg text-status-warning hover:bg-freshness-aging-bg'
              : 'border-status-success bg-freshness-fresh-bg text-status-success hover:opacity-85',
          )}
        >
          {isSaving ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Saving…
            </>
          ) : item.governance_review_status === 'draft' ? (
            <>
              <ToggleLeft className="size-4" /> Draft — click to publish
            </>
          ) : (
            <>
              <ToggleRight className="size-4" /> Published — click to draft
            </>
          )}
        </button>
      </div>
    </section>
  );
}
