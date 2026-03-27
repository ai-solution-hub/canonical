'use client';

import { useRef, useCallback } from 'react';
import { Rnd } from 'react-rnd';
import { X, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReaderPanel } from '@/components/reader/reader-panel';
import type {
  ReaderFontSize,
  ReaderMaxWidth,
  FloatingPosition,
  FloatingSize,
} from '@/hooks/use-reader-preferences';
import {
  getDefaultFloatingPosition,
  getDefaultFloatingSize,
} from '@/hooks/use-reader-preferences';
import type {
  TranscriptChapter,
  TranscriptSegment,
  TranscriptHighlight,
} from '@/types/content';

interface FloatingReaderProps {
  /** Reader HTML content */
  readerHtml: string | null | undefined;
  /** Content type of the item */
  contentType: string | null;
  /** Title to display */
  title: string;
  /** Current font size preference */
  fontSize: ReaderFontSize;
  /** Current max width preference */
  maxWidth: ReaderMaxWidth;
  /** Callback when font size changes */
  onFontSizeChange: (size: ReaderFontSize) => void;
  /** Callback when max width changes */
  onMaxWidthChange: (width: ReaderMaxWidth) => void;
  /** Callback to close the floating reader entirely */
  onClose: () => void;
  /** Callback to dock (reattach) the reader back to split view */
  onDock: () => void;
  /** Persisted position (nullable -- falls back to default) */
  position: FloatingPosition | null;
  /** Persisted size (nullable -- falls back to default) */
  size: FloatingSize | null;
  /** Callback when position changes */
  onPositionChange: (position: FloatingPosition) => void;
  /** Callback when size changes */
  onSizeChange: (size: FloatingSize) => void;
  /** Platform of the content item */
  platform?: string | null;
  /** Full metadata JSONB */
  metadata?: Record<string, unknown> | null;
  /** Author name for platform-specific reader cards */
  authorName?: string | null;
  /** Source URL for transcript reader card */
  sourceUrl?: string | null;
  /** Supabase Storage path for uploaded files */
  filePath?: string | null;
  /** Content text for platform-specific reader cards */
  content?: string | null;
  /** Transcript chapters */
  transcriptChapters?: TranscriptChapter[];
  /** Transcript segments */
  segments?: TranscriptSegment[] | null;
  /** Transcript highlights */
  highlights?: TranscriptHighlight[] | null;
  /** Whether the source URL can be embedded in an iframe */
  frameable?: boolean;
}

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;

export function FloatingReader({
  readerHtml,
  contentType,
  title,
  fontSize,
  maxWidth,
  onFontSizeChange,
  onMaxWidthChange,
  onClose,
  onDock,
  position,
  size,
  onPositionChange,
  onSizeChange,
  platform,
  metadata,
  authorName,
  sourceUrl,
  filePath,
  content,
  transcriptChapters,
  segments,
  highlights,
  frameable,
}: FloatingReaderProps) {
  const rndRef = useRef<Rnd>(null);

  const defaultPos = position ?? getDefaultFloatingPosition();
  const defaultSize = size ?? getDefaultFloatingSize();

  const handleDragStop = useCallback(
    (_e: unknown, data: { x: number; y: number }) => {
      onPositionChange({ x: data.x, y: data.y });
    },
    [onPositionChange],
  );

  const handleResizeStop = useCallback(
    (
      _e: unknown,
      _direction: unknown,
      ref: HTMLElement,
      _delta: unknown,
      pos: { x: number; y: number },
    ) => {
      onSizeChange({
        width: ref.offsetWidth,
        height: ref.offsetHeight,
      });
      onPositionChange({ x: pos.x, y: pos.y });
    },
    [onSizeChange, onPositionChange],
  );

  return (
    <Rnd
      ref={rndRef}
      default={{
        x: defaultPos.x,
        y: defaultPos.y,
        width: defaultSize.width,
        height: defaultSize.height,
      }}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
      bounds="window"
      dragHandleClassName="floating-reader-drag-handle"
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
      style={{ zIndex: 40 }}
      className="rounded-lg border border-border bg-background shadow-xl"
    >
      {/* Title bar -- draggable */}
      <div className="floating-reader-drag-handle flex cursor-move items-center justify-between rounded-t-lg border-b border-border bg-muted/50 px-3 py-2 backdrop-blur-sm">
        <span className="truncate text-sm font-medium text-foreground">
          {title}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDock}
            aria-label="Dock reader panel"
            title="Dock to split view"
          >
            <PanelRightClose className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close reader"
            title="Close reader"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
      {/* Reader content */}
      <div className="h-[calc(100%-2.5rem)] overflow-hidden rounded-b-lg">
        <ReaderPanel
          readerHtml={readerHtml}
          contentType={contentType}
          title={title}
          fontSize={fontSize}
          maxWidth={maxWidth}
          onFontSizeChange={onFontSizeChange}
          onMaxWidthChange={onMaxWidthChange}
          onClose={onClose}
          onDetachToggle={onDock}
          isDetached={true}
          platform={platform}
          metadata={metadata}
          authorName={authorName}
          sourceUrl={sourceUrl}
          filePath={filePath}
          content={content}
          transcriptChapters={transcriptChapters}
          segments={segments}
          highlights={highlights}
          frameable={frameable}
          hideCloseButton
        />
      </div>
    </Rnd>
  );
}
