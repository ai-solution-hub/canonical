/**
 * ContentRow + QuickReviewActions Integration Tests
 *
 * Tests that quick review actions integrate correctly into ContentRow
 * for both standard and Q&A row variants.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act } from '@testing-library/react';
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

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
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

import { ContentRow } from '@/components/content/content-row';

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

function makeContentItem(
  overrides: Partial<ContentListItem> = {},
): ContentListItem {
  return {
    id: 'row-1',
    title: 'Default Row Title',
    suggested_title: null,
    summary: 'A summary.',
    primary_domain: 'Corporate',
    primary_subtopic: 'Company History',
    content_type: 'article',
    platform: 'web',
    author_name: null,
    source_domain: null,
    source_file: null,
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
    publication_status: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentRow with QuickReviewActions', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('quick review actions rendered in row when canEdit={true}', () => {
    renderWithQuery(<ContentRow item={makeContentItem()} canEdit={true} />);
    expect(screen.getByLabelText('Verify')).toBeInTheDocument();
    expect(screen.getByLabelText('Flag for review')).toBeInTheDocument();
  });

  it('quick review actions not rendered when canEdit is omitted', () => {
    renderWithQuery(<ContentRow item={makeContentItem()} />);
    expect(screen.queryByLabelText('Verify')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Flag for review')).not.toBeInTheDocument();
  });

  it('actions do not navigate (stopPropagation)', async () => {
    renderWithQuery(<ContentRow item={makeContentItem()} canEdit={true} />);

    const verifyBtn = screen.getByLabelText('Verify');
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault');
    const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');

    // Wrap dispatchEvent in act() so the mutation's onMutate setState lands
    // inside an act boundary. (userEvent.click() auto-wraps; raw
    // dispatchEvent does not.) Then yield so the POST + onSuccess drains.
    await act(async () => {
      verifyBtn.dispatchEvent(clickEvent);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it('Q&A row variant renders actions', () => {
    renderWithQuery(
      <ContentRow
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
});
