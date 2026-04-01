'use client';

import { useState } from 'react';
import { FileText, RefreshCw, CheckCircle2, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { ContentRenderer } from '@/components/item-detail/content-renderer';
import { ExternalLink } from 'lucide-react';
import { ReaderView } from '@/components/reader/reader-view';
import { IframeViewer } from '@/components/reader/iframe-viewer';
import { NewsletterReaderCard } from '@/components/reader-cards/newsletter-reader-card';
import { TranscriptReaderCard } from '@/components/reader-cards/transcript-reader-card';
import type {
  SummaryData,
  TranscriptChapter,
  TranscriptSegment,
  TranscriptHighlight,
} from '@/types/content';

interface SummaryTabsProps {
  itemId: string;
  summaryData: SummaryData | null;
  contentType: string;
  content?: string | null;
  aiSummary?: string | null;
  /** Clean reader HTML from Readability extraction or newsletter body */
  readerHtml?: string | null;
  /** Hide the Full Text tab (e.g. when a chaptered TranscriptReader is shown instead) */
  hideFullText?: boolean;
  /** Platform of the content item (e.g. web, email, upload, manual) */
  platform?: string | null;
  /** Full metadata JSONB from the content item */
  metadata?: Record<string, unknown> | null;
  /** Author name for platform-specific reader cards */
  authorName?: string | null;
  /** Source URL for transcript reader card links */
  sourceUrl?: string | null;
  /** Transcript chapters for transcript reader card */
  transcriptChapters?: TranscriptChapter[];
  /** Transcript segments for transcript reader card */
  segments?: TranscriptSegment[] | null;
  /** Transcript highlights for transcript reader card */
  highlights?: TranscriptHighlight[] | null;
  /** Whether the source URL can be embedded in an iframe */
  frameable?: boolean;
  /** Q&A pair mode — shows "Full Answer" instead of "Full Text" */
  qaMode?: boolean;
  /** Unified edit mode — when true, active tab shows editor */
  isEditing?: boolean;
  /** Called when any editable content changes in edit mode */
  onDirty?: () => void;
  className?: string;
}

function estimateReadingTime(text: string): number {
  const wordCount = text.split(/\s+/).length;
  return Math.ceil(wordCount / 200);
}

export function SummaryTabs({
  itemId,
  summaryData: initialData,
  contentType,
  content,
  aiSummary,
  readerHtml,
  hideFullText,
  platform,
  metadata,
  authorName,
  sourceUrl,
  transcriptChapters,
  segments,
  highlights,
  frameable,
  qaMode,
  className,
}: SummaryTabsProps) {
  const fullTextLabel = qaMode ? 'Full Answer' : 'Full Text';
  const [summaryData, setSummaryData] = useState<SummaryData | null>(
    initialData,
  );
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/summaries/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate summary');
      }

      const data = await res.json();
      setSummaryData(data.summary_data);
      toast.success('Summary generated');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to generate summary',
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // Full text rendering helper
  const renderFullText = () => {
    if (!content || hideFullText) return null;
    return (
      <TabsContent value="fulltext" className="p-4">
        <div className="mb-3 text-xs text-muted-foreground">
          ~{estimateReadingTime(content)} min read
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <ContentRenderer content={content} />
        </div>
      </TabsContent>
    );
  };

  // Determine if a platform-specific reader card should be shown
  const isNewsletter = platform === 'email' || contentType === 'newsletter';
  const isTranscript =
    contentType === 'transcript' &&
    !!transcriptChapters &&
    transcriptChapters.length > 0;
  const hasPlatformCard =
    isNewsletter || isTranscript;
  const canIframe = !!frameable && !!sourceUrl;
  const hasReaderContent = !!readerHtml || hasPlatformCard || canIframe || !!sourceUrl;

  // Reader rendering helper — dispatches to platform-specific cards, generic ReaderView, iframe fallback, or "open in new tab"
  const renderReader = () => {
    if (!hasReaderContent) return null;
    return (
      <TabsContent value="reader" className="p-4">
        <div className="max-h-[60vh] overflow-y-auto">
          {isNewsletter ? (
            <NewsletterReaderCard
              content={content ?? null}
              readerHtml={readerHtml}
              metadata={metadata ?? null}
            />
          ) : isTranscript && content ? (
            <TranscriptReaderCard
              content={content}
              chapters={transcriptChapters!}
              segments={segments ?? undefined}
              highlights={highlights ?? undefined}
              metadata={metadata ?? null}
              authorName={authorName ?? null}
              sourceUrl={sourceUrl ?? null}
            />
          ) : readerHtml ? (
            <ReaderView html={readerHtml} />
          ) : canIframe ? (
            <IframeViewer src={sourceUrl!} title="Content preview" />
          ) : sourceUrl ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Reader view is not available for this content.
              </p>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
              >
                Open in new tab
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          ) : null}
        </div>
      </TabsContent>
    );
  };

  // Loading state
  if (isGenerating) {
    return (
      <div
        className={cn('rounded-xl border bg-card p-6', className)}
      >
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Generating summary...</span>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  // No summary data but content exists: show Full Text tab with generate prompt
  // If aiSummary exists from classification, show it in the Quick tab as fallback
  if (!summaryData && content) {
    const hasQuickFallback = !!aiSummary;
    return (
      <div className={cn('rounded-xl border bg-card', className)}>
        <Tabs defaultValue={hasQuickFallback ? 'quick' : 'fulltext'} className="gap-0">
          <TabsList className="w-full justify-start rounded-b-none border-b border-border bg-muted/50 px-1">
            <TabsTrigger
              value="quick"
              className="min-h-[44px] px-4 text-sm"
              disabled={!hasQuickFallback}
            >
              Quick
            </TabsTrigger>
            <TabsTrigger
              value="detailed"
              className="min-h-[44px] px-4 text-sm"
              disabled
            >
              Detailed
            </TabsTrigger>
            <TabsTrigger
              value="takeaways"
              className="min-h-[44px] px-4 text-sm"
              disabled
            >
              Takeaways
            </TabsTrigger>
            {!hideFullText && (
              <TabsTrigger value="fulltext" className="min-h-[44px] px-4 text-sm">
                {fullTextLabel}
              </TabsTrigger>
            )}
            {hasReaderContent && (
              <TabsTrigger value="reader" className="min-h-[44px] px-4 text-sm">
                Reader
              </TabsTrigger>
            )}
          </TabsList>
          {hasQuickFallback && (
            <TabsContent value="quick" className="p-4">
              <p className="text-base leading-relaxed text-foreground">
                {aiSummary}
              </p>
            </TabsContent>
          )}
          {renderFullText()}
          {renderReader()}
        </Tabs>
        <div className="border-t border-border px-4 py-3">
          <Button
            onClick={handleGenerate}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <RefreshCw className="size-3.5" />
            Generate summary
          </Button>
        </div>
      </div>
    );
  }

  // Empty state — no summary, no content — offer to generate
  if (!summaryData) {
    return (
      <div
        className={cn(
          'rounded-xl border border-dashed border-border bg-card/50 p-6',
          className,
        )}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <FileText className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No summary generated yet for this {contentType || 'item'}.
          </p>
          <Button
            onClick={handleGenerate}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <RefreshCw className="size-3.5" />
            Generate summary
          </Button>
        </div>
      </div>
    );
  }

  const executive = summaryData.executive ?? '';

  // Summary tabs with all data
  return (
    <div className={cn('rounded-xl border bg-card', className)}>
      <Tabs defaultValue="quick" className="gap-0">
        <TabsList className="w-full justify-start rounded-b-none border-b border-border bg-muted/50 px-1">
          <TabsTrigger value="quick" className="min-h-[44px] px-4 text-sm">
            Quick
          </TabsTrigger>
          <TabsTrigger value="detailed" className="min-h-[44px] px-4 text-sm">
            Detailed
          </TabsTrigger>
          <TabsTrigger value="takeaways" className="min-h-[44px] px-4 text-sm">
            Takeaways
          </TabsTrigger>
          {content && !hideFullText && (
            <TabsTrigger value="fulltext" className="min-h-[44px] px-4 text-sm">
              {fullTextLabel}
            </TabsTrigger>
          )}
          {hasReaderContent && (
            <TabsTrigger value="reader" className="min-h-[44px] px-4 text-sm">
              Reader
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="quick" className="p-4">
          <p className="text-base leading-relaxed text-foreground">
            {executive}
          </p>
        </TabsContent>

        <TabsContent value="detailed" className="p-4">
          <ContentRenderer content={summaryData.detailed} />
        </TabsContent>

        <TabsContent value="takeaways" className="p-4">
          <ul className="space-y-2.5">
            {summaryData.takeaways.map((takeaway, i) => (
              <li
                key={i}
                className="flex gap-2.5 text-base leading-relaxed text-foreground"
              >
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--success)]" />
                <span>{takeaway}</span>
              </li>
            ))}
          </ul>
        </TabsContent>

        {renderFullText()}
        {renderReader()}
      </Tabs>

      {/* Metadata footer */}
      <div className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        Last updated {formatDate(summaryData.generated_at)}
        {summaryData.tokens_used != null && (
          <> &middot; ~{Math.round(summaryData.tokens_used / 1.3).toLocaleString('en-GB')} words analysed</>
        )}
      </div>
    </div>
  );
}
