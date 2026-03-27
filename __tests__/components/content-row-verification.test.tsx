/**
 * ContentRow Verification Badge Tests
 *
 * Tests that the VerificationBadge in ContentRow correctly renders with
 * verifier name attribution, tooltip, and graceful fallbacks for both
 * Q&A and standard row variants.
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
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
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

vi.mock('@/components/shared/star-button', () => ({
  StarButton: ({ itemId }: { itemId: string }) => (
    <button data-testid={`star-${itemId}`}>Star</button>
  ),
}));

vi.mock('@/components/shared/thumbnail', () => ({
  ThumbnailSmall: ({ alt }: { alt: string }) => (
    <div data-testid="thumbnail-small">{alt}</div>
  ),
}));

vi.mock('@/components/shared/freshness-badge', () => ({
  FreshnessBadge: ({ freshness }: { freshness: string }) => (
    <span data-testid="freshness-badge">{freshness}</span>
  ),
}));

vi.mock('@/components/shared/similarity-badge', () => ({
  SimilarityBadge: ({ score }: { score: number }) => (
    <span data-testid="similarity-badge">{Math.round(score * 100)}%</span>
  ),
}));

vi.mock('@/components/shared/priority-selector', () => ({
  PriorityBadge: ({ priority }: { priority: string | null }) =>
    priority ? <span data-testid="priority-badge">{priority}</span> : null,
}));

vi.mock('@/components/shared/content-type-icon', () => ({
  ContentTypeIcon: ({ contentType }: { contentType: string }) => (
    <span data-testid="content-type-icon">{contentType}</span>
  ),
}));

vi.mock('@/components/shared/domain-badge', () => ({
  DomainBadge: ({ domain }: { domain: string }) => (
    <span data-testid="domain-badge">{domain}</span>
  ),
}));

vi.mock('@/lib/client-config', () => ({
  isFeatureEnabled: () => false,
  CLIENT_CONFIG: { features: {} },
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

vi.mock('@/lib/validation/layer-schemas', () => ({
  getLayerLabel: (key: string) => key,
}));

vi.mock('@/components/shared/highlight', () => ({
  highlightTerms: (text: string) => text,
}));

import { ContentRow } from '@/components/content/content-row';

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
    verified_by: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentRow — Verification Badge', () => {
  it('renders VerificationBadge when verified_at is set for standard rows', () => {
    render(
      <ContentRow
        item={makeItem({ verified_at: '2026-03-20T12:00:00Z' })}
      />,
    );
    const badges = screen.getAllByRole('img');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
  });

  it('does not render VerificationBadge when verified_at is null', () => {
    render(
      <ContentRow item={makeItem({ verified_at: null })} />,
    );
    const badges = screen.queryAllByRole('img');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeUndefined();
  });

  it('shows full attribution in title attribute for standard rows', () => {
    const verifierNames = new Map([['user-uuid-1', 'Jane Smith']]);
    render(
      <ContentRow
        item={makeItem({
          verified_at: '2026-03-20T12:00:00Z',
          verified_by: 'user-uuid-1',
        })}
        verifierNames={verifierNames}
      />,
    );
    const badges = screen.getAllByRole('img');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
    expect(verifiedBadge!.getAttribute('title')).toMatch(/Verified by Jane Smith/);
  });

  it('renders VerificationBadge for Q&A row variant', () => {
    const verifierNames = new Map([['user-uuid-1', 'Jane Smith']]);
    render(
      <ContentRow
        item={makeItem({
          content_type: 'q_a_pair',
          title: 'What is the policy?',
          content: 'The policy states...',
          verified_at: '2026-03-20T12:00:00Z',
          verified_by: 'user-uuid-1',
        })}
        verifierNames={verifierNames}
      />,
    );
    const badges = screen.getAllByRole('img');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
    expect(verifiedBadge!.getAttribute('title')).toMatch(/Verified by Jane Smith/);
  });

  it('falls back to time-only tooltip when UUID not in verifierNames', () => {
    const verifierNames = new Map([['other-uuid', 'Other Person']]);
    render(
      <ContentRow
        item={makeItem({
          verified_at: '2026-03-20T12:00:00Z',
          verified_by: 'user-uuid-1',
        })}
        verifierNames={verifierNames}
      />,
    );
    const badges = screen.getAllByRole('img');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
    // Tooltip shows relative time but no name attribution
    const title = verifiedBadge!.getAttribute('title');
    expect(title).toMatch(/Verified \d+ \w+ ago/);
    expect(title).not.toMatch(/by/);
  });

  it('shows time-only tooltip without verifierNames prop (backwards compatible)', () => {
    render(
      <ContentRow
        item={makeItem({
          verified_at: '2026-03-20T12:00:00Z',
          verified_by: 'user-uuid-1',
        })}
      />,
    );
    const badges = screen.getAllByRole('img');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
    // verifiedAt is still passed, so tooltip shows relative time
    const title = verifiedBadge!.getAttribute('title');
    expect(title).toMatch(/Verified \d+ \w+ ago/);
    expect(title).not.toMatch(/by/);
  });

  it('shows inline text "Verified" only (not full name) with tooltipOnly', () => {
    const verifierNames = new Map([['user-uuid-1', 'Jane Smith']]);
    render(
      <ContentRow
        item={makeItem({
          verified_at: '2026-03-20T12:00:00Z',
          verified_by: 'user-uuid-1',
        })}
        verifierNames={verifierNames}
      />,
    );
    const badges = screen.getAllByRole('img');
    const verifiedBadge = badges.find((el) => el.textContent?.includes('Verified'));
    expect(verifiedBadge).toBeTruthy();
    // The inline text should be just "Verified", not the full attribution
    const inlineSpans = verifiedBadge!.querySelectorAll('span');
    const textSpan = Array.from(inlineSpans).find((s) => s.textContent === 'Verified');
    expect(textSpan).toBeTruthy();
  });
});
