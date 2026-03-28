/**
 * ReaderPanel Component Tests
 *
 * Tests the ReaderPanel component — multi-format content reader with
 * typography controls, empty states, and platform-specific rendering.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock child components to isolate ReaderPanel logic
// ---------------------------------------------------------------------------

vi.mock('@/components/reader/reader-view', () => ({
  ReaderView: ({ html, fontSize, maxWidth }: { html: string; fontSize?: string; maxWidth?: string }) => (
    <div data-testid="reader-view" data-font-size={fontSize} data-max-width={maxWidth}>
      {html}
    </div>
  ),
}));

vi.mock('@/components/reader/iframe-viewer', () => ({
  IframeViewer: ({ src, title }: { src: string; title: string }) => (
    <iframe data-testid="iframe-viewer" src={src} title={title} />
  ),
}));

vi.mock('next/dynamic', () => ({
  default: () => {
    const PdfReaderView = ({ title }: { title: string }) => (
      <div data-testid="pdf-reader-view">{title}</div>
    );
    PdfReaderView.displayName = 'PdfReaderView';
    return PdfReaderView;
  },
}));

vi.mock('@/components/reader-cards/newsletter-reader-card', () => ({
  NewsletterReaderCard: ({ content }: { content: string | null }) => (
    <div data-testid="newsletter-reader-card">{content}</div>
  ),
}));

vi.mock('@/components/reader-cards/transcript-reader-card', () => ({
  TranscriptReaderCard: ({ content }: { content: string }) => (
    <div data-testid="transcript-reader-card">{content}</div>
  ),
}));

// Import AFTER mocks
import { ReaderPanel } from '@/components/reader/reader-panel';
import type { ReaderFontSize, ReaderMaxWidth } from '@/hooks/ui/use-reader-preferences';

// ---------------------------------------------------------------------------
// Default props factory
// ---------------------------------------------------------------------------

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    readerHtml: '<p>Test content paragraph</p>',
    contentType: 'article' as string | null,
    title: 'Test Article Title',
    fontSize: 'medium' as ReaderFontSize,
    maxWidth: 'medium' as ReaderMaxWidth,
    onFontSizeChange: vi.fn(),
    onMaxWidthChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReaderPanel', () => {
  it('renders article content via ReaderView', () => {
    render(<ReaderPanel {...defaultProps()} />);
    expect(screen.getByTestId('reader-view')).toBeInTheDocument();
  });

  it('renders the title in the reader content area for articles', () => {
    render(<ReaderPanel {...defaultProps()} />);
    expect(screen.getByText('Test Article Title')).toBeInTheDocument();
  });

  it('renders typography controls for article content', () => {
    render(<ReaderPanel {...defaultProps()} />);
    // Font size radio group
    expect(screen.getByRole('radiogroup', { name: 'Font size' })).toBeInTheDocument();
    // Content width radio group
    expect(screen.getByRole('radiogroup', { name: 'Content width' })).toBeInTheDocument();
  });

  it('calls onFontSizeChange when font size button is clicked', async () => {
    const user = userEvent.setup();
    const onFontSizeChange = vi.fn();
    render(<ReaderPanel {...defaultProps({ onFontSizeChange })} />);

    const largeFontButton = screen.getByRole('radio', { name: 'Font size: large' });
    await user.click(largeFontButton);
    expect(onFontSizeChange).toHaveBeenCalledWith('large');
  });

  it('calls onMaxWidthChange when width button is clicked', async () => {
    const user = userEvent.setup();
    const onMaxWidthChange = vi.fn();
    render(<ReaderPanel {...defaultProps({ onMaxWidthChange })} />);

    const narrowButton = screen.getByRole('radio', { name: 'Content width: narrow' });
    await user.click(narrowButton);
    expect(onMaxWidthChange).toHaveBeenCalledWith('narrow');
  });

  it('shows close button and calls onClose when clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ReaderPanel {...defaultProps({ onClose })} />);

    const closeButton = screen.getByLabelText('Close reader');
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('hides close button when hideCloseButton is true', () => {
    render(<ReaderPanel {...defaultProps({ hideCloseButton: true })} />);
    expect(screen.queryByLabelText('Close reader')).not.toBeInTheDocument();
  });

  it('renders empty state when no reader content is available', () => {
    render(
      <ReaderPanel
        {...defaultProps({
          readerHtml: null,
          contentType: 'article',
          sourceUrl: null,
        })}
      />,
    );
    expect(
      screen.getByText('Reader view has not been processed for this content yet.'),
    ).toBeInTheDocument();
  });

  it('renders PDF-specific empty state message for PDF content without source', () => {
    render(
      <ReaderPanel
        {...defaultProps({
          readerHtml: null,
          contentType: 'pdf',
          sourceUrl: null,
          filePath: null,
        })}
      />,
    );
    expect(
      screen.getByText('Use the PDF viewer for this document.'),
    ).toBeInTheDocument();
  });

  it('renders newsletter reader card for email platform content', () => {
    render(
      <ReaderPanel
        {...defaultProps({
          platform: 'email',
          contentType: 'article',
          content: 'Newsletter body text',
        })}
      />,
    );
    expect(screen.getByTestId('newsletter-reader-card')).toBeInTheDocument();
  });

  it('renders "Open in new tab" fallback when sourceUrl exists but no readerHtml or platform card', () => {
    render(
      <ReaderPanel
        {...defaultProps({
          readerHtml: null,
          contentType: 'article',
          sourceUrl: 'https://example.com/article',
          frameable: false,
        })}
      />,
    );
    const link = screen.getByText('Open in new tab');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com/article');
    expect(link.closest('a')).toHaveAttribute('target', '_blank');
  });

  it('shows detach button when onDetachToggle is provided', () => {
    const onDetachToggle = vi.fn();
    render(<ReaderPanel {...defaultProps({ onDetachToggle })} />);
    expect(
      screen.getByLabelText('Pop out to floating window (Shift+R)'),
    ).toBeInTheDocument();
  });

  it('shows dock label when isDetached is true', () => {
    const onDetachToggle = vi.fn();
    render(<ReaderPanel {...defaultProps({ onDetachToggle, isDetached: true })} />);
    expect(
      screen.getByLabelText('Dock to split view (Shift+R)'),
    ).toBeInTheDocument();
  });
});
