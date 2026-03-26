/**
 * ContentCard Verification Badge Tests
 *
 * Tests that the VerificationBadge in ContentCard correctly renders with
 * verifier name attribution, tooltip, and graceful fallbacks.
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

vi.mock('@/components/content-renderer', () => ({
  ContentRenderer: ({ content }: { content: string }) => (
    <div data-testid="content-renderer">{content}</div>
  ),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

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
// Factory
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    id: 'item-1',
    title: 'Test Article',
    suggested_title: null,
    ai_summary: 'Summary text.',
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
    classification_confidence: 0.9,
    priority: null,
    freshness: 'fresh',
    user_tags: null,
    governance_review_status: null,
    metadata: null,
    content: null,
    brief: null,
    verified_at: null,
    verified_by: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentCard — Verification Badge', () => {
  it('renders VerificationBadge when verified_at is set', () => {
    render(
      <ContentCard
        item={makeItem({ verified_at: '2026-03-20T12:00:00Z' })}
      />,
    );
    const badges = screen.getAllByRole('status');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
  });

  it('does not render VerificationBadge when verified_at is null', () => {
    render(
      <ContentCard item={makeItem({ verified_at: null })} />,
    );
    const badges = screen.queryAllByRole('status');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeUndefined();
  });

  it('shows inline text "Verified" (not full attribution) with tooltipOnly', () => {
    const verifierNames = new Map([['user-uuid-1', 'Jane Smith']]);
    render(
      <ContentCard
        item={makeItem({
          verified_at: '2026-03-20T12:00:00Z',
          verified_by: 'user-uuid-1',
        })}
        verifierNames={verifierNames}
      />,
    );
    // With tooltipOnly, inline text should just say "Verified", not "Verified by Jane Smith"
    const badges = screen.getAllByRole('status');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
    // The inline span should not contain "by Jane Smith"
    const inlineSpans = verifiedBadge!.querySelectorAll('span');
    const textSpan = Array.from(inlineSpans).find((s) => s.textContent === 'Verified');
    expect(textSpan).toBeTruthy();
  });

  it('shows full attribution in title attribute (tooltip) when verifierNames includes UUID', () => {
    const verifierNames = new Map([['user-uuid-1', 'Jane Smith']]);
    render(
      <ContentCard
        item={makeItem({
          verified_at: '2026-03-20T12:00:00Z',
          verified_by: 'user-uuid-1',
        })}
        verifierNames={verifierNames}
      />,
    );
    const badges = screen.getAllByRole('status');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
    // The title attribute should contain the full attribution
    expect(verifiedBadge!.getAttribute('title')).toMatch(/Verified by Jane Smith/);
  });

  it('falls back to time-only tooltip when UUID is not in verifierNames map', () => {
    const verifierNames = new Map([['other-uuid', 'Other Person']]);
    render(
      <ContentCard
        item={makeItem({
          verified_at: '2026-03-20T12:00:00Z',
          verified_by: 'user-uuid-1',
        })}
        verifierNames={verifierNames}
      />,
    );
    const badges = screen.getAllByRole('status');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
    // Tooltip shows relative time but no name attribution
    const title = verifiedBadge!.getAttribute('title');
    expect(title).toMatch(/Verified \d+ \w+ ago/);
    expect(title).not.toMatch(/by/);
  });

  it('renders VerificationBadge for Q&A pair cards', () => {
    render(
      <ContentCard
        item={makeItem({
          content_type: 'q_a_pair',
          title: 'What is the policy?',
          content: 'The policy states...',
          verified_at: '2026-03-20T12:00:00Z',
          verified_by: 'user-uuid-1',
        })}
        verifierNames={new Map([['user-uuid-1', 'Jane Smith']])}
      />,
    );
    const badges = screen.getAllByRole('status');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
    expect(verifiedBadge!.getAttribute('title')).toMatch(/Verified by Jane Smith/);
  });

  it('renders VerificationBadge for compact card types', () => {
    render(
      <ContentCard
        item={makeItem({
          content_type: 'policy',
          title: 'Data Protection Policy',
          verified_at: '2026-03-20T12:00:00Z',
          verified_by: 'user-uuid-2',
        })}
        verifierNames={new Map([['user-uuid-2', 'Bob Jones']])}
      />,
    );
    const badges = screen.getAllByRole('status');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
    expect(verifiedBadge!.getAttribute('title')).toMatch(/Verified by Bob Jones/);
  });

  it('shows time-only tooltip without verifierNames prop (backwards compatible)', () => {
    render(
      <ContentCard
        item={makeItem({
          verified_at: '2026-03-20T12:00:00Z',
          verified_by: 'user-uuid-1',
        })}
      />,
    );
    const badges = screen.getAllByRole('status');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
    // verifiedAt is still passed, so tooltip shows relative time
    const title = verifiedBadge!.getAttribute('title');
    expect(title).toMatch(/Verified \d+ \w+ ago/);
    expect(title).not.toMatch(/by/);
  });
});
