/**
 * ContentTabs — Flag Summary for Review Tests
 *
 * Tests the "Flag for review" feature in ContentTabs footer.
 * Covers visibility conditions, inline form interaction, API call payload,
 * flagged state display, error handling, and regenerate after flag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
// Tests — Flag summary for review
// ---------------------------------------------------------------------------

describe('ContentTabs — Flag for review', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Visibility conditions
  // -----------------------------------------------------------------------

  it('shows "Flag for review" button when canEdit, showSourceToggle, and summaryData are all truthy', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
        canEdit={true}
        showSourceToggle={true}
      />,
    );
    expect(screen.getByLabelText('Flag summary for review')).toBeInTheDocument();
  });

  it('hides "Flag for review" button when canEdit is false', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
        canEdit={false}
        showSourceToggle={true}
      />,
    );
    expect(screen.queryByLabelText('Flag summary for review')).not.toBeInTheDocument();
  });

  it('hides "Flag for review" button when showSourceToggle is false', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
        canEdit={true}
        showSourceToggle={false}
      />,
    );
    expect(screen.queryByLabelText('Flag summary for review')).not.toBeInTheDocument();
  });

  it('hides "Flag for review" button when summaryData is null', () => {
    render(
      <ContentTabs
        itemId="item-1"
        summaryData={null}
        contentType="article"
        canEdit={true}
        showSourceToggle={true}
      />,
    );
    expect(screen.queryByLabelText('Flag summary for review')).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Inline form interaction
  // -----------------------------------------------------------------------

  it('opens inline flag form when "Flag for review" is clicked', async () => {
    const user = userEvent.setup();

    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
        canEdit={true}
        showSourceToggle={true}
      />,
    );

    await user.click(screen.getByLabelText('Flag summary for review'));

    // Form should be visible with pre-populated note
    expect(screen.getByLabelText('Note for reviewer')).toBeInTheDocument();
    expect(screen.getByLabelText('Note for reviewer')).toHaveValue('Summary needs improvement');

    // Flag and Cancel buttons should appear
    expect(screen.getByRole('button', { name: /^Flag$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    // "Flag for review" button should be hidden while form is open
    expect(screen.queryByLabelText('Flag summary for review')).not.toBeInTheDocument();
  });

  it('closes inline form and resets note when Cancel is clicked', async () => {
    const user = userEvent.setup();

    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
        canEdit={true}
        showSourceToggle={true}
      />,
    );

    // Open form
    await user.click(screen.getByLabelText('Flag summary for review'));
    expect(screen.getByLabelText('Note for reviewer')).toBeInTheDocument();

    // Modify the note
    const input = screen.getByLabelText('Note for reviewer');
    await user.clear(input);
    await user.type(input, 'Custom note');

    // Cancel
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Form should be hidden, original button back
    expect(screen.queryByLabelText('Note for reviewer')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Flag summary for review')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // API call
  // -----------------------------------------------------------------------

  it('calls POST /api/review/action with correct payload on flag submit', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    render(
      <ContentTabs
        itemId="item-42"
        summaryData={makeSummaryData()}
        contentType="article"
        canEdit={true}
        showSourceToggle={true}
      />,
    );

    // Open form and submit with default note
    await user.click(screen.getByLabelText('Flag summary for review'));
    await user.click(screen.getByRole('button', { name: /^Flag$/ }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/review/action',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'flag',
            item_id: 'item-42',
            flag_details: '[Summary feedback] Summary needs improvement',
          }),
        }),
      );
    });
  });

  it('includes custom note text in flag_details with [Summary feedback] prefix', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    render(
      <ContentTabs
        itemId="item-99"
        summaryData={makeSummaryData()}
        contentType="article"
        canEdit={true}
        showSourceToggle={true}
      />,
    );

    // Open form, modify note, submit
    await user.click(screen.getByLabelText('Flag summary for review'));
    const input = screen.getByLabelText('Note for reviewer');
    await user.clear(input);
    await user.type(input, 'Missing key details about compliance');
    await user.click(screen.getByRole('button', { name: /^Flag$/ }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/review/action',
        expect.objectContaining({
          body: JSON.stringify({
            action: 'flag',
            item_id: 'item-99',
            flag_details: '[Summary feedback] Missing key details about compliance',
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Flagged state
  // -----------------------------------------------------------------------

  it('shows "Flagged for review" status after successful flag', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
        canEdit={true}
        showSourceToggle={true}
      />,
    );

    // Open form and submit
    await user.click(screen.getByLabelText('Flag summary for review'));
    await user.click(screen.getByRole('button', { name: /^Flag$/ }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Flagged for review');
    });

    // Success toast should be shown
    expect(mockToast.success).toHaveBeenCalledWith('Summary flagged for review');
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('shows error toast when flag API call fails', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Content item not found' }),
    });

    render(
      <ContentTabs
        itemId="item-missing"
        summaryData={makeSummaryData()}
        contentType="article"
        canEdit={true}
        showSourceToggle={true}
      />,
    );

    // Open form and submit
    await user.click(screen.getByLabelText('Flag summary for review'));
    await user.click(screen.getByRole('button', { name: /^Flag$/ }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Content item not found');
    });

    // Should NOT transition to flagged state
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows generic error toast when flag API throws network error', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
        canEdit={true}
        showSourceToggle={true}
      />,
    );

    // Open form and submit
    await user.click(screen.getByLabelText('Flag summary for review'));
    await user.click(screen.getByRole('button', { name: /^Flag$/ }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Network error');
    });
  });

  // -----------------------------------------------------------------------
  // Regenerate after flagging
  // -----------------------------------------------------------------------

  it('shows Regenerate button after flagging', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
        canEdit={true}
        showSourceToggle={true}
      />,
    );

    // Flag the summary
    await user.click(screen.getByLabelText('Flag summary for review'));
    await user.click(screen.getByRole('button', { name: /^Flag$/ }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Flagged for review');
    });

    // Regenerate button should be visible
    expect(screen.getByRole('button', { name: /Regenerate/ })).toBeInTheDocument();
  });

  it('calls handleGenerate and resets flagged state when Regenerate is clicked', async () => {
    const user = userEvent.setup();

    // First call: flag API, Second call: generate API (will hang)
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
      .mockReturnValueOnce(new Promise(() => {})); // generate hangs

    render(
      <ContentTabs
        itemId="item-1"
        summaryData={makeSummaryData()}
        contentType="article"
        canEdit={true}
        showSourceToggle={true}
      />,
    );

    // Flag first
    await user.click(screen.getByLabelText('Flag summary for review'));
    await user.click(screen.getByRole('button', { name: /^Flag$/ }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Flagged for review');
    });

    // Click Regenerate
    await user.click(screen.getByRole('button', { name: /Regenerate/ }));

    // Should have called the generate endpoint
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/summaries/generate',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
