/**
 * DigestDomainSection Component Tests
 *
 * Tests the digest domain section card — domain badge, summary, themes,
 * top items, and the "Review these items" link.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockGetDomainColourKey, mockFormatContentType } = vi.hoisted(() => ({
  mockGetDomainColourKey: vi.fn(() => 'corporate'),
  mockFormatContentType: vi.fn((t: string | null) => t ?? 'Unknown'),
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    getDomainColourKey: mockGetDomainColourKey,
  }),
}));

vi.mock('@/lib/format', () => ({
  formatContentType: mockFormatContentType,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: (string | undefined | null | false)[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/domain-badge', () => ({
  DomainBadge: ({ domain }: { domain: string }) => (
    <span data-testid="domain-badge">{domain}</span>
  ),
}));

vi.mock('@/components/content-type-icon', () => ({
  ContentTypeIcon: () => <span data-testid="content-type-icon" />,
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <span data-testid="badge" {...props}>{children}</span>
  ),
}));

// Import AFTER mocks
import { DigestDomainSection } from '@/components/digest-domain-section';
import type { DigestDomainSummary } from '@/types/digest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDomainSummary(overrides: Partial<DigestDomainSummary> = {}): DigestDomainSummary {
  return {
    domain: 'Corporate',
    item_count: 3,
    summary: 'Corporate domain summary text.',
    top_items: [
      { id: 'item-1', title: 'First Item', content_type: 'article' },
      { id: 'item-2', title: 'Second Item', content_type: 'policy' },
    ],
    key_themes: ['governance', 'compliance'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DigestDomainSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders domain badge and item count', () => {
    render(<DigestDomainSection domainSummary={makeDomainSummary()} />);

    expect(screen.getByTestId('domain-badge')).toHaveTextContent('Corporate');
    expect(screen.getByText('3 items')).toBeInTheDocument();
  });

  it('renders singular "item" for count of 1', () => {
    render(<DigestDomainSection domainSummary={makeDomainSummary({ item_count: 1 })} />);

    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  it('renders summary text', () => {
    render(<DigestDomainSection domainSummary={makeDomainSummary()} />);

    expect(screen.getByText('Corporate domain summary text.')).toBeInTheDocument();
  });

  it('renders key theme badges', () => {
    render(<DigestDomainSection domainSummary={makeDomainSummary()} />);

    expect(screen.getByText('governance')).toBeInTheDocument();
    expect(screen.getByText('compliance')).toBeInTheDocument();
  });

  it('renders top items as links', () => {
    render(<DigestDomainSection domainSummary={makeDomainSummary()} />);

    const firstLink = screen.getByRole('link', { name: /First Item/i });
    expect(firstLink).toHaveAttribute('href', '/item/item-1');

    const secondLink = screen.getByRole('link', { name: /Second Item/i });
    expect(secondLink).toHaveAttribute('href', '/item/item-2');
  });

  it('renders "Review these items" link pointing to review page with domain filter', () => {
    render(<DigestDomainSection domainSummary={makeDomainSummary()} />);

    const reviewLink = screen.getByRole('link', { name: /Review these items/i });
    expect(reviewLink).toBeInTheDocument();
    expect(reviewLink).toHaveAttribute('href', '/review?domain=Corporate');
  });

  it('encodes domain names with special characters in the review link', () => {
    render(
      <DigestDomainSection
        domainSummary={makeDomainSummary({ domain: 'Health & Safety' })}
      />,
    );

    const reviewLink = screen.getByRole('link', { name: /Review these items/i });
    expect(reviewLink).toHaveAttribute('href', '/review?domain=Health%20%26%20Safety');
  });

  it('renders review link even with no top items', () => {
    render(
      <DigestDomainSection
        domainSummary={makeDomainSummary({ top_items: [] })}
      />,
    );

    const reviewLink = screen.getByRole('link', { name: /Review these items/i });
    expect(reviewLink).toBeInTheDocument();
  });

  it('does not render key themes section when themes array is empty', () => {
    render(
      <DigestDomainSection
        domainSummary={makeDomainSummary({ key_themes: [] })}
      />,
    );

    // The theme badges should not be present
    expect(screen.queryByText('governance')).not.toBeInTheDocument();
  });

  it('renders why_notable text for items that have it', () => {
    render(
      <DigestDomainSection
        domainSummary={makeDomainSummary({
          top_items: [
            {
              id: 'item-1',
              title: 'Notable Item',
              content_type: 'article',
              why_notable: 'This is particularly relevant',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('This is particularly relevant')).toBeInTheDocument();
  });
});
