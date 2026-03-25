/**
 * WP4: ContentCard Component Tests
 *
 * Tests the ContentCard component — the most-viewed component in browse.
 * Covers Q&A-specific rendering, read state styling, quality flag indicators,
 * thumbnail logic, and domain badge.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ContentListItem } from '@/types/content';
import { mockTaxonomyContext } from '../helpers/mock-contexts';

// Mock taxonomy context (used by DomainBadge inside ContentCard)
vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockTaxonomyContext(),
}));

// Mock ContentRenderer to avoid react-markdown complexity in jsdom
vi.mock('@/components/content-renderer', () => ({
  ContentRenderer: ({ content }: { content: string }) => (
    <div data-testid="content-renderer">{content}</div>
  ),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock layer vocabulary context (used by LayerBadge inside ContentCard)
vi.mock('@/contexts/layer-vocabulary-context', () => ({
  useLayerVocabulary: () => ({
    layers: [],
    loading: false,
    error: null,
    getLayerKeys: () => [],
    getLayerLabel: (key: string) => key,
    getLayerDescription: () => '',
    refresh: vi.fn(),
  }),
}));

import { ContentCard } from '@/components/content-card';

// ---------------------------------------------------------------------------
// Mock data factory
// ---------------------------------------------------------------------------

function makeContentItem(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    id: 'item-1',
    title: 'Default Article Title',
    suggested_title: null,
    ai_summary: 'This is an AI-generated summary.',
    primary_domain: 'Corporate',
    primary_subtopic: 'Company History',
    content_type: 'article',
    platform: 'web',
    author_name: null,
    source_domain: null,
    source_document: null,
    thumbnail_url: null,
    captured_date: '2026-01-15T10:00:00Z',
    ai_keywords: null,
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

describe('ContentCard', () => {
  it('renders the title', () => {
    render(<ContentCard item={makeContentItem()} />);
    expect(screen.getAllByText('Default Article Title').length).toBeGreaterThanOrEqual(1);
  });

  it('prefers suggested_title over title', () => {
    render(
      <ContentCard
        item={makeContentItem({ suggested_title: 'Better Title' })}
      />,
    );
    expect(screen.getAllByText('Better Title').length).toBeGreaterThanOrEqual(1);
  });

  // ── Q&A pair card ──

  it('shows Q: prefix for Q&A pair cards', () => {
    render(
      <ContentCard
        item={makeContentItem({
          content_type: 'q_a_pair',
          title: 'What is the company policy?',
          content: 'The policy states that...',
        })}
      />,
    );
    expect(screen.getByText('Q:')).toBeInTheDocument();
  });

  it('shows answer preview for Q&A pair cards', () => {
    render(
      <ContentCard
        item={makeContentItem({
          content_type: 'q_a_pair',
          title: 'What is the company policy?',
          content: 'The answer is clearly defined in section 3.',
        })}
      />,
    );
    expect(screen.getByText(/A:/)).toBeInTheDocument();
    expect(screen.getByText(/The answer is clearly defined/)).toBeInTheDocument();
  });

  it('shows source document for Q&A pair cards', () => {
    render(
      <ContentCard
        item={makeContentItem({
          content_type: 'q_a_pair',
          title: 'Test question?',
          content: 'Test answer',
          source_document: 'client-qa.docx',
        })}
      />,
    );
    expect(screen.getByText('client-qa.docx')).toBeInTheDocument();
  });

  it('does not render thumbnail for Q&A pair cards', () => {
    render(
      <ContentCard
        item={makeContentItem({
          content_type: 'q_a_pair',
          thumbnail_url: 'https://example.com/thumb.jpg',
        })}
      />,
    );
    // Q&A pairs are compact types — no Thumbnail component
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  // ── Standard article card ──

  it('shows summary text for non-Q&A cards', () => {
    render(
      <ContentCard
        item={makeContentItem({
          ai_summary: 'A comprehensive overview of company policy.',
        })}
      />,
    );
    expect(
      screen.getByText('A comprehensive overview of company policy.'),
    ).toBeInTheDocument();
  });

  // ── Compact content types ──

  it('renders compact card for case_study content type', () => {
    const { container } = render(
      <ContentCard
        item={makeContentItem({
          content_type: 'case_study',
          title: 'Case Study: Project X',
        })}
      />,
    );
    expect(screen.getByText('Case Study: Project X')).toBeInTheDocument();
    // Compact types have 4px left border
    const link = container.querySelector('a');
    expect(link?.style.borderLeftWidth).toBe('4px');
  });

  it('renders compact card for policy content type', () => {
    render(
      <ContentCard
        item={makeContentItem({
          content_type: 'policy',
          title: 'Data Protection Policy',
        })}
      />,
    );
    expect(screen.getByText('Data Protection Policy')).toBeInTheDocument();
  });

  // ── Quality flag indicator ──

  it('shows quality flag when hasQualityFlag is true', () => {
    render(
      <ContentCard
        item={makeContentItem()}
        hasQualityFlag={true}
      />,
    );
    expect(screen.getByText('Quality')).toBeInTheDocument();
  });

  it('does not show quality flag when hasQualityFlag is false', () => {
    render(
      <ContentCard
        item={makeContentItem()}
        hasQualityFlag={false}
      />,
    );
    expect(screen.queryByText('Quality')).not.toBeInTheDocument();
  });

  // ── Read state ──

  it('applies muted opacity when isRead is true', () => {
    const { container } = render(
      <ContentCard item={makeContentItem()} isRead={true} />,
    );
    const link = container.querySelector('a');
    expect(link?.className).toContain('opacity-75');
  });

  it('does not apply muted opacity when isRead is false', () => {
    const { container } = render(
      <ContentCard item={makeContentItem()} isRead={false} />,
    );
    const link = container.querySelector('a');
    expect(link?.className).not.toContain('opacity-75');
  });

  it('shows unread dot when isRead is false', () => {
    render(<ContentCard item={makeContentItem()} isRead={false} />);
    expect(screen.getByLabelText('Unread')).toBeInTheDocument();
  });

  // ── Domain badge ──

  it('renders domain badge with correct domain name', () => {
    render(
      <ContentCard
        item={makeContentItem({ primary_domain: 'Technical' })}
      />,
    );
    expect(screen.getByText('Technical')).toBeInTheDocument();
  });

  // ── Governance badge ──

  it('shows governance badge when status is pending', () => {
    render(
      <ContentCard
        item={makeContentItem({ governance_review_status: 'pending' })}
      />,
    );
    // GovernanceBadge in compact mode renders icon-only with aria-label
    expect(screen.getByLabelText('Review Pending')).toBeInTheDocument();
  });

  // ── Links ──

  it('links to the item detail page', () => {
    const { container } = render(
      <ContentCard item={makeContentItem({ id: 'item-123' })} />,
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/item/item-123');
  });

  // ── Simplified quality tooltip ──

  it('passes simplified tooltip to QualityBadge when simplifiedQuality is true', () => {
    const { container } = render(
      <ContentCard item={makeContentItem()} simplifiedQuality />,
    );
    // QualityBadge renders with a title attribute — simplified shows "Quality: {label}"
    const qualityBadge = container.querySelector('[title^="Quality:"]');
    expect(qualityBadge).toBeInTheDocument();
    expect(qualityBadge?.getAttribute('title')).toMatch(/^Quality: /);
  });

  it('shows full breakdown tooltip when simplifiedQuality is false', () => {
    const { container } = render(
      <ContentCard item={makeContentItem()} simplifiedQuality={false} />,
    );
    // Full breakdown title starts with "Freshness:"
    const qualityBadge = container.querySelector('[title^="Freshness:"]');
    expect(qualityBadge).toBeInTheDocument();
  });

  it('shows full breakdown tooltip when simplifiedQuality is omitted', () => {
    const { container } = render(
      <ContentCard item={makeContentItem()} />,
    );
    // Default (no simplified prop) should show full breakdown
    const qualityBadge = container.querySelector('[title^="Freshness:"]');
    expect(qualityBadge).toBeInTheDocument();
  });
});
