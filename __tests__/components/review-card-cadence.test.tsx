/**
 * ReviewCard — days-since-review display tests.
 *
 * Tests the "Last reviewed X days ago" and "Never reviewed" indicators
 * added to the review card.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import { ReviewCard } from '@/components/review/review-card';
import type { ReviewQueueItem } from '@/types/review';

// ---------------------------------------------------------------------------
// Deterministic time — pin Date.now() to a fixed value so the component's
// useState(() => Date.now()) and our daysAgo() helper use the same reference.
// We avoid vi.useFakeTimers() because it breaks React scheduler/useState.
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2026-02-15T12:00:00.000Z').getTime();
let dateNowSpy: ReturnType<typeof vi.spyOn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(days: number): string {
  // Subtract an extra 2 hours so Math.floor always produces exactly `days`,
  // even if there's tiny floating-point drift.
  const buffer = 2 * 60 * 60 * 1000;
  return new Date(FIXED_NOW - days * 24 * 60 * 60 * 1000 - buffer).toISOString();
}

function makeReviewItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Test Item',
    suggested_title: 'Test Title',
    ai_summary: 'A test summary',
    primary_domain: 'Technology',
    primary_subtopic: 'AI',
    content_type: 'article',
    platform: 'web',
    author_name: 'Author',
    source_domain: 'example.com',
    thumbnail_url: null,
    captured_date: '2026-01-01',
    ai_keywords: ['test'],
    classification_confidence: 0.9,
    priority: 'medium',
    freshness: 'fresh',
    user_tags: [],
    governance_review_status: null,
    metadata: null,
    content: 'Some content text',
    source_url: 'https://example.com',
    verified_at: null,
    verified_by: null,
    last_reviewed_at: null,
    secondary_domain: null,
    secondary_subtopic: null,
    quality_score: 72,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewCard — days since review', () => {
  beforeEach(() => {
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it('shows "Never reviewed" when verified_at is null', () => {
    const item = makeReviewItem({ verified_at: null });
    render(<ReviewCard item={item} position={1} total={10} />);

    expect(screen.getByText('Never reviewed')).toBeInTheDocument();
  });

  it('shows "Reviewed today" when verified_at is today', () => {
    const item = makeReviewItem({ verified_at: new Date(FIXED_NOW).toISOString() });
    render(<ReviewCard item={item} position={1} total={10} />);

    expect(screen.getByText('Reviewed today')).toBeInTheDocument();
  });

  it('shows "Last reviewed 1 day ago" for yesterday', () => {
    const item = makeReviewItem({ verified_at: daysAgo(1) });
    render(<ReviewCard item={item} position={1} total={10} />);

    expect(screen.getByText('Last reviewed 1 day ago')).toBeInTheDocument();
  });

  it('shows "Last reviewed X days ago" for multiple days', () => {
    const item = makeReviewItem({ verified_at: daysAgo(30) });
    render(<ReviewCard item={item} position={1} total={10} />);

    expect(screen.getByText('Last reviewed 30 days ago')).toBeInTheDocument();
  });

  it('applies overdue styling when > 90 days since review', () => {
    const item = makeReviewItem({ verified_at: daysAgo(120) });
    render(<ReviewCard item={item} position={1} total={10} />);

    const daysText = screen.getByText('Last reviewed 120 days ago');
    // The overdue class should be on the parent span
    expect(daysText.className).toContain('text-bid-overdue');
  });

  it('does not apply overdue styling when <= 90 days since review', () => {
    const item = makeReviewItem({ verified_at: daysAgo(30) });
    render(<ReviewCard item={item} position={1} total={10} />);

    const daysText = screen.getByText('Last reviewed 30 days ago');
    expect(daysText.className).not.toContain('text-bid-overdue');
    expect(daysText.className).toContain('text-muted-foreground');
  });

  it('still shows verification badge alongside days-since-review', () => {
    const item = makeReviewItem({ verified_at: daysAgo(5) });
    render(<ReviewCard item={item} position={1} total={10} />);

    // Should show both the VerificationBadge (role="img") and "Last reviewed X days ago"
    const imgElements = screen.getAllByRole('img');
    const verifiedBadge = imgElements.find((el) =>
      el.textContent?.includes('Verified'),
    );
    expect(verifiedBadge).toBeTruthy();
    expect(screen.getByText('Last reviewed 5 days ago')).toBeInTheDocument();
  });
});
