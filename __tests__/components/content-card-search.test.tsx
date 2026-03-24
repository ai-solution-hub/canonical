/**
 * ContentCard Search Mode Tests
 *
 * Tests the Q&A badge that appears on ContentCard when items are SearchResults
 * (i.e., have a `similarity` field). Verifies the badge appears only in search
 * mode and not for regular browse items.
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
// Factory helpers
// ---------------------------------------------------------------------------

function makeContentItem(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    id: 'item-1',
    title: 'Default Article Title',
    suggested_title: null,
    ai_summary: 'This is an AI-generated summary.',
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
    ...makeContentItem(),
    similarity: 0.85,
    snippet: 'A matching snippet from the content.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentCard — search mode features', () => {
  describe('Q&A badge in search mode', () => {
    it('shows Q&A badge for Q&A pair SearchResults', () => {
      render(
        <ContentCard
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
        <ContentCard
          item={makeContentItem({
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
        <ContentCard
          item={makeSearchResult({
            content_type: 'article',
            title: 'An article about policies',
          })}
        />,
      );
      // The Q&A badge is only in the Q&A card branch
      expect(screen.queryByText('Q&A')).not.toBeInTheDocument();
    });

    it('renders Q&A badge alongside domain badge', () => {
      render(
        <ContentCard
          item={makeSearchResult({
            content_type: 'q_a_pair',
            title: 'Test Q&A?',
            content: 'Test answer',
            primary_domain: 'Technical',
          })}
        />,
      );
      expect(screen.getByText('Q&A')).toBeInTheDocument();
      expect(screen.getByText('Technical')).toBeInTheDocument();
    });
  });

  describe('search result rendering', () => {
    it('still shows Q: prefix for Q&A search results', () => {
      render(
        <ContentCard
          item={makeSearchResult({
            content_type: 'q_a_pair',
            title: 'What is our data policy?',
            content: 'Our data policy covers...',
          })}
        />,
      );
      expect(screen.getByText('Q:')).toBeInTheDocument();
    });

    it('still shows answer preview for Q&A search results', () => {
      render(
        <ContentCard
          item={makeSearchResult({
            content_type: 'q_a_pair',
            title: 'What is our data policy?',
            content: 'Our data policy covers GDPR compliance.',
          })}
        />,
      );
      expect(screen.getByText(/A:/)).toBeInTheDocument();
      expect(screen.getByText(/GDPR compliance/)).toBeInTheDocument();
    });
  });
});
