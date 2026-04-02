/**
 * IngestionSuccessCard Component Tests
 *
 * Tests the success card shown after content ingestion completes.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/contexts/layer-vocabulary-context', () => ({
  useLayerVocabulary: () => ({
    layers: [
      {
        id: '1',
        key: 'sales_brief',
        label: 'Sales Brief',
        description: null,
        display_order: 1,
        is_active: true,
      },
      {
        id: '2',
        key: 'bid_detail',
        label: 'Bid Detail',
        description: null,
        display_order: 2,
        is_active: true,
      },
    ],
    loading: false,
    error: null,
    getLayerKeys: () => ['sales_brief', 'bid_detail'],
    getLayerLabel: (key: string) =>
      key === 'sales_brief'
        ? 'Sales Brief'
        : key === 'bid_detail'
          ? 'Bid Detail'
          : key,
    getLayerDescription: () => null,
    refresh: vi.fn(),
  }),
}));

import { IngestionSuccessCard } from '@/components/create-content/ingestion-success-card';

describe('IngestionSuccessCard', () => {
  const defaultProps = {
    itemId: 'abc-123',
    title: 'Security Best Practices',
    contentType: 'article',
  };

  it('renders title with correct link href', () => {
    render(<IngestionSuccessCard {...defaultProps} />);

    const titleLink = screen.getByText('Security Best Practices');
    expect(titleLink).toBeInTheDocument();
    expect(titleLink.closest('a')).toHaveAttribute('href', '/item/abc-123');
  });

  it('shows content type badge', () => {
    render(<IngestionSuccessCard {...defaultProps} />);

    expect(screen.getByText('article')).toBeInTheDocument();
  });

  it('shows content type badge with underscores replaced', () => {
    render(
      <IngestionSuccessCard
        {...defaultProps}
        contentType="product_description"
      />,
    );

    expect(screen.getByText('product description')).toBeInTheDocument();
  });

  it('shows domain badge when provided', () => {
    render(
      <IngestionSuccessCard {...defaultProps} domain="Security & Resilience" />,
    );

    expect(screen.getByText('Security & Resilience')).toBeInTheDocument();
  });

  it('shows subtopic badge when provided', () => {
    render(
      <IngestionSuccessCard
        {...defaultProps}
        subtopic="Information Security"
      />,
    );

    expect(screen.getByText('Information Security')).toBeInTheDocument();
  });

  it('shows warnings when provided', () => {
    render(
      <IngestionSuccessCard
        {...defaultProps}
        warnings={['Embedding generation failed', 'Summary timed out']}
      />,
    );

    expect(screen.getByText('Embedding generation failed')).toBeInTheDocument();
    expect(screen.getByText('Summary timed out')).toBeInTheDocument();
  });

  it('shows dedup matches when provided', () => {
    render(
      <IngestionSuccessCard
        {...defaultProps}
        dedupMatches={[
          { id: 'dup-1', title: 'Similar Article', similarity: 0.93 },
        ]}
      />,
    );

    expect(screen.getByText('Similar items found:')).toBeInTheDocument();
    expect(screen.getByText('Similar Article')).toBeInTheDocument();
    expect(screen.getByText('(93% similar)')).toBeInTheDocument();
  });

  it('renders View item and Create another buttons', () => {
    render(<IngestionSuccessCard {...defaultProps} />);

    const viewLink = screen.getByText('View item');
    expect(viewLink.closest('a')).toHaveAttribute('href', '/item/abc-123');

    const createLink = screen.getByText('Create another');
    expect(createLink.closest('a')).toHaveAttribute('href', '/item/new');
  });
});
