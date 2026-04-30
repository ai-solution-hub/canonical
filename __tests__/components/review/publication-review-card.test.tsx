/**
 * PublicationReviewCard — render tests.
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §7.
 * Card content per spec: title, domain/subtopic chips, source file,
 * classification confidence, ingest pipeline-run link, freshness signal
 * (`updated_at`), markdown preview (truncated), reuses
 * <PublicationStatusBadge />.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PublicationReviewCard } from '@/components/review/publication-review-card';
import type { ReviewQueueItem } from '@/types/review';

function makeItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Test in-review item',
    suggested_title: null,
    summary: null,
    primary_domain: 'Technical',
    primary_subtopic: 'Architecture',
    secondary_domain: null,
    secondary_subtopic: null,
    content_type: 'q_a_pair',
    platform: 'manual',
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: null,
    ai_keywords: [],
    classification_confidence: 0.87,
    quality_score: null,
    priority: null,
    user_tags: [],
    metadata: null,
    content: 'This is the body of the item awaiting publication.',
    source_url: null,
    verified_at: null,
    verified_by: null,
    freshness: null,
    governance_review_status: null,
    next_review_date: null,
    review_cadence_days: null,
    publication_status: 'in_review',
    last_reviewed_at: '2026-04-25T10:00:00Z',
    ...overrides,
  };
}

describe('PublicationReviewCard', () => {
  it('renders title, domain/subtopic chips, content type and confidence', () => {
    render(<PublicationReviewCard item={makeItem()} />);

    expect(screen.getByText('Test in-review item')).toBeInTheDocument();
    expect(screen.getByText('Technical')).toBeInTheDocument();
    expect(screen.getByText('Architecture')).toBeInTheDocument();
    // content_type is rendered with underscores replaced by spaces.
    expect(screen.getByText(/q a pair/i)).toBeInTheDocument();
    // Confidence is rounded to a percent.
    expect(screen.getByText('87%')).toBeInTheDocument();
  });

  it('renders the publication-status badge for in_review items', () => {
    render(<PublicationReviewCard item={makeItem()} />);

    // PublicationStatusBadge sets role="img" with aria-label
    // "Publication status: In Review".
    expect(
      screen.getByRole('img', { name: /publication status: in review/i }),
    ).toBeInTheDocument();
  });

  it('truncates content longer than 480 chars with an ellipsis', () => {
    const longContent = 'A'.repeat(600);
    render(<PublicationReviewCard item={makeItem({ content: longContent })} />);

    const preview = screen.getByText(/A+…$/);
    expect(preview).toBeInTheDocument();
    // 480 chars + the ellipsis.
    expect(preview.textContent?.endsWith('…')).toBe(true);
  });

  it('falls back to suggested_title when title is empty', () => {
    render(
      <PublicationReviewCard
        item={makeItem({ title: '', suggested_title: 'Suggested name' })}
      />,
    );

    expect(screen.getByText('Suggested name')).toBeInTheDocument();
  });

  it('omits provenance row when metadata has no pipeline_run_id or ingest_source', () => {
    render(<PublicationReviewCard item={makeItem({ metadata: null })} />);

    expect(screen.queryByText(/ingest source:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pipeline run:/i)).not.toBeInTheDocument();
  });

  it('surfaces ingest_source from metadata when present', () => {
    render(
      <PublicationReviewCard
        item={makeItem({
          metadata: {
            ingest_source: 'markdown-batch',
            pipeline_run_id: '22222222-2222-4222-8222-222222222222',
          },
        })}
      />,
    );

    expect(screen.getByText(/ingest source:/i)).toBeInTheDocument();
    expect(screen.getByText('markdown-batch')).toBeInTheDocument();
    expect(screen.getByText(/pipeline run:/i)).toBeInTheDocument();
    // First 8 chars of UUID rendered as fingerprint.
    expect(screen.getByText('22222222')).toBeInTheDocument();
  });
});
