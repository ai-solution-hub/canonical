import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { mockTaxonomyContext } from '../helpers/mock-contexts';

// Mock taxonomy context (used by DomainBadge inside ReviewCard)
vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockTaxonomyContext(),
}));

// Mock ContentRenderer to avoid react-markdown complexity in jsdom
vi.mock('@/components/item-detail/content-renderer', () => ({
  ContentRenderer: ({ content }: { content: string }) => (
    <div data-testid="content-renderer">{content}</div>
  ),
}));

// Mock useDisplayNames for verification badge name resolution
vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: () => new Map<string, string>(),
}));

// Mock ReviewHistorySection to isolate ReviewCard tests
vi.mock('@/components/review/review-history-section', () => ({
  ReviewHistorySection: ({
    history,
    isLoading,
  }: {
    history: unknown[];
    isLoading?: boolean;
  }) => (
    <div
      data-testid="review-history-section"
      data-loading={isLoading ? 'true' : 'false'}
    >
      {history.length > 0 && (
        <span data-testid="history-count">{history.length} entries</span>
      )}
    </div>
  ),
}));

import { ReviewCard } from '@/components/review/review-card';
import type { ReviewQueueItem } from '@/types/review';
import type { ReviewHistoryEntry } from '@/hooks/review/use-review-history';

function makeReviewItem(
  overrides: Partial<ReviewQueueItem> = {},
): ReviewQueueItem {
  return {
    id: 'item-1',
    title: 'Default Title',
    suggested_title: null,
    summary: null,
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
    source_file: undefined,
    verified_at: null,
    verified_by: null,
    secondary_domain: null,
    secondary_subtopic: null,
    quality_score: null,
    last_reviewed_at: null,
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
    expect(screen.getAllByText('High').length).toBeGreaterThanOrEqual(1);
  });

  it('shows low confidence warning', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ classification_confidence: 0.3 })}
        position={1}
        total={1}
      />,
    );
    expect(screen.getAllByText('Low').length).toBeGreaterThanOrEqual(1);
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

  it('shows verification status when verified', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ verified_at: '2026-02-20T12:00:00Z' })}
        position={1}
        total={1}
      />,
    );
    // VerificationBadge renders with role="img" by default (liveRegion=false)
    const imgElements = screen.getAllByRole('img');
    const verifiedBadge = imgElements.find((el) =>
      el.textContent?.includes('Verified'),
    );
    expect(verifiedBadge).toBeTruthy();
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

  it('shows provenance when source_file is set', () => {
    render(
      <ReviewCard
        item={makeReviewItem({
          source_file: 'client-qa.docx',
          metadata: { source_file: 'client-qa.docx' },
        })}
        position={1}
        total={1}
      />,
    );
    // Source file may appear in context summary and/or provenance section
    expect(screen.getAllByText('client-qa.docx').length).toBeGreaterThanOrEqual(
      1,
    );
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
      screen.getByRole('article', {
        name: 'Review item 2 of 8: Accessible Title',
      }),
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

// ─── GovernanceBadge surfacing (P0-12) ──────────────────────────────────────

describe('ReviewCard — GovernanceBadge surfacing', () => {
  it('renders GovernanceBadge "Draft" when governance_review_status is "draft"', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ governance_review_status: 'draft' })}
        position={1}
        total={1}
      />,
    );
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('renders GovernanceBadge "Review Pending" when governance_review_status is "pending"', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ governance_review_status: 'pending' })}
        position={1}
        total={1}
      />,
    );
    expect(screen.getByText('Review Pending')).toBeInTheDocument();
  });

  it('renders GovernanceBadge "Approved" when governance_review_status is "approved"', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ governance_review_status: 'approved' })}
        position={1}
        total={1}
      />,
    );
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('does not render GovernanceBadge when governance_review_status is null', () => {
    render(
      <ReviewCard
        item={makeReviewItem({ governance_review_status: null })}
        position={1}
        total={1}
      />,
    );
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
    expect(screen.queryByText('Review Pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
  });

  it('does not render duplicate "Governance review pending" micro-warning', () => {
    render(
      <ReviewCard
        item={makeReviewItem({
          governance_review_status: 'pending',
          summary: 'Some summary',
        })}
        position={1}
        total={1}
      />,
    );
    // The duplicate micro-warning text has been replaced by the header badge
    expect(
      screen.queryByText('Governance review pending'),
    ).not.toBeInTheDocument();
  });
});

// Low-confidence badge removed per P0-3b AI-visibility policy —
// classification confidence is admin-only data visible at /provenance.

// ─── Review history prop tests ──────────────────────────────────────────────

function makeHistoryEntry(
  overrides: Partial<ReviewHistoryEntry> = {},
): ReviewHistoryEntry {
  return {
    id: 'history-1',
    flag_type: 'review_needed',
    severity: 'warning',
    details: { notes: 'Needs attention' },
    resolution_notes: null,
    created_at: '2026-03-20T10:00:00Z',
    created_by: 'user-1',
    created_by_name: 'Alice Smith',
    resolved: false,
    resolved_at: null,
    resolved_by: null,
    resolved_by_name: null,
    ...overrides,
  };
}

describe('ReviewCard — review history props', () => {
  it('renders ReviewHistorySection when reviewHistory has entries', () => {
    const history = [makeHistoryEntry(), makeHistoryEntry({ id: 'history-2' })];

    render(
      <ReviewCard
        item={makeReviewItem()}
        position={1}
        total={5}
        reviewHistory={history}
      />,
    );

    expect(screen.getByTestId('review-history-section')).toBeInTheDocument();
    expect(screen.getByTestId('history-count')).toHaveTextContent('2 entries');
  });

  it('shows loading state when reviewHistoryLoading is true', () => {
    render(
      <ReviewCard
        item={makeReviewItem()}
        position={1}
        total={5}
        reviewHistoryLoading={true}
      />,
    );

    const section = screen.getByTestId('review-history-section');
    expect(section).toBeInTheDocument();
    expect(section).toHaveAttribute('data-loading', 'true');
  });

  it('does not render history section when reviewHistory is undefined', () => {
    render(<ReviewCard item={makeReviewItem()} position={1} total={5} />);

    expect(
      screen.queryByTestId('review-history-section'),
    ).not.toBeInTheDocument();
  });

  it('does not render history section when reviewHistory is empty and not loading', () => {
    render(
      <ReviewCard
        item={makeReviewItem()}
        position={1}
        total={5}
        reviewHistory={[]}
        reviewHistoryLoading={false}
      />,
    );

    expect(
      screen.queryByTestId('review-history-section'),
    ).not.toBeInTheDocument();
  });

  it('passes history data through to ReviewHistorySection correctly', () => {
    const history = [
      makeHistoryEntry({ id: 'h-1', flag_type: 'classification_low' }),
      makeHistoryEntry({ id: 'h-2', flag_type: 'short_content' }),
      makeHistoryEntry({ id: 'h-3', flag_type: 'duplicate_candidate' }),
    ];

    render(
      <ReviewCard
        item={makeReviewItem()}
        position={1}
        total={5}
        reviewHistory={history}
      />,
    );

    expect(screen.getByTestId('history-count')).toHaveTextContent('3 entries');
  });

  it('renders history section when loading even with no history data', () => {
    render(
      <ReviewCard
        item={makeReviewItem()}
        position={1}
        total={5}
        reviewHistory={[]}
        reviewHistoryLoading={true}
      />,
    );

    const section = screen.getByTestId('review-history-section');
    expect(section).toBeInTheDocument();
    expect(section).toHaveAttribute('data-loading', 'true');
  });

  it('sets loading to false when history is loaded', () => {
    const history = [makeHistoryEntry()];

    render(
      <ReviewCard
        item={makeReviewItem()}
        position={1}
        total={5}
        reviewHistory={history}
        reviewHistoryLoading={false}
      />,
    );

    const section = screen.getByTestId('review-history-section');
    expect(section).toHaveAttribute('data-loading', 'false');
  });
});
