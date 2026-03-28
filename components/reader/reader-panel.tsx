'use client';

import { X, BookOpen, FileText, ExternalLink, Maximize2, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReaderView } from '@/components/reader/reader-view';
import { IframeViewer } from '@/components/reader/iframe-viewer';
import dynamic from 'next/dynamic';

const PdfReaderView = dynamic(
  () => import('@/components/reader/pdf-reader-view').then((mod) => mod.PdfReaderView),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center"><div className="h-8 w-32 animate-pulse rounded bg-accent" /></div> },
);
import { NewsletterReaderCard } from '@/components/reader-cards/newsletter-reader-card';
import { TranscriptReaderCard } from '@/components/reader-cards/transcript-reader-card';
import { cn } from '@/lib/utils';
import type {
  ReaderFontSize,
  ReaderMaxWidth,
} from '@/hooks/ui/use-reader-preferences';
import type {
  TranscriptChapter,
  TranscriptSegment,
  TranscriptHighlight,
} from '@/types/content';

interface ReaderPanelProps {
  readerHtml: string | null | undefined;
  contentType: string | null;
  title: string;
  fontSize: ReaderFontSize;
  maxWidth: ReaderMaxWidth;
  onFontSizeChange: (size: ReaderFontSize) => void;
  onMaxWidthChange: (width: ReaderMaxWidth) => void;
  onClose: () => void;
  /** Platform of the content item */
  platform?: string | null;
  /** Full metadata JSONB */
  metadata?: Record<string, unknown> | null;
  /** Author name for platform-specific reader cards */
  authorName?: string | null;
  /** Source URL for transcript reader card */
  sourceUrl?: string | null;
  /** Content text for platform-specific reader cards */
  content?: string | null;
  /** Transcript chapters */
  transcriptChapters?: TranscriptChapter[];
  /** Transcript segments */
  segments?: TranscriptSegment[] | null;
  /** Transcript highlights */
  highlights?: TranscriptHighlight[] | null;
  /** Supabase Storage path for uploaded files */
  filePath?: string | null;
  /** Whether the source URL can be embedded in an iframe */
  frameable?: boolean;
  /** Called when detach/dock button is clicked */
  onDetachToggle?: () => void;
  /** Whether the reader is currently in detached (floating) mode */
  isDetached?: boolean;
  /** Hide the close button (used in floating mode where the container has its own close) */
  hideCloseButton?: boolean;
}

const FONT_SIZES: { value: ReaderFontSize; label: string }[] = [
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
];

const MAX_WIDTHS: { value: ReaderMaxWidth; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
];

function getEmptyStateMessage(contentType: string | null): {
  icon: React.ReactNode;
  message: string;
} {
  switch (contentType) {
    case 'pdf':
      return {
        icon: <FileText className="size-8 text-muted-foreground" />,
        message: 'Use the PDF viewer for this document.',
      };
    default:
      return {
        icon: <BookOpen className="size-8 text-muted-foreground" />,
        message: 'Reader view has not been processed for this content yet.',
      };
  }
}

export function ReaderPanel({
  readerHtml,
  contentType,
  title,
  fontSize,
  maxWidth,
  onFontSizeChange,
  onMaxWidthChange,
  onClose,
  platform,
  metadata,
  authorName,
  sourceUrl,
  content,
  transcriptChapters,
  segments,
  highlights,
  filePath,
  frameable,
  onDetachToggle,
  isDetached,
  hideCloseButton,
}: ReaderPanelProps) {
  // Determine if a platform-specific reader card should be shown
  const isNewsletter = platform === 'email' || contentType === 'newsletter';
  const isTranscript =
    contentType === 'transcript' &&
    !!transcriptChapters &&
    transcriptChapters.length > 0;
  const isPdf = contentType === 'pdf' && !!(sourceUrl || filePath);
  const hasPlatformCard =
    isNewsletter || isTranscript || isPdf;
  const canIframe = !!frameable && !!sourceUrl;
  const hasReaderContent = !!readerHtml || hasPlatformCard || canIframe || !!sourceUrl;

  if (!hasReaderContent) {
    const { icon, message } = getEmptyStateMessage(contentType);
    return (
      <div className="flex h-full flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium text-muted-foreground">
            Reader
          </span>
          <div className="flex items-center gap-1">
            {onDetachToggle && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDetachToggle}
                aria-label={isDetached ? 'Dock to split view (Shift+R)' : 'Pop out to floating window (Shift+R)'}
                title={isDetached ? 'Dock to split view (Shift+R)' : 'Pop out (Shift+R)'}
                className="hidden md:inline-flex"
              >
                {isDetached ? <PanelRightClose className="size-4" /> : <Maximize2 className="size-4" />}
              </Button>
            )}
            {!hideCloseButton && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label="Close reader"
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        </div>
        {/* Empty state */}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          {icon}
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    );
  }

  // Render platform-specific reader card content
  const renderPlatformContent = () => {
    if (isNewsletter) {
      return (
        <NewsletterReaderCard
          content={content ?? null}
          readerHtml={readerHtml}
          metadata={metadata ?? null}
          fontSize={fontSize}
          maxWidth={maxWidth}
        />
      );
    }
    if (isTranscript && content) {
      return (
        <TranscriptReaderCard
          content={content}
          chapters={transcriptChapters!}
          segments={segments ?? undefined}
          highlights={highlights ?? undefined}
          metadata={metadata ?? null}
          authorName={authorName ?? null}
          sourceUrl={sourceUrl ?? null}
        />
      );
    }
    if (isPdf) {
      return null; // Handled separately — PDF fills the full panel area
    }
    if (readerHtml) {
      return (
        <ReaderView
          html={readerHtml}
          fontSize={fontSize}
          maxWidth={maxWidth}
        />
      );
    }
    if (canIframe) {
      return <IframeViewer src={sourceUrl!} title="Content preview" height="calc(100vh - 8rem)" />;
    }
    if (sourceUrl) {
      return (
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
      );
    }
    return null;
  };

  // Whether to show font/width controls (only for generic reader and newsletter)
  const showTypographyControls = !hasPlatformCard || isNewsletter;

  // PDF items use a specialised layout — the PdfReaderView has its own toolbar
  // so we only render the close/detach buttons in a minimal header.
  if (isPdf) {
    return (
      <div className="flex h-full flex-col">
        {/* Minimal header with detach/close */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium text-muted-foreground">
            PDF Reader
          </span>
          <div className="flex items-center gap-1">
            {onDetachToggle && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDetachToggle}
                aria-label={isDetached ? 'Dock to split view (Shift+R)' : 'Pop out to floating window (Shift+R)'}
                title={isDetached ? 'Dock to split view (Shift+R)' : 'Pop out (Shift+R)'}
                className="hidden md:inline-flex"
              >
                {isDetached ? <PanelRightClose className="size-4" /> : <Maximize2 className="size-4" />}
              </Button>
            )}
            {!hideCloseButton && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label="Close reader"
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        </div>
        {/* PDF viewer fills remaining space */}
        <div className="flex-1 overflow-hidden">
          <PdfReaderView
            sourceUrl={sourceUrl}
            filePath={filePath}
            title={title}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          {showTypographyControls && (
            <>
              {/* Font size toggle */}
              <div
                className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
                role="radiogroup"
                aria-label="Font size"
              >
                {FONT_SIZES.map(({ value, label }) => (
                  <button
                    key={value}
                    role="radio"
                    aria-checked={fontSize === value}
                    onClick={() => onFontSizeChange(value)}
                    className={cn(
                      'rounded-sm px-2 py-0.5 text-xs font-medium transition-colors',
                      fontSize === value
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    aria-label={`Font size: ${value}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Max width toggle */}
              <div
                className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
                role="radiogroup"
                aria-label="Content width"
              >
                {MAX_WIDTHS.map(({ value, label }) => (
                  <button
                    key={value}
                    role="radio"
                    aria-checked={maxWidth === value}
                    onClick={() => onMaxWidthChange(value)}
                    className={cn(
                      'rounded-sm px-2 py-0.5 text-xs font-medium transition-colors',
                      maxWidth === value
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    aria-label={`Content width: ${value}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {!showTypographyControls && (
            <span className="text-sm font-medium text-muted-foreground">
              Reader
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onDetachToggle && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDetachToggle}
              aria-label={isDetached ? 'Dock to split view (Shift+R)' : 'Pop out to floating window (Shift+R)'}
              title={isDetached ? 'Dock to split view (Shift+R)' : 'Pop out (Shift+R)'}
              className="hidden md:inline-flex"
            >
              {isDetached ? <PanelRightClose className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
          )}
          {!hideCloseButton && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close reader"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>
      {/* Reader content */}
      <div className="flex-1 overflow-y-auto p-6">
        {!hasPlatformCard && (
          <h2 className="mb-6 text-xl font-bold leading-tight">{title}</h2>
        )}
        <div className="mx-auto">
          {renderPlatformContent()}
        </div>
      </div>
    </div>
  );
}
