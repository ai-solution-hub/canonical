'use client';

import { Play, Clock, User, Subtitles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TranscriptReader } from '@/components/transcript-reader';
import { cn } from '@/lib/utils';
import { formatDuration, extractYouTubeVideoId } from '@/lib/format';
import type {
  TranscriptChapter,
  TranscriptSegment,
  TranscriptHighlight,
} from '@/types/content';

interface TranscriptReaderCardProps {
  content: string;
  chapters: TranscriptChapter[];
  segments?: TranscriptSegment[];
  highlights?: TranscriptHighlight[];
  metadata: Record<string, unknown> | null;
  authorName: string | null;
  sourceUrl: string | null;
  className?: string;
}

export function TranscriptReaderCard({
  content,
  chapters,
  segments,
  highlights,
  metadata,
  authorName,
  sourceUrl,
  className,
}: TranscriptReaderCardProps) {
  const channel = (metadata?.host as string) || authorName;
  const guest = metadata?.guest as string | undefined;
  const durationSeconds = metadata?.duration_seconds as number | undefined;
  const captionsType = metadata?.captions_type as string | undefined;

  const videoId = sourceUrl ? extractYouTubeVideoId(sourceUrl) : null;

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card overflow-hidden',
        className,
      )}
    >
      {/* Video metadata header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 text-sm text-muted-foreground">
        {channel && (
          <span className="flex items-center gap-1 font-medium text-foreground">
            <Play className="size-3.5" />
            {channel}
          </span>
        )}
        {guest && (
          <span className="flex items-center gap-1">
            <User className="size-3.5" />
            {guest}
          </span>
        )}
        {durationSeconds != null && (
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            {formatDuration(durationSeconds)}
          </span>
        )}
        {captionsType && (
          <span className="flex items-center gap-1">
            <Subtitles className="size-3.5" />
            <Badge variant="secondary" className="text-xs">
              {captionsType}
            </Badge>
          </span>
        )}
        {videoId && (
          <a
            href={sourceUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-primary hover:underline"
          >
            Watch on YouTube
          </a>
        )}
      </div>

      {/* Chapter navigation + transcript */}
      <div className="px-4 py-4">
        {chapters.length > 1 && (
          <div className="mb-4 text-xs text-muted-foreground">
            {chapters.length} chapters
          </div>
        )}
        <TranscriptReader
          content={content}
          chapters={chapters}
          segments={segments}
          highlights={highlights}
        />
      </div>
    </div>
  );
}
