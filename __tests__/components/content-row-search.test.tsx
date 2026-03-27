/**
 * ContentRow Search Mode Tests
 *
 * Tests the Q&A badge on ContentRow when items are SearchResults, and the
 * content snippet for standard (non-Q&A) rows that shows ai_summary/brief
 * instead of the content type + platform fallback.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ContentListItem, SearchResult } from '@/types/content';
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
// Factory helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    id: 'item-1',
    title: 'Default Article Title',
    suggested_title: null,
    ai_summary: null,
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
    ...overrides,
  };
}

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    ...makeItem(),
    similarity: 0.85,
    snippet: 'A matching snippet from the content.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentRow — search mode features', () => {
  describe('Q&A badge in search mode', () => {
    it('shows Q&A badge for Q&A pair SearchResults', () => {
      render(
        <ContentRow
          item={makeSearchResult({
            content_type: 'q_a_pair',
            title: 'What is the company policy?',
            content: 'The policy states that...',
          })}
        />,
      );
      expect(screen.getByText('Q&A')).toBeInTheDocument();
    });

    it('does not show Q&A badge for Q&A pair non-search items', () => {
      render(
        <ContentRow
          item={makeItem({
            content_type: 'q_a_pair',
            title: 'What is the company policy?',
            content: 'The policy states that...',
          })}
        />,
      );
      expect(screen.queryByText('Q&A')).not.toBeInTheDocument();
    });

    it('does not show Q&A badge for non-Q&A SearchResults', () => {
      render(
        <ContentRow
          item={makeSearchResult({
            content_type: 'article',
            title: 'An article about policies',
          })}
        />,
      );
      // Q&A badge only appears in the Q&A row branch
      expect(screen.queryByText('Q&A')).not.toBeInTheDocument();
    });

    it('shows Q&A badge alongside domain badge and similarity badge', () => {
      render(
        <ContentRow
          item={makeSearchResult({
            content_type: 'q_a_pair',
            title: 'Test Q&A?',
            content: 'Test answer',
            primary_domain: 'Technical',
            similarity: 0.92,
          })}
        />,
      );
      expect(screen.getByText('Q&A')).toBeInTheDocument();
      expect(screen.getByTestId('domain-badge')).toHaveTextContent('Technical');
      expect(screen.getByTestId('similarity-badge')).toHaveTextContent('92%');
    });
  });

  describe('content snippets for non-Q&A standard rows', () => {
    it('shows ai_summary as snippet when available and not a search result', () => {
      render(
        <ContentRow
          item={makeItem({
            ai_summary: 'A comprehensive overview of data protection measures.',
          })}
        />,
      );
      expect(
        screen.getByText('A comprehensive overview of data protection measures.'),
      ).toBeInTheDocument();
    });

    it('shows brief over ai_summary when both are available', () => {
      render(
        <ContentRow
          item={makeItem({
            brief: 'Brief summary of the article.',
            ai_summary: 'AI-generated summary of the article.',
          })}
        />,
      );
      expect(screen.getByText('Brief summary of the article.')).toBeInTheDocument();
      expect(screen.queryByText('AI-generated summary of the article.')).not.toBeInTheDocument();
    });

    it('falls back to content type + platform when no summary exists', () => {
      render(
        <ContentRow
          item={makeItem({
            ai_summary: null,
            brief: null,
            content_type: 'article',
            platform: 'web',
            author_name: 'John Smith',
          })}
        />,
      );
      expect(screen.getByText('Article')).toBeInTheDocument();
      expect(screen.getByText('web')).toBeInTheDocument();
      expect(screen.getByText('John Smith')).toBeInTheDocument();
    });

    it('shows search snippet for SearchResult items instead of ai_summary', () => {
      render(
        <ContentRow
          item={makeSearchResult({
            content_type: 'article',
            ai_summary: 'This should not appear.',
            snippet: 'This is the search snippet.',
          })}
        />,
      );
      expect(screen.getByText(/This is the search snippet/)).toBeInTheDocument();
      expect(screen.queryByText('This should not appear.')).not.toBeInTheDocument();
    });
  });
});
