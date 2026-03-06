/**
 * WP5: ContentTabs Component Tests
 *
 * Tests the ContentTabs component (renamed from SummaryTabs).
 * Covers tab rendering, AI summary display, generate button, and loading state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock ContentRenderer to avoid react-markdown
vi.mock('@/components/content-renderer', () => ({
  ContentRenderer: ({ content }: { content: string }) => (
    <div data-testid="content-renderer">{content}</div>
  ),
}));

// Mock dynamic import for ContentEditor
vi.mock('next/dynamic', () => ({
  default: () => {
    const MockComponent = () => <div data-testid="content-editor" />;
    MockComponent.displayName = 'MockDynamic';
    return MockComponent;
  },
}));

// Mock reader components
vi.mock('@/components/reader-view', () => ({
  ReaderView: () => <div data-testid="reader-view" />,
}));

vi.mock('@/components/iframe-viewer', () => ({
  IframeViewer: () => <div data-testid="iframe-viewer" />,
}));

vi.mock('@/components/reader-cards/newsletter-reader-card', () => ({
  NewsletterReaderCard: () => <div data-testid="newsletter-reader" />,
}));

vi.mock('@/components/reader-cards/transcript-reader-card', () => ({
  TranscriptReaderCard: () => <div data-testid="transcript-reader" />,
}));

// Mock sonner toast
const { mockToast } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

import { ContentTabs } from '@/components/content-tabs';
import type { SummaryData } from '@/types/content';

// ---------------------------------------------------------------------------
// Mock data factory
// ---------------------------------------------------------------------------

function makeSummaryData(overrides: Partial<SummaryData> = {}): SummaryData {
  return {
    executive: 'This is the executive summary.',
    detailed: 'This is the detailed analysis with more context.',
    takeaways: ['Key point 1', 'Key point 2', 'Key point 3'],
    model: 'claude-sonnet-4-20250514',
    generated_at: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Summary tab when summaryData is provided', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
      />,
    );
    expect(screen.getByText('Summary')).toBeInTheDocument();
  });

  it('shows AI summary text in Summary tab', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
      />,
    );
    expect(screen.getByText('This is the executive summary.')).toBeInTheDocument();
  });

  it('renders Detailed tab when detailed summary exists', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
      />,
    );
    expect(screen.getByText('Detailed')).toBeInTheDocument();
  });

  it('renders Takeaways tab when takeaways exist', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
      />,
    );
    expect(screen.getByText('Takeaways')).toBeInTheDocument();
  });

  it('renders Content tab when content is provided', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={null}
        content="This is the full article text."
        contentType="article"
      />,
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('renders "Full Answer" for Q&A pairs instead of "Full Text"', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={null}
        content="The complete answer text."
        contentType="q_a_pair"
      />,
    );
    expect(screen.getByText('Full Answer')).toBeInTheDocument();
  });

  it('renders Technical tab when reference is provided', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={null}
        reference="Reference material here."
        contentType="article"
      />,
    );
    expect(screen.getByText('Technical')).toBeInTheDocument();
  });

  it('shows human-authored brief content when brief is provided', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={null}
        brief="Human-written sales brief."
        contentType="article"
      />,
    );
    expect(screen.getByText('Human-written sales brief.')).toBeInTheDocument();
  });

  it('shows "Generate AI summary" button when no summary exists', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={null}
        contentType="article"
        canEdit={true}
      />,
    );
    const buttons = screen.getAllByText('Generate AI summary');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('does not show generate button for non-editors', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={null}
        contentType="article"
        canEdit={false}
      />,
    );
    expect(screen.queryByText('Generate AI summary')).not.toBeInTheDocument();
  });

  it('calls /api/summaries/generate on generate button click', async () => {
    const user = userEvent.setup();

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          summary_data: makeSummaryData(),
        }),
    });

    render(
      <ContentTabs
        itemId="item-1"
        summaryData={null}
        contentType="article"
        canEdit={true}
      />,
    );

    // Click the generate button (there may be two — one in empty state, one in footer)
    const buttons = screen.getAllByText('Generate AI summary');
    await user.click(buttons[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/summaries/generate',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  it('shows loading state during generation', async () => {
    const user = userEvent.setup();

    // Make fetch hang to keep loading state visible
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(
      <ContentTabs
        itemId="item-1"
        summaryData={null}
        contentType="article"
        canEdit={true}
      />,
    );

    const buttons = screen.getAllByText('Generate AI summary');
    await user.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getByText('Generating summary…')).toBeInTheDocument();
    });
  });

  it('shows toast on generation error', async () => {
    const user = userEvent.setup();

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Insufficient content' }),
    });

    render(
      <ContentTabs
        itemId="item-1"
        summaryData={null}
        contentType="article"
        canEdit={true}
      />,
    );

    const buttons = screen.getAllByText('Generate AI summary');
    await user.click(buttons[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Insufficient content');
    });
  });

  it('shows model info in footer when summary exists', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
      />,
    );
    expect(screen.getByText(/Generated by claude-sonnet/)).toBeInTheDocument();
  });
});
