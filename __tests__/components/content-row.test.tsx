/**
 * ContentRow Component Tests
 *
 * Tests the ContentRow component — the list-view row for content items.
 * Covers standard article rendering, Q&A pair rendering, domain badges,
 * date formatting, priority indicators, and missing field handling.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ContentListItem } from '@/types/content';
import { mockTaxonomyContext } from '../helpers/mock-contexts';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockTaxonomyContext(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => <a href={href as string} {...props}>{children as React.ReactNode}</a>,
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...props} />,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock StarButton — uses Supabase client internally
vi.mock('@/components/star-button', () => ({
  StarButton: ({ itemId }: { itemId: string }) => (
    <button data-testid={`star-${itemId}`}>Star</button>
  ),
}));

// Mock ThumbnailSmall — uses Image and taxonomy context
vi.mock('@/components/thumbnail', () => ({
  ThumbnailSmall: ({ alt }: { alt: string }) => (
    <div data-testid="thumbnail-small">{alt}</div>
  ),
}));

// Mock FreshnessBadge
vi.mock('@/components/freshness-badge', () => ({
  FreshnessBadge: ({ freshness }: { freshness: string }) => (
    <span data-testid="freshness-badge">{freshness}</span>
  ),
}));

// Mock SimilarityBadge
vi.mock('@/components/similarity-badge', () => ({
  SimilarityBadge: ({ score }: { score: number }) => (
    <span data-testid="similarity-badge">{Math.round(score * 100)}%</span>
  ),
}));

// Mock PriorityBadge
vi.mock('@/components/priority-selector', () => ({
  PriorityBadge: ({ priority }: { priority: string | null }) =>
    priority ? <span data-testid="priority-badge">{priority}</span> : null,
}));

// Mock ContentTypeIcon
vi.mock('@/components/content-type-icon', () => ({
  ContentTypeIcon: ({ contentType }: { contentType: string }) => (
    <span data-testid="content-type-icon">{contentType}</span>
  ),
}));

// Mock DomainBadge — keep simple render of domain name
vi.mock('@/components/domain-badge', () => ({
  DomainBadge: ({ domain }: { domain: string }) => (
    <span data-testid="domain-badge">{domain}</span>
  ),
}));

// Mock client-config
vi.mock('@/lib/client-config', () => ({
  isFeatureEnabled: () => false,
  CLIENT_CONFIG: { layer_vocabulary: [] },
}));

// Mock validation/layer-schemas
vi.mock('@/lib/validation/layer-schemas', () => ({
  getLayerLabel: (key: string) => key,
}));

// Mock highlight — pass through text unchanged
vi.mock('@/lib/highlight', () => ({
  highlightTerms: (text: string) => text,
}));

// Import AFTER mocks
import { ContentRow } from '@/components/content-row';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    id: 'item-1',
    title: 'Default Article Title',
    suggested_title: null,
    ai_summary: 'This is an AI-generated summary.',
    primary_domain: 'Corporate',
    primary_subtopic: 'Company History',
    content_type: 'article',
    platform: 'web',
    author_name: 'John Smith',
    source_domain: null,
    source_document: null,
    thumbnail_url: null,
    captured_date: '2026-01-15T10:00:00Z',
    ai_keywords: null,
    classification_confidence: 0.92,
    priority: null,
    freshness: 'fresh',
    user_tags: null,
    governance_review_status: null,
    metadata: null,
    content: null,
    brief: null,
    verified_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentRow', () => {
  it('renders title text', () => {
    render(<ContentRow item={makeItem()} />);
    // Title appears in both the thumbnail alt mock and the row text
    expect(screen.getAllByText('Default Article Title').length).toBeGreaterThanOrEqual(1);
  });

  it('prefers suggested_title over title', () => {
    render(
      <ContentRow
        item={makeItem({ suggested_title: 'Better Title' })}
      />,
    );
    expect(screen.getAllByText('Better Title').length).toBeGreaterThanOrEqual(1);
  });

  it('renders domain badge', () => {
    render(<ContentRow item={makeItem({ primary_domain: 'Technical' })} />);
    expect(screen.getByTestId('domain-badge')).toHaveTextContent('Technical');
  });

  it('renders content type in metadata line for standard items', () => {
    render(<ContentRow item={makeItem({ content_type: 'article' })} />);
    // formatContentType('article') returns 'Article'; parts are in separate spans with middot separators
    expect(screen.getByText('Article')).toBeInTheDocument();
    expect(screen.getByText('web')).toBeInTheDocument();
    expect(screen.getByText('John Smith')).toBeInTheDocument();
  });

  it('shows date in correct format', () => {
    render(<ContentRow item={makeItem({ captured_date: '2026-01-15T10:00:00Z' })} />);
    // formatDate returns "15 Jan 2026"
    expect(screen.getByText('15 Jan 2026')).toBeInTheDocument();
  });

  it('shows priority indicator when set', () => {
    render(<ContentRow item={makeItem({ priority: 'high' })} />);
    expect(screen.getByTestId('priority-badge')).toHaveTextContent('high');
  });

  it('does not show priority indicator when null', () => {
    render(<ContentRow item={makeItem({ priority: null })} />);
    expect(screen.queryByTestId('priority-badge')).not.toBeInTheDocument();
  });

  it('renders as link to item detail page', () => {
    const { container } = render(
      <ContentRow item={makeItem({ id: 'item-123' })} />,
    );
    const link = container.querySelector('a');
    expect(link).toHaveAttribute('href', '/item/item-123');
  });

  // ── Q&A-specific rendering ──

  it('shows Q: prefix for q_a_pair content type', () => {
    render(
      <ContentRow
        item={makeItem({
          content_type: 'q_a_pair',
          title: 'What is the company policy?',
          content: 'The policy covers data protection.',
        })}
      />,
    );
    expect(screen.getByText(/Q:/)).toBeInTheDocument();
  });

  it('shows A: prefix and answer snippet for Q&A pairs', () => {
    render(
      <ContentRow
        item={makeItem({
          content_type: 'q_a_pair',
          title: 'What is the company policy?',
          content: 'The policy covers data protection.',
        })}
      />,
    );
    expect(screen.getByText('A:')).toBeInTheDocument();
    expect(screen.getByText(/The policy covers data protection/)).toBeInTheDocument();
  });

  it('shows copy button for Q&A pairs with answer content', () => {
    render(
      <ContentRow
        item={makeItem({
          content_type: 'q_a_pair',
          title: 'Test question?',
          content: 'Test answer text',
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Copy answer to clipboard' })).toBeInTheDocument();
  });

  // ── Missing optional fields ──

  it('handles missing captured_date gracefully', () => {
    render(<ContentRow item={makeItem({ captured_date: null })} />);
    // Should render without crashing; title still present
    expect(screen.getAllByText('Default Article Title').length).toBeGreaterThanOrEqual(1);
  });

  it('handles missing primary_domain gracefully', () => {
    render(<ContentRow item={makeItem({ primary_domain: null })} />);
    // Should still render the row without crashing
    expect(screen.getAllByText('Default Article Title').length).toBeGreaterThanOrEqual(1);
  });

  // ── Quality flag ──

  it('shows quality flag icon when hasQualityFlag is true', () => {
    render(<ContentRow item={makeItem()} hasQualityFlag={true} />);
    expect(screen.getByLabelText('Has quality issues')).toBeInTheDocument();
  });

  it('does not show quality flag when hasQualityFlag is false', () => {
    render(<ContentRow item={makeItem()} hasQualityFlag={false} />);
    expect(screen.queryByLabelText('Has quality issues')).not.toBeInTheDocument();
  });
});
