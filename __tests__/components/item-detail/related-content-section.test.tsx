/**
 * RelatedContentSection Component Tests
 *
 * Tests the consolidated related content section — heading, similar items,
 * tags section, entities container, null when empty, and aria-label.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/components/content/content-card', () => ({
  ContentCard: ({ item }: { item: { id: string; title?: string | null } }) => (
    <div data-testid={`content-card-${item.id}`}>{item.title ?? 'Card'}</div>
  ),
}));

vi.mock('@/components/item-detail/related-by-tags', () => ({
  RelatedByTags: ({ tags }: { tags: string[] }) => (
    <div data-testid="related-by-tags">Tags: {tags.join(', ')}</div>
  ),
}));

vi.mock('@/components/item-detail/related-by-entities', () => ({
  RelatedByEntities: () => (
    <div data-testid="related-by-entities">RelatedByEntities</div>
  ),
}));

import { RelatedContentSection } from '@/components/item-detail/related-content-section';
import type { ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRelatedItem(
  id: string,
  title: string,
): ContentListItem & { similarity: number } {
  return {
    id,
    title,
    suggested_title: null,
    summary: null,
    primary_domain: 'Corporate',
    primary_subtopic: null,
    content_type: 'article',
    platform: null,
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-01',
    ai_keywords: [],
    classification_confidence: null,
    priority: null,
    freshness: 'fresh',
    user_tags: [],
    governance_review_status: null,
    metadata: null,
    similarity: 0.85,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RelatedContentSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders "Related Content" heading when items exist', () => {
    render(
      <RelatedContentSection
        relatedItems={[createRelatedItem('r1', 'Related Article')]}
        itemId="item-1"
        userTags={[]}
      />,
    );
    expect(screen.getByText('Related Content')).toBeInTheDocument();
  });

  it('shows Similar Items section with ContentCards', () => {
    render(
      <RelatedContentSection
        relatedItems={[
          createRelatedItem('r1', 'First Related'),
          createRelatedItem('r2', 'Second Related'),
        ]}
        itemId="item-1"
        userTags={[]}
      />,
    );
    expect(screen.getByText('Similar Items')).toBeInTheDocument();
    expect(screen.getByTestId('content-card-r1')).toBeInTheDocument();
    expect(screen.getByTestId('content-card-r2')).toBeInTheDocument();
  });

  it('shows RelatedByTags when userTags is not empty', () => {
    render(
      <RelatedContentSection
        relatedItems={[]}
        itemId="item-1"
        userTags={['compliance', 'security']}
      />,
    );
    expect(screen.getByTestId('related-by-tags')).toBeInTheDocument();
  });

  it('renders RelatedByEntities container', () => {
    render(
      <RelatedContentSection relatedItems={[]} itemId="item-1" userTags={[]} />,
    );
    expect(screen.getByTestId('related-by-entities')).toBeInTheDocument();
  });

  it('has aria-label="Related content" on section', () => {
    render(
      <RelatedContentSection
        relatedItems={[createRelatedItem('r1', 'Article')]}
        itemId="item-1"
        userTags={[]}
      />,
    );
    expect(screen.getByLabelText('Related content')).toBeInTheDocument();
  });

  it('still renders section while entities are loading (null state)', () => {
    // With no relatedItems and no tags, section still shows because
    // entities loading state (hasEntities === null) keeps it visible
    const { container } = render(
      <RelatedContentSection relatedItems={[]} itemId="item-1" userTags={[]} />,
    );
    // The section should still render (entities loading = isEntitiesLoading = true)
    expect(container.querySelector('section')).toBeInTheDocument();
  });
});
