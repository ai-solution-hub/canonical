/**
 * NewsletterReaderCard Component Tests
 *
 * Tests newsletter metadata display, subject line, sender info,
 * and content rendering via ReaderView or ContentRenderer fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/components/reader/reader-view', () => ({
  ReaderView: ({ html }: { html: string }) => (
    <div data-testid="reader-view">{html}</div>
  ),
}));

vi.mock('@/components/item-detail/content-renderer', () => ({
  ContentRenderer: ({ content }: { content: string }) => (
    <div data-testid="content-renderer">{content}</div>
  ),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { NewsletterReaderCard } from '@/components/reader-cards/newsletter-reader-card';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NewsletterReaderCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders newsletter name from metadata', () => {
    render(
      <NewsletterReaderCard
        content="Some content"
        readerHtml={null}
        metadata={{ newsletter_name: 'The Weekly Digest' }}
      />,
    );

    expect(screen.getByText('The Weekly Digest')).toBeInTheDocument();
  });

  it('shows email subject when available', () => {
    render(
      <NewsletterReaderCard
        content="Some content"
        readerHtml={null}
        metadata={{
          newsletter_name: 'Digest',
          email_subject: 'March Update: Key Changes',
        }}
      />,
    );

    expect(screen.getByText('March Update: Key Changes')).toBeInTheDocument();
  });

  it('shows both name and email_from when different', () => {
    render(
      <NewsletterReaderCard
        content="Some content"
        readerHtml={null}
        metadata={{
          newsletter_name: 'The Weekly Digest',
          email_from: 'editor@example.com',
        }}
      />,
    );

    expect(screen.getByText('The Weekly Digest')).toBeInTheDocument();
    expect(screen.getByText('editor@example.com')).toBeInTheDocument();
  });

  it('renders ReaderView when readerHtml is provided', () => {
    render(
      <NewsletterReaderCard
        content="Fallback content"
        readerHtml="<p>Rich HTML</p>"
        metadata={{ newsletter_name: 'Test' }}
      />,
    );

    expect(screen.getByTestId('reader-view')).toBeInTheDocument();
    expect(screen.queryByTestId('content-renderer')).not.toBeInTheDocument();
  });

  it('falls back to ContentRenderer when only content is available', () => {
    render(
      <NewsletterReaderCard
        content="Plain text content"
        readerHtml={null}
        metadata={{ newsletter_name: 'Test' }}
      />,
    );

    expect(screen.getByTestId('content-renderer')).toBeInTheDocument();
    expect(screen.queryByTestId('reader-view')).not.toBeInTheDocument();
  });
});
