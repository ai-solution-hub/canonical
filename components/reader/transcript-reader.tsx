'use client';

import type {
  TranscriptChapter,
  TranscriptSegment,
  TranscriptHighlight,
} from '@/types/content';

interface TranscriptReaderProps {
  content: string;
  chapters: TranscriptChapter[];
  segments?: TranscriptSegment[];
  highlights?: TranscriptHighlight[];
}

/** Placeholder — transcript reader not yet implemented in Knowledge Hub. */
export function TranscriptReader({ content }: TranscriptReaderProps) {
  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
      <p>Transcript reader is not yet available.</p>
      {content && (
        <pre className="mt-3 max-h-60 overflow-y-auto whitespace-pre-wrap text-xs">
          {content.slice(0, 2000)}
          {content.length > 2000 ? '\n...' : ''}
        </pre>
      )}
    </div>
  );
}
