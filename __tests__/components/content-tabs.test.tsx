/**
 * ContentTabs Component Tests
 *
 * Tests the ContentTabs component (renamed from SummaryTabs).
 * Covers tab rendering, AI summary display, generate button, loading state,
 * and the showSourceToggle prop for role-aware AI messaging.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock ContentRenderer to avoid react-markdown
vi.mock('@/components/item-detail/content-renderer', () => ({
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
vi.mock('@/components/reader/reader-view', () => ({
  ReaderView: () => <div data-testid="reader-view" />,
}));

vi.mock('@/components/reader/iframe-viewer', () => ({
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

import { ContentTabs } from '@/components/item-detail/content-tabs';
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
// Tests -- existing behaviour (backwards compatibility)
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
    expect(screen.getByText('In Depth')).toBeInTheDocument();
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

  it('renders Original Text tab when content is provided for non-Q&A items', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={null}
        content="This is the full article text."
        contentType="article"
      />,
    );
    expect(screen.getByText('Original Text')).toBeInTheDocument();
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
    expect(screen.getByText('Supporting Detail')).toBeInTheDocument();
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

  it('shows "Generate summary" button when no summary exists', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={null}
        contentType="article"
        canEdit={true}
      />,
    );
    const buttons = screen.getAllByText('Generate summary');
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
    expect(screen.queryByText('Generate summary')).not.toBeInTheDocument();
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

    // Click the generate button (there may be two -- one in empty state, one in footer)
    const buttons = screen.getAllByText('Generate summary');
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

    const buttons = screen.getAllByText('Generate summary');
    await user.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getByText('Generating summary\u2026')).toBeInTheDocument();
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

    const buttons = screen.getAllByText('Generate summary');
    await user.click(buttons[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Insufficient content');
    });
  });

  it('shows last updated date in footer when summary exists', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
      />,
    );
    expect(screen.getByText(/Last updated/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Tests -- showSourceToggle prop (Phase 2: Role-aware AI messaging)
  // ---------------------------------------------------------------------------

  describe('showSourceToggle prop', () => {
    describe('when showSourceToggle is true (default)', () => {
      it('renders ContentSourceToggle when both human and AI content exist', () => {
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData()}
            brief="Human brief content"
            contentType="article"
            canEdit={true}
            showSourceToggle={true}
          />,
        );
        // The toggle renders "Original" and "Auto-summary" buttons
        expect(screen.getByText('Original')).toBeInTheDocument();
        expect(screen.getByText('Auto-summary')).toBeInTheDocument();
      });

      it('shows "Auto-generated" message when only AI brief exists and canEdit', () => {
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData()}
            contentType="article"
            canEdit={true}
            showSourceToggle={true}
          />,
        );
        expect(
          screen.getByText(/Auto-generated \u2014 write a Summary to replace/),
        ).toBeInTheDocument();
      });

      it('shows "Generate summary" buttons in empty state for editors', () => {
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={null}
            contentType="article"
            canEdit={true}
            showSourceToggle={true}
          />,
        );
        const buttons = screen.getAllByText('Generate summary');
        expect(buttons.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('when showSourceToggle is omitted (defaults to true)', () => {
      it('renders ContentSourceToggle when both human and AI content exist', () => {
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData()}
            brief="Human brief content"
            contentType="article"
            canEdit={true}
          />,
        );
        expect(screen.getByText('Original')).toBeInTheDocument();
        expect(screen.getByText('Auto-summary')).toBeInTheDocument();
      });

      it('shows "Auto-generated" message when only AI brief exists and canEdit', () => {
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData()}
            contentType="article"
            canEdit={true}
          />,
        );
        expect(
          screen.getByText(/Auto-generated \u2014 write a Summary to replace/),
        ).toBeInTheDocument();
      });
    });

    describe('when showSourceToggle is false', () => {
      it('does NOT render ContentSourceToggle when both human and AI brief exist', () => {
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData()}
            brief="Human brief content"
            contentType="article"
            canEdit={false}
            showSourceToggle={false}
          />,
        );
        expect(screen.queryByText('Original')).not.toBeInTheDocument();
        expect(screen.queryByText('Auto-summary')).not.toBeInTheDocument();
      });

      it('shows human content (not AI) when both exist and toggle is hidden', () => {
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData({ executive: 'AI generated summary text' })}
            brief="Human-authored brief for readers"
            contentType="article"
            canEdit={false}
            showSourceToggle={false}
          />,
        );
        // Human content should be visible
        expect(
          screen.getByText('Human-authored brief for readers'),
        ).toBeInTheDocument();
        // AI content should NOT be visible (human takes priority)
        expect(
          screen.queryByText('AI generated summary text'),
        ).not.toBeInTheDocument();
      });

      it('shows AI content without label when only AI exists and toggle is hidden', () => {
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData({ executive: 'AI-only summary content' })}
            contentType="article"
            canEdit={false}
            showSourceToggle={false}
          />,
        );
        // AI content should be displayed
        expect(
          screen.getByText('AI-only summary content'),
        ).toBeInTheDocument();
        // But the "Auto-generated" message should NOT appear
        expect(
          screen.queryByText(/Auto-generated/),
        ).not.toBeInTheDocument();
      });

      it('hides "Auto-generated" summary message even when canEdit is true', () => {
        // Edge case: editor in reader mode (canEdit=true, showSourceToggle=false)
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData()}
            contentType="article"
            canEdit={true}
            showSourceToggle={false}
          />,
        );
        expect(
          screen.queryByText(/Auto-generated \u2014 write a Summary to replace/),
        ).not.toBeInTheDocument();
      });

      it('hides "Auto-generated" In Depth message when showSourceToggle is false', async () => {
        const user = userEvent.setup();
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData()}
            contentType="article"
            canEdit={true}
            showSourceToggle={false}
          />,
        );
        // Switch to In Depth tab
        const inDepthTab = screen.getByText('In Depth');
        await user.click(inDepthTab);

        expect(
          screen.queryByText(/Auto-generated \u2014 write In Depth content to replace/),
        ).not.toBeInTheDocument();
      });

      it('does NOT render ContentSourceToggle in the detail tab when both human and AI exist', async () => {
        const user = userEvent.setup();
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData()}
            detail="Human detailed content"
            contentType="article"
            canEdit={false}
            showSourceToggle={false}
          />,
        );
        // Switch to In Depth tab
        const inDepthTab = screen.getByText('In Depth');
        await user.click(inDepthTab);

        // No toggle buttons
        expect(screen.queryByText('Original')).not.toBeInTheDocument();
        expect(screen.queryByText('Auto-summary')).not.toBeInTheDocument();
      });

      it('shows human detail content when both exist and toggle is hidden', async () => {
        const user = userEvent.setup();
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData({ detailed: 'AI detailed analysis' })}
            detail="Human-written detail section"
            contentType="article"
            canEdit={false}
            showSourceToggle={false}
          />,
        );
        // Switch to In Depth tab
        const inDepthTab = screen.getByText('In Depth');
        await user.click(inDepthTab);

        expect(
          screen.getByText('Human-written detail section'),
        ).toBeInTheDocument();
        expect(
          screen.queryByText('AI detailed analysis'),
        ).not.toBeInTheDocument();
      });

      it('hides empty-state "Generate summary" button when showSourceToggle is false', () => {
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={null}
            contentType="article"
            canEdit={true}
            showSourceToggle={false}
          />,
        );
        expect(screen.queryByText('Generate summary')).not.toBeInTheDocument();
      });

      it('hides footer "Generate summary" button when showSourceToggle is false', () => {
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={null}
            contentType="article"
            canEdit={true}
            showSourceToggle={false}
          />,
        );
        // Both empty-state and footer generate buttons should be hidden
        expect(screen.queryByText('Generate summary')).not.toBeInTheDocument();
      });
    });

    describe('interaction between showSourceToggle and canEdit', () => {
      it('toggle shown for editors with showSourceToggle=true', () => {
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData()}
            brief="Human brief"
            contentType="article"
            canEdit={true}
            showSourceToggle={true}
          />,
        );
        expect(screen.getByText('Original')).toBeInTheDocument();
        expect(screen.getByText('Auto-summary')).toBeInTheDocument();
      });

      it('toggle hidden for viewers even with showSourceToggle=true when no dual content', () => {
        // Only AI exists, no human content -- no toggle rendered regardless of showSourceToggle
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData()}
            contentType="article"
            canEdit={false}
            showSourceToggle={true}
          />,
        );
        // Toggle only shows when BOTH human and AI exist
        expect(screen.queryByText('Original')).not.toBeInTheDocument();
      });

      it('AI content displays without messaging for reader view', () => {
        render(
          <ContentTabs
            itemId="item-1"
            summaryData={makeSummaryData({ executive: 'Clean AI summary for readers' })}
            contentType="article"
            canEdit={false}
            showSourceToggle={false}
          />,
        );
        // Content should be clean -- no "Auto-generated" text
        expect(
          screen.getByText('Clean AI summary for readers'),
        ).toBeInTheDocument();
        expect(screen.queryByText(/Auto-generated/)).not.toBeInTheDocument();
        expect(screen.queryByText('Original')).not.toBeInTheDocument();
        expect(screen.queryByText('Auto-summary')).not.toBeInTheDocument();
      });
    });
  });
});
