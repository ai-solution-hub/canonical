/**
 * SummaryTabs Component Tests
 *
 * Tests the SummaryTabs component — tab rendering, content display,
 * summary generation, empty/fallback states, and platform-specific cards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SummaryData } from '@/types/content';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockToast } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
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

vi.mock('@/components/item-detail/content-renderer', () => ({
  ContentRenderer: ({ content }: { content: string }) => (
    <div data-testid="content-renderer">{content}</div>
  ),
}));

vi.mock('@/components/reader/reader-view', () => ({
  ReaderView: ({ html }: { html: string }) => (
    <div data-testid="reader-view">{html.slice(0, 50)}</div>
  ),
}));

vi.mock('@/components/reader/iframe-viewer', () => ({
  IframeViewer: ({ src }: { src: string }) => (
    <div data-testid="iframe-viewer">{src}</div>
  ),
}));

vi.mock('@/components/reader-cards/newsletter-reader-card', () => ({
  NewsletterReaderCard: () => (
    <div data-testid="newsletter-reader-card">Newsletter</div>
  ),
}));

vi.mock('@/components/reader-cards/transcript-reader-card', () => ({
  TranscriptReaderCard: () => (
    <div data-testid="transcript-reader-card">Transcript</div>
  ),
}));

vi.mock('@/lib/format', () => ({
  formatDate: (d: string | null) => d ?? '',
}));

import { SummaryTabs } from '@/components/item-detail/summary-tabs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSummaryData(overrides: Partial<SummaryData> = {}): SummaryData {
  return {
    executive: overrides.executive ?? 'This is the executive summary.',
    detailed: overrides.detailed ?? '## Detailed\n\nMore detail here.',
    takeaways: overrides.takeaways ?? [
      'Takeaway one',
      'Takeaway two',
      'Takeaway three',
    ],
    generated_at: overrides.generated_at ?? '2026-03-10T12:00:00Z',
    model: overrides.model ?? 'claude-sonnet-4-6',
    tokens_used: overrides.tokens_used ?? 1300,
  };
}

const defaultProps = {
  itemId: 'item-123',
  contentType: 'article',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SummaryTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders Quick tab with executive summary when summaryData provided', () => {
    const summary = createSummaryData({
      executive: 'Key findings about compliance.',
    });
    render(<SummaryTabs {...defaultProps} summaryData={summary} />);

    expect(screen.getByRole('tab', { name: 'Quick' })).toBeInTheDocument();
    expect(
      screen.getByText('Key findings about compliance.'),
    ).toBeInTheDocument();
  });

  it('renders Detailed tab with detailed content', async () => {
    const user = userEvent.setup();
    const summary = createSummaryData({
      detailed: '## Deep dive\n\nAnalysis here.',
    });
    render(<SummaryTabs {...defaultProps} summaryData={summary} />);

    const detailedTab = screen.getByRole('tab', { name: 'Detailed' });
    await user.click(detailedTab);

    expect(screen.getByTestId('content-renderer')).toBeInTheDocument();
  });

  it('renders Takeaways tab with checklist items', async () => {
    const user = userEvent.setup();
    const summary = createSummaryData({
      takeaways: ['First takeaway', 'Second takeaway'],
    });
    render(<SummaryTabs {...defaultProps} summaryData={summary} />);

    const takeawaysTab = screen.getByRole('tab', { name: 'Takeaways' });
    await user.click(takeawaysTab);

    expect(screen.getByText('First takeaway')).toBeInTheDocument();
    expect(screen.getByText('Second takeaway')).toBeInTheDocument();
  });

  it('renders Full Text tab with content and reading time', async () => {
    const user = userEvent.setup();
    const summary = createSummaryData();
    // Generate ~200 words of content for 1 min read
    const longContent = Array.from({ length: 200 }, (_, i) => `word${i}`).join(
      ' ',
    );
    render(
      <SummaryTabs
        {...defaultProps}
        summaryData={summary}
        content={longContent}
      />,
    );

    const fullTextTab = screen.getByRole('tab', { name: 'Full Text' });
    await user.click(fullTextTab);

    expect(screen.getByText(/min read/)).toBeInTheDocument();
  });

  it('hides Full Text tab when hideFullText=true', () => {
    const summary = createSummaryData();
    render(
      <SummaryTabs
        {...defaultProps}
        summaryData={summary}
        content="Some content"
        hideFullText={true}
      />,
    );

    expect(
      screen.queryByRole('tab', { name: 'Full Text' }),
    ).not.toBeInTheDocument();
  });

  it('shows "Full Answer" label when qaMode=true', () => {
    const summary = createSummaryData();
    render(
      <SummaryTabs
        {...defaultProps}
        summaryData={summary}
        content="Answer text"
        qaMode={true}
      />,
    );

    expect(
      screen.getByRole('tab', { name: 'Full Answer' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'Full Text' }),
    ).not.toBeInTheDocument();
  });

  it('shows generate summary button when no summaryData but content exists', () => {
    render(
      <SummaryTabs
        {...defaultProps}
        summaryData={null}
        content="Some content to summarise"
      />,
    );

    expect(
      screen.getByRole('button', { name: /Generate summary/ }),
    ).toBeInTheDocument();
  });

  it('shows empty state when no summaryData and no content', () => {
    render(<SummaryTabs {...defaultProps} summaryData={null} content={null} />);

    expect(screen.getByText(/No summary generated yet/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Generate summary/ }),
    ).toBeInTheDocument();
  });

  it('shows summary fallback in Quick tab when no summaryData', () => {
    render(
      <SummaryTabs
        {...defaultProps}
        summaryData={null}
        content="Some content"
        aiSummary="This is the AI classification summary fallback."
      />,
    );

    expect(
      screen.getByText('This is the AI classification summary fallback.'),
    ).toBeInTheDocument();
  });

  it('renders Reader tab when readerHtml provided', () => {
    const summary = createSummaryData();
    render(
      <SummaryTabs
        {...defaultProps}
        summaryData={summary}
        readerHtml="<p>Reader content</p>"
      />,
    );

    expect(screen.getByRole('tab', { name: 'Reader' })).toBeInTheDocument();
  });

  it('renders newsletter card when platform is email', async () => {
    const user = userEvent.setup();
    const summary = createSummaryData();
    render(
      <SummaryTabs
        {...defaultProps}
        summaryData={summary}
        platform="email"
        readerHtml="<p>Newsletter</p>"
      />,
    );

    const readerTab = screen.getByRole('tab', { name: 'Reader' });
    await user.click(readerTab);

    expect(screen.getByTestId('newsletter-reader-card')).toBeInTheDocument();
  });

  it('shows loading skeleton during generation', async () => {
    vi.stubGlobal('fetch', mockFetch);
    // Make fetch hang indefinitely
    mockFetch.mockReturnValue(new Promise(() => {}));

    const user = userEvent.setup();
    render(
      <SummaryTabs
        {...defaultProps}
        summaryData={null}
        content="Content to summarise"
      />,
    );

    const generateBtn = screen.getByRole('button', {
      name: /Generate summary/,
    });
    await user.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByText('Generating summary...')).toBeInTheDocument();
    });
  });
});
