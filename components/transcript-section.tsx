'use client';

import type { TranscriptSegment } from '@/types/content';

interface TranscriptSectionProps {
  contentType: string;
  metadata: Record<string, unknown> | null;
  segments: TranscriptSegment[] | null;
  itemId: string;
  onSegmentsGenerated?: (segments: TranscriptSegment[]) => void;
}

/** Placeholder — transcript section not yet implemented in Knowledge Hub. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function TranscriptSection(props: TranscriptSectionProps) {
  return null;
}
