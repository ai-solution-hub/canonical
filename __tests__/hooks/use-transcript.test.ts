import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTranscript } from '@/hooks/use-transcript';
import type { TranscriptSegment, TranscriptHighlight } from '@/types/content';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTranscript', () => {
  const defaultSegments: TranscriptSegment[] = [
    {
      id: 'seg-1',
      chapter_index: 0,
      title: 'Introduction',
      summary: 'Opening remarks',
      key_points: ['Point 1'],
      start_seconds: 0,
      end_seconds: 60,
      start_time: '00:00:00',
      end_time: '00:01:00',
      duration_seconds: 60,
      word_count: 0,
      read_time_minutes: 0,
    },
  ];

  const defaultHighlights: TranscriptHighlight[] = [
    {
      id: 'hl-1',
      quote: 'Important quote',
      timestamp: '00:01:30',
      approximate_timestamp: 90,
      chapter_index: 0,
      category: 'insight',
      significance: '',
      starred: false,
    },
  ];

  it('returns initial segments and highlights', () => {
    const { result } = renderHook(() =>
      useTranscript({
        itemId: 'item-1',
        initialSegments: defaultSegments,
        initialHighlights: defaultHighlights,
      }),
    );

    expect(result.current.segments).toEqual(defaultSegments);
    expect(result.current.highlights).toEqual(defaultHighlights);
    expect(result.current.isExtractingHighlights).toBe(false);
  });

  it('handles null initial values', () => {
    const { result } = renderHook(() =>
      useTranscript({
        itemId: 'item-1',
        initialSegments: null,
        initialHighlights: null,
      }),
    );

    expect(result.current.segments).toBeNull();
    expect(result.current.highlights).toBeNull();
  });

  it('setSegments updates segments', () => {
    const { result } = renderHook(() =>
      useTranscript({
        itemId: 'item-1',
        initialSegments: null,
        initialHighlights: null,
      }),
    );

    act(() => {
      result.current.setSegments(defaultSegments);
    });

    expect(result.current.segments).toEqual(defaultSegments);
  });

  it('extractHighlights is a no-op', () => {
    const { result } = renderHook(() =>
      useTranscript({
        itemId: 'item-1',
        initialSegments: null,
        initialHighlights: null,
      }),
    );

    // Should not throw
    act(() => {
      result.current.extractHighlights();
    });

    expect(result.current.isExtractingHighlights).toBe(false);
  });

  it('handleHighlightStarToggle is a no-op', () => {
    const { result } = renderHook(() =>
      useTranscript({
        itemId: 'item-1',
        initialSegments: null,
        initialHighlights: null,
      }),
    );

    // Should not throw
    act(() => {
      result.current.handleHighlightStarToggle(0);
    });
  });
});
