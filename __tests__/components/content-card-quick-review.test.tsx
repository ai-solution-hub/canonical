/**
 * ContentCard + QuickReviewActions Integration Tests
 *
 * Tests that quick review actions integrate correctly into ContentCard
 * across all card variants: standard, compact, and Q&A pair.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ContentListItem } from '@/types/content';
import { mockTaxonomyContext } from '../helpers/mock-contexts';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockTaxonomyContext(),
}));

vi.mock('@/components/item-detail/content-renderer', () => ({
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

// Mock useUserRole (used by QuickReviewActions internally)
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({
    role: 'editor',
    loading: false,
    canEdit: true,
    canAdmin: false,
  }),
}));

import { ContentCard } from '@/components/content/content-card';

// ---------------------------------------------------------------------------
// Query wrapper
// ---------------------------------------------------------------------------

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, ui),
  );
}

// ---------------------------------------------------------------------------
// Mock data factory
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
    classification_confidence: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentCard with QuickReviewActions', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('quick review actions not rendered when canEdit is omitted', () => {
    renderWithQuery(<ContentCard item={makeContentItem()} />);
    expect(screen.queryByLabelText('Verify')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Flag for review')).not.toBeInTheDocument();
  });

  it('quick review actions rendered when canEdit={true}', () => {
    renderWithQuery(<ContentCard item={makeContentItem()} canEdit={true} />);
    expect(screen.getByLabelText('Verify')).toBeInTheDocument();
    expect(screen.getByLabelText('Flag for review')).toBeInTheDocument();
  });

  it('verify action calls API', async () => {
    const onQuickReviewUpdate = vi.fn();
    renderWithQuery(
      <ContentCard
        item={makeContentItem()}
        canEdit={true}
        onQuickReviewUpdate={onQuickReviewUpdate}
      />,
    );

    fireEvent.click(screen.getByLabelText('Verify'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/review/action',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"action":"verify"'),
        }),
      );
    });
  });

  it('actions do not navigate (stopPropagation working)', () => {
    // The card is a Link, so we check the button click doesn't trigger navigation
    renderWithQuery(
      <ContentCard item={makeContentItem()} canEdit={true} />,
    );

    const verifyBtn = screen.getByLabelText('Verify');
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault');
    const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');

    verifyBtn.dispatchEvent(clickEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it('Q&A card variant renders actions', () => {
    renderWithQuery(
      <ContentCard
        item={makeContentItem({
          content_type: 'q_a_pair',
          title: 'What is policy?',
          content: 'The policy is...',
        })}
        canEdit={true}
      />,
    );
    expect(screen.getByLabelText('Verify')).toBeInTheDocument();
    expect(screen.getByLabelText('Flag for review')).toBeInTheDocument();
  });

  it('compact card variant renders actions', () => {
    renderWithQuery(
      <ContentCard
        item={makeContentItem({ content_type: 'policy' })}
        canEdit={true}
      />,
    );
    expect(screen.getByLabelText('Verify')).toBeInTheDocument();
    expect(screen.getByLabelText('Flag for review')).toBeInTheDocument();
  });

  it('flag action shows resolve flag when hasQualityFlag is true', () => {
    renderWithQuery(
      <ContentCard
        item={makeContentItem()}
        hasQualityFlag={true}
        canEdit={true}
      />,
    );
    expect(screen.getByLabelText('Resolve flag')).toBeInTheDocument();
  });
});
