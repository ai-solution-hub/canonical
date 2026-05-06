/**
 * RelatedContentSection Component Tests
 *
 * Tests the consolidated related content section — heading, similar items,
 * tags section, entities container, null when empty, and aria-label.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
    publication_status: null,
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

  // The SUT runs a useEffect with queueMicrotask + MutationObserver that
  // calls setHasEntities after mount. Each test ends with this drain so the
  // resulting state update fires inside an act boundary (otherwise we get
  // "wrapped into act(...)" warnings on every render-only assertion).
  // waitFor's polling drains both microtasks and macrotasks queued after
  // render — sufficient to flush the queueMicrotask callback and any
  // observer-driven setHasEntities updates.
  async function drainEntitiesEffect() {
    await waitFor(
      () => {
        // The section element is mount-time stable; this assertion always
        // passes after the effect has run, so waitFor exits on first poll
        // having already drained pending microtasks.
        expect(document.body).toBeTruthy();
      },
      { interval: 5, timeout: 200 },
    );
    // Yield once more so the MutationObserver microtask drains.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('renders "Related Content" heading when items exist', async () => {
    render(
      <RelatedContentSection
        relatedItems={[createRelatedItem('r1', 'Related Article')]}
        itemId="item-1"
        userTags={[]}
      />,
    );
    expect(screen.getByText('Related Content')).toBeInTheDocument();
    await drainEntitiesEffect();
  });

  it('shows Similar Items section with ContentCards', async () => {
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
    await drainEntitiesEffect();
  });

  it('shows RelatedByTags when userTags is not empty', async () => {
    render(
      <RelatedContentSection
        relatedItems={[]}
        itemId="item-1"
        userTags={['compliance', 'security']}
      />,
    );
    expect(screen.getByTestId('related-by-tags')).toBeInTheDocument();
    await drainEntitiesEffect();
  });

  it('renders RelatedByEntities container', async () => {
    render(
      <RelatedContentSection relatedItems={[]} itemId="item-1" userTags={[]} />,
    );
    expect(screen.getByTestId('related-by-entities')).toBeInTheDocument();
    await drainEntitiesEffect();
  });

  it('has aria-label="Related content" on section', async () => {
    render(
      <RelatedContentSection
        relatedItems={[createRelatedItem('r1', 'Article')]}
        itemId="item-1"
        userTags={[]}
      />,
    );
    expect(screen.getByLabelText('Related content')).toBeInTheDocument();
    await drainEntitiesEffect();
  });

  it('still renders section while entities are loading (null state)', async () => {
    // With no relatedItems and no tags, section still shows because
    // entities loading state (hasEntities === null) keeps it visible
    const { container } = render(
      <RelatedContentSection relatedItems={[]} itemId="item-1" userTags={[]} />,
    );
    // The section should still render (entities loading = isEntitiesLoading = true)
    expect(container.querySelector('section')).toBeInTheDocument();
    await drainEntitiesEffect();
  });
});
