'use client';

import type { TranscriptChapter, TranscriptHighlight } from '@/types/content';

interface HighlightsSectionProps {
  highlights: TranscriptHighlight[] | null;
  isExtracting: boolean;
  itemId: string;
  transcriptChapters?: TranscriptChapter[];
  onExtract: () => void;
  onStarToggle: (index: number) => void;
}

/** Placeholder — highlights section not yet implemented in Knowledge Hub. */
export function HighlightsSection(_props: HighlightsSectionProps) {
  return null;
}
