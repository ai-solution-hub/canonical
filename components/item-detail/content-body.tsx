'use client';

import dynamic from 'next/dynamic';
import { isFeatureEnabled } from '@/lib/client-config';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { ContentTypeHeader } from '@/components/content-type-header';
import { AiProcessingIndicators } from '@/components/ai-processing-indicators';
import { QAAnswerDisplay } from '@/components/qa-answer-display';
import { ContentLayerSelector } from '@/components/content-layer-selector';
import { TableOfContents } from '@/components/table-of-contents';
import { TranscriptReader } from '@/components/transcript-reader';
import { toast } from 'sonner';

import type { ItemData } from '@/app/item/[id]/item-detail-client';
import type { VisionAnalysisResult } from '@/hooks/use-vision-analysis';
import type {
  TranscriptChapter,
  TranscriptSegment,
  TranscriptHighlight,
} from '@/types/content';

const ImageGallery = dynamic(
  () => import('@/components/image-gallery').then((mod) => mod.ImageGallery),
  { ssr: false, loading: () => <div className="h-32 animate-pulse rounded-lg bg-accent" /> },
);

export interface ContentBodyProps {
  item: ItemData;
  setItem: React.Dispatch<React.SetStateAction<ItemData>>;
  isQAPair: boolean;
  canEdit: boolean;
  /** The content tabs element (rendered by parent, varies by Q&A vs regular) */
  contentTabsElement: React.ReactNode;
  /** Q&A edit mode props */
  isEditing: boolean;
  editStandard: string;
  editAdvanced: string;
  setEditStandard: React.Dispatch<React.SetStateAction<string>>;
  setEditAdvanced: React.Dispatch<React.SetStateAction<string>>;
  setEditDirty: React.Dispatch<React.SetStateAction<boolean>>;
  handleCopyAnswer: (variant?: 'standard' | 'advanced') => void;
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
  isEditing,
  editStandard,
  editAdvanced,
  setEditStandard,
  setEditAdvanced,
  setEditDirty,
  handleCopyAnswer,
  visionAnalysis,
  transcriptChapters,
  segments,
  highlights,
  handleLayerChange,
  getActiveTabContent,
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
        <DraftToggle item={item} setItem={setItem} />
      )}
    </>
  );
}

/** Draft status toggle — extracted for clarity. */
function DraftToggle({
  item,
  setItem,
}: {
  item: ItemData;
  setItem: React.Dispatch<React.SetStateAction<ItemData>>;
}) {
  return (
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
  );
}
