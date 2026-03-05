'use client';

import { useState } from 'react';
import { Sparkles, CheckCircle2, Loader2, Pencil, X, Check, Bot } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { ContentRenderer } from '@/components/content-renderer';
import { ExternalLink } from 'lucide-react';
import { ReaderView } from '@/components/reader-view';
import { IframeViewer } from '@/components/iframe-viewer';
import { NewsletterReaderCard } from '@/components/reader-cards/newsletter-reader-card';
import { TranscriptReaderCard } from '@/components/reader-cards/transcript-reader-card';
import dynamic from 'next/dynamic';
import type {
  SummaryData,
  TranscriptChapter,
  TranscriptSegment,
  TranscriptHighlight,
} from '@/types/content';

const ContentEditor = dynamic(
  () => import('@/components/content-editor').then((mod) => mod.ContentEditor),
  { ssr: false, loading: () => <div className="h-48 animate-pulse rounded-lg bg-accent" /> },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentTabsEditConfig {
  /** Which field is currently being edited */
  editingField: 'brief' | 'detail' | 'reference' | 'content' | null;
  /** Current edit value (plain text for brief/detail/reference, HTML for content) */
  editValue: string;
  /** Loading state while saving */
  isSaving: boolean;
  /** Start editing a specific field */
  onStartEdit: (field: 'brief' | 'detail' | 'reference' | 'content') => void;
  /** Update the edit value */
  onEditValueChange: (value: string) => void;
  /** Save the current edit */
  onSaveEdit: (field: string) => void;
  /** Cancel the current edit */
  onCancelEdit: () => void;
  // Content-specific options
  regenerateEmbedding?: boolean;
  reclassifyAfterSave?: boolean;
  onRegenerateEmbeddingChange?: (v: boolean) => void;
  onReclassifyChange?: (v: boolean) => void;
}

interface ContentTabsProps {
  itemId: string;
  // AI-generated content
  summaryData: SummaryData | null;
  aiSummary?: string | null;
  // Human-authored progressive depth
  brief?: string | null;
  detail?: string | null;
  reference?: string | null;
  // Canonical content
  content?: string | null;
  contentType: string;
  // Reader-related (preserved from SummaryTabs)
  readerHtml?: string | null;
  hideFullText?: boolean;
  platform?: string | null;
  metadata?: Record<string, unknown> | null;
  authorName?: string | null;
  sourceUrl?: string | null;
  transcriptChapters?: TranscriptChapter[];
  segments?: TranscriptSegment[] | null;
  highlights?: TranscriptHighlight[] | null;
  frameable?: boolean;
  // Editing support (optional — viewer role gets none)
  canEdit?: boolean;
  editConfig?: ContentTabsEditConfig;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateReadingTime(text: string): number {
  const wordCount = text.split(/\s+/).length;
  return Math.ceil(wordCount / 200);
}

/** Small badge to indicate AI-generated content */
function AiBadge() {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-primary/20 bg-primary/5 text-[10px] text-primary/80"
    >
      <Bot className="size-2.5" aria-hidden="true" />
      AI-generated
    </Badge>
  );
}

/** Dual-content toggle (human vs AI) within a tab */
function ContentSourceToggle({
  viewMode,
  onToggle,
}: {
  viewMode: 'human' | 'ai';
  onToggle: (mode: 'human' | 'ai') => void;
}) {
  return (
    <div className="mb-3 flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5 w-fit text-xs">
      <button
        type="button"
        onClick={() => onToggle('human')}
        className={cn(
          'rounded px-2.5 py-1 transition-colors',
          viewMode === 'human'
            ? 'bg-background font-medium shadow-sm text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
        aria-pressed={viewMode === 'human'}
      >
        Human-authored
      </button>
      <button
        type="button"
        onClick={() => onToggle('ai')}
        className={cn(
          'rounded px-2.5 py-1 transition-colors',
          viewMode === 'ai'
            ? 'bg-background font-medium shadow-sm text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
        aria-pressed={viewMode === 'ai'}
      >
        AI version
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContentTabs
// ---------------------------------------------------------------------------

export function ContentTabs({
  itemId,
  summaryData: initialData,
  aiSummary,
  brief,
  detail,
  reference,
  content,
  contentType,
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
  canEdit,
  editConfig,
  className,
}: ContentTabsProps) {
  const [summaryData, setSummaryData] = useState<SummaryData | null>(initialData);
  const [isGenerating, setIsGenerating] = useState(false);

  // Dual-content toggle state (when both human + AI exist for a tab)
  const [briefViewMode, setBriefViewMode] = useState<'human' | 'ai'>('human');
  const [detailViewMode, setDetailViewMode] = useState<'human' | 'ai'>('human');

  const isQAPair = contentType === 'q_a_pair';

  // Tab content availability
  const hasBriefHuman = !!brief;
  const hasBriefAI = !!(summaryData?.executive || aiSummary);
  const hasBrief = hasBriefHuman || hasBriefAI;

  const hasDetailHuman = !!detail;
  const hasDetailAI = !!summaryData?.detailed;
  const hasDetail = hasDetailHuman || hasDetailAI;

  const hasTakeaways =
    !!summaryData?.takeaways && summaryData.takeaways.length > 0;

  const hasFullText = !!content && !hideFullText;
  const hasReference = !!reference;

  // Reader content (preserved from SummaryTabs)
  const isNewsletter = platform === 'email' || contentType === 'newsletter';
  const isTranscript =
    contentType === 'transcript' &&
    !!transcriptChapters &&
    transcriptChapters.length > 0;
  const hasPlatformCard = isNewsletter || isTranscript;
  const canIframe = !!frameable && !!sourceUrl;
  const hasReaderContent =
    !!readerHtml || hasPlatformCard || canIframe || !!sourceUrl;

  // Default tab
  const defaultTab = hasBrief
    ? 'brief'
    : hasFullText
      ? 'fulltext'
      : hasDetail
        ? 'detail'
        : 'brief';

  // Summary generation handler
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

  // Inline edit helpers
  const isEditing = (field: string) => editConfig?.editingField === field;

  function EditButton({ field, label }: { field: 'brief' | 'detail' | 'reference' | 'content'; label?: string }) {
    if (!canEdit || !editConfig || isEditing(field)) return null;
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editConfig.onStartEdit(field)}
        className="gap-1.5 text-xs"
      >
        <Pencil className="size-3" aria-hidden="true" />
        {label ?? 'Edit'}
      </Button>
    );
  }

  function InlineTextEditor({ field }: { field: 'brief' | 'detail' | 'reference' }) {
    if (!editConfig || !isEditing(field)) return null;
    return (
      <div className="space-y-2">
        <textarea
          value={editConfig.editValue}
          onChange={(e) => editConfig.onEditValueChange(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          rows={6}
          autoFocus
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => editConfig.onSaveEdit(field)}
            disabled={editConfig.isSaving}
          >
            {editConfig.isSaving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" onClick={editConfig.onCancelEdit}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  function InlineContentEditor() {
    if (!editConfig || !isEditing('content')) return null;
    return (
      <div className="space-y-3">
        <ContentEditor
          content={editConfig.editValue}
          onChange={editConfig.onEditValueChange}
          placeholder={isQAPair ? 'Write the answer…' : 'Edit content…'}
          minHeight="200px"
        />
        <div className="flex flex-wrap items-center gap-4">
          {editConfig.onRegenerateEmbeddingChange && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={editConfig.regenerateEmbedding ?? false}
                onChange={(e) =>
                  editConfig.onRegenerateEmbeddingChange!(e.target.checked)
                }
                className="accent-primary"
              />
              Re-generate embedding
            </label>
          )}
          {editConfig.onReclassifyChange && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={editConfig.reclassifyAfterSave ?? false}
                onChange={(e) =>
                  editConfig.onReclassifyChange!(e.target.checked)
                }
                className="accent-primary"
              />
              Re-classify after save
            </label>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => editConfig.onSaveEdit('content')}
            disabled={editConfig.isSaving}
          >
            {editConfig.isSaving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" onClick={editConfig.onCancelEdit}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // --- Reader tab rendering (unchanged from SummaryTabs) ---
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

  // --- Generating state ---
  if (isGenerating) {
    return (
      <div className={cn('rounded-xl border border-border bg-card p-6', className)}>
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Generating summary…</span>
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

  // --- Tabs render ---
  return (
    <div className={cn('rounded-xl border border-border bg-card', className)}>
      <Tabs defaultValue={defaultTab} className="gap-0">
        <TabsList className="w-full justify-start rounded-b-none border-b border-border bg-muted/50 px-1 flex-wrap">
          {hasBrief && (
            <TabsTrigger value="brief" className="min-h-[44px] px-4 text-sm">
              Sales Brief
            </TabsTrigger>
          )}
          {hasDetail && (
            <TabsTrigger value="detail" className="min-h-[44px] px-4 text-sm">
              Bid Detail
            </TabsTrigger>
          )}
          {hasTakeaways && (
            <TabsTrigger value="takeaways" className="min-h-[44px] px-4 text-sm">
              Takeaways
            </TabsTrigger>
          )}
          {hasFullText && (
            <TabsTrigger value="fulltext" className="min-h-[44px] px-4 text-sm">
              {isQAPair ? 'Full Answer' : 'Full Text'}
            </TabsTrigger>
          )}
          {hasReaderContent && (
            <TabsTrigger value="reader" className="min-h-[44px] px-4 text-sm">
              Reader
            </TabsTrigger>
          )}
          {hasReference && (
            <TabsTrigger value="reference" className="min-h-[44px] px-4 text-sm">
              Reference
            </TabsTrigger>
          )}
          {/* Fallback: no content yet — show disabled placeholders */}
          {!hasBrief && !hasFullText && !hasDetail && (
            <>
              <TabsTrigger value="brief" className="min-h-[44px] px-4 text-sm">
                Sales Brief
              </TabsTrigger>
              <TabsTrigger value="detail" className="min-h-[44px] px-4 text-sm" disabled>
                Bid Detail
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* --- Sales Brief tab --- */}
        {(hasBrief || (!hasBrief && !hasFullText && !hasDetail)) && (
          <TabsContent value="brief" className="p-4">
            {isEditing('brief') ? (
              <InlineTextEditor field="brief" />
            ) : (
              <>
                {hasBriefHuman && hasBriefAI && (
                  <ContentSourceToggle
                    viewMode={briefViewMode}
                    onToggle={setBriefViewMode}
                  />
                )}
                {hasBriefHuman && briefViewMode === 'human' ? (
                  <>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground" />
                      <EditButton field="brief" label={brief ? 'Edit' : 'Write Sales Brief'} />
                    </div>
                    <ContentRenderer content={brief!} />
                  </>
                ) : hasBriefAI && (briefViewMode === 'ai' || !hasBriefHuman) ? (
                  <>
                    <div className="mb-2 flex items-center justify-between">
                      <AiBadge />
                      <EditButton field="brief" label="Write Sales Brief" />
                    </div>
                    {!hasBriefHuman && (
                      <p className="mb-3 text-xs text-muted-foreground">
                        AI-generated — author a Sales Brief to replace
                      </p>
                    )}
                    <p className="text-base leading-relaxed text-foreground">
                      {summaryData?.executive ?? aiSummary}
                    </p>
                  </>
                ) : (
                  // Empty state
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      No sales brief yet for this item.
                    </p>
                    {canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleGenerate}
                        className="gap-1.5"
                      >
                        <Sparkles className="size-3.5" aria-hidden="true" />
                        Generate AI summary
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </TabsContent>
        )}

        {/* --- Bid Detail tab --- */}
        {hasDetail && (
          <TabsContent value="detail" className="p-4">
            {isEditing('detail') ? (
              <InlineTextEditor field="detail" />
            ) : (
              <>
                {hasDetailHuman && hasDetailAI && (
                  <ContentSourceToggle
                    viewMode={detailViewMode}
                    onToggle={setDetailViewMode}
                  />
                )}
                {hasDetailHuman && detailViewMode === 'human' ? (
                  <>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground" />
                      <EditButton field="detail" />
                    </div>
                    <ContentRenderer content={detail!} />
                  </>
                ) : hasDetailAI && (detailViewMode === 'ai' || !hasDetailHuman) ? (
                  <>
                    <div className="mb-2 flex items-center justify-between">
                      <AiBadge />
                      <EditButton field="detail" label="Write Bid Detail" />
                    </div>
                    {!hasDetailHuman && (
                      <p className="mb-3 text-xs text-muted-foreground">
                        AI-generated — author Bid Detail to replace
                      </p>
                    )}
                    <ContentRenderer content={summaryData!.detailed} />
                  </>
                ) : null}
              </>
            )}
          </TabsContent>
        )}

        {/* --- Takeaways tab --- */}
        {hasTakeaways && (
          <TabsContent value="takeaways" className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <AiBadge />
            </div>
            <ul className="space-y-2.5">
              {summaryData!.takeaways.map((takeaway, i) => (
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
        )}

        {/* --- Full Text / Full Answer tab --- */}
        {hasFullText && (
          <TabsContent value="fulltext" className="p-4">
            {isEditing('content') ? (
              <InlineContentEditor />
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    ~{estimateReadingTime(content!)} min read
                  </p>
                  <EditButton field="content" />
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  <ContentRenderer content={content!} />
                </div>
              </>
            )}
          </TabsContent>
        )}

        {/* --- Reader tab --- */}
        {renderReader()}

        {/* --- Reference tab --- */}
        {hasReference && (
          <TabsContent value="reference" className="p-4">
            {isEditing('reference') ? (
              <InlineTextEditor field="reference" />
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground" />
                  <EditButton field="reference" />
                </div>
                <ContentRenderer content={reference!} />
              </>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* Footer: AI model info + generate button */}
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        {summaryData ? (
          <p className="text-xs text-muted-foreground">
            Generated by {summaryData.model} on {formatDate(summaryData.generated_at)}
          </p>
        ) : (
          <span />
        )}
        {canEdit && !summaryData && (
          <Button
            onClick={handleGenerate}
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            Generate AI summary
          </Button>
        )}
      </div>
    </div>
  );
}
