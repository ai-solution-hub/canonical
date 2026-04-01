// Not a TanStack Query candidate — placeholder hook (no API calls yet)
'use client';

import { useState, useCallback } from 'react';
import type { TranscriptSegment, TranscriptHighlight } from '@/types/content';

interface UseTranscriptOptions {
  itemId: string;
  initialSegments: TranscriptSegment[] | null;
  initialHighlights: TranscriptHighlight[] | null;
}

interface UseTranscriptReturn {
  segments: TranscriptSegment[] | null;
  highlights: TranscriptHighlight[] | null;
  isExtractingHighlights: boolean;
  extractHighlights: () => void;
  handleHighlightStarToggle: (index: number) => void;
  setSegments: (segments: TranscriptSegment[]) => void;
}

/** Placeholder — transcript hook not yet implemented in Knowledge Hub. */
export function useTranscript({
  initialSegments,
  initialHighlights,
}: UseTranscriptOptions): UseTranscriptReturn {
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(initialSegments);
  const [highlights] = useState<TranscriptHighlight[] | null>(initialHighlights);

  const extractHighlights = useCallback(() => {
    // Not yet implemented
  }, []);

   
  const handleHighlightStarToggle = useCallback((_index: number) => {
    // Not yet implemented
  }, []);

  return {
    segments,
    highlights,
    isExtractingHighlights: false,
    extractHighlights,
    handleHighlightStarToggle,
    setSegments,
  };
}
