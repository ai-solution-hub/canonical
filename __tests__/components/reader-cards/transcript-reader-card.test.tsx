/**
 * TranscriptReaderCard Component Tests
 *
 * Tests transcript metadata display including channel name, guest,
 * duration, captions type, chapter count, and TranscriptReader rendering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/components/transcript-reader', () => ({
  TranscriptReader: () => <div data-testid="transcript-reader">TranscriptReader</div>,
}));

vi.mock('@/lib/format', () => ({
  formatDuration: (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { TranscriptReaderCard } from '@/components/reader-cards/transcript-reader-card';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TranscriptReaderCard', () => {
  const defaultProps = {
    content: 'Transcript text content',
    chapters: [] as { title: string; startTime: number }[],
    metadata: {} as Record<string, unknown> | null,
    authorName: null as string | null,
    sourceUrl: null as string | null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows channel name from metadata host', () => {
    render(
      <TranscriptReaderCard
        {...defaultProps}
        metadata={{ host: 'Tech Talks Channel' }}
      />,
    );

    expect(screen.getByText('Tech Talks Channel')).toBeInTheDocument();
  });

  it('falls back to authorName when no host in metadata', () => {
    render(
      <TranscriptReaderCard
        {...defaultProps}
        metadata={{}}
        authorName="Jane Smith"
      />,
    );

    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('shows guest name when available', () => {
    render(
      <TranscriptReaderCard
        {...defaultProps}
        metadata={{ host: 'Host', guest: 'Dr. Alice Johnson' }}
      />,
    );

    expect(screen.getByText('Dr. Alice Johnson')).toBeInTheDocument();
  });

  it('shows formatted duration', () => {
    render(
      <TranscriptReaderCard
        {...defaultProps}
        metadata={{ duration_seconds: 5400 }}
      />,
    );

    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });

  it('shows captions type badge', () => {
    render(
      <TranscriptReaderCard
        {...defaultProps}
        metadata={{ captions_type: 'auto-generated' }}
      />,
    );

    expect(screen.getByText('auto-generated')).toBeInTheDocument();
  });

  it('shows chapter count when more than one chapter', () => {
    render(
      <TranscriptReaderCard
        {...defaultProps}
        chapters={[
          { title: 'Introduction', startTime: 0 },
          { title: 'Main Topic', startTime: 120 },
          { title: 'Conclusion', startTime: 600 },
        ]}
        metadata={{ host: 'Channel' }}
      />,
    );

    expect(screen.getByText('3 chapters')).toBeInTheDocument();
    expect(screen.getByTestId('transcript-reader')).toBeInTheDocument();
  });
});
