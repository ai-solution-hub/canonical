import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { mockTaxonomyContext } from '../helpers/mock-contexts';

// Mock taxonomy context (used by DomainBadge inside ReviewCard)
vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockTaxonomyContext(),
}));

// Mock ContentRenderer to avoid react-markdown complexity in jsdom
vi.mock('@/components/content-renderer', () => ({
  ContentRenderer: ({ content }: { content: string }) => (
    <div data-testid="content-renderer">{content}</div>
  ),
}));

import { ReviewCard } from '@/components/review-card';
import type { ReviewQueueItem } from '@/types/review';

function makeReviewItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: 'item-1',
    title: 'Default Title',
    suggested_title: null,
    ai_summary: null,
    primary_domain: 'Corporate',
    primary_subtopic: 'Company History',
    content_type: 'article',
    platform: 'web',
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-15T10:00:00Z',
    ai_keywords: null,
    classification_confidence: 0.85,
    priority: null,
    freshness: 'fresh',
    user_tags: null,
    governance_review_status: null,
    metadata: null,
    content: 'This is the review content body.',
    source_url: null,
    verified_at: null,
    verified_by: null,
    secondary_domain: null,
    secondary_subtopic: null,
    ...overrides,
  };
}

describe('ReviewCard', () => {
  it('renders the item title', () => {
    render(<ReviewCard item={makeReviewItem()} position={1} total={10} />);
    expect(screen.getByText('Default Title')).toBeInTheDocument();
  });

  it('prefers suggested_title over title', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ suggested_title: 'Better Title' })}
        position={1}
        total={5}
      />,
    );
    expect(screen.getByText('Better Title')).toBeInTheDocument();
  });

  it('shows position and total count', () => {
    render(<ReviewCard item={makeReviewItem()} position={3} total={25} />);
    expect(screen.getByText('#3 of 25')).toBeInTheDocument();
  });

  it('renders domain badge when primary_domain is set', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ primary_domain: 'Technical' })}
        position={1}
        total={1}
      />,
    );
    expect(screen.getAllByText('Technical').length).toBeGreaterThanOrEqual(1);
  });

  it('shows "No content available" when content is null', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ content: null })}
        position={1}
        total={1}
      />,
    );
    expect(screen.getByText('No content available')).toBeInTheDocument();
  });

  it('renders content body when present', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ content: 'Test content body' })}
        position={1}
        total={1}
      />,
    );
    expect(screen.getByTestId('content-renderer')).toBeInTheDocument();
  });

  it('shows high classification confidence', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ classification_confidence: 0.85 })}
        position={1}
        total={1}
      />,
    );
    // Confidence appears in context summary and/or classification section
    expect(screen.getAllByText('High (85%)').length).toBeGreaterThanOrEqual(1);
  });

  it('shows low confidence warning', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ classification_confidence: 0.3 })}
        position={1}
        total={1}
      />,
    );
    expect(screen.getAllByText('Low (30%)').length).toBeGreaterThanOrEqual(1);
  });

  it('shows secondary domain when present', () => {
    render(
      <ReviewCard
        item={makeReviewItem({
          secondary_domain: 'Technical',
          secondary_subtopic: 'Infrastructure',
        })}
        position={1}
        total={1}
      />,
    );
    expect(screen.getByText('Secondary:')).toBeInTheDocument();
  });

  it('shows verification date when verified', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ verified_at: '2026-02-20T12:00:00Z' })}
        position={1}
        total={1}
      />,
    );
    expect(screen.getByText('Verified on 20/02/2026')).toBeInTheDocument();
  });

  it('does not show verification when not verified', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ verified_at: null })}
        position={1}
        total={1}
      />,
    );
    expect(screen.queryByText(/Verified on/)).not.toBeInTheDocument();
  });

  it('shows provenance when source_file in metadata', () => {
    render(
      <ReviewCard
        item={makeReviewItem({
          metadata: { source_file: 'client-qa.docx' },
        })}
        position={1}
        total={1}
      />,
    );
    // Source file may appear in context summary and/or provenance section
    expect(screen.getAllByText('client-qa.docx').length).toBeGreaterThanOrEqual(1);
  });

  it('has correct aria-label for accessibility', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ title: 'Accessible Title' })}
        position={2}
        total={8}
      />,
    );
    expect(
      screen.getByRole('article', { name: 'Review item 2 of 8: Accessible Title' }),
    ).toBeInTheDocument();
  });

  it('hides domain badge when primary_domain is null', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ primary_domain: null })}
        position={1}
        total={1}
      />,
    );
    expect(screen.queryByText('Corporate')).not.toBeInTheDocument();
  });
});
