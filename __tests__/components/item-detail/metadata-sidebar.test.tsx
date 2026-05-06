/**
 * MetadataSidebar — resolveFlag error handling
 *
 * The resolveFlag callback PATCHes /api/quality and surfaces failures via
 * toast + telemetry. This test verifies the fetch-reject branch fires
 * captureClientException with the correct scope tag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  mockCaptureClientException,
  mockToastError,
  mockToastSuccess,
  mockFetchFlags,
} = vi.hoisted(() => ({
  mockCaptureClientException: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockFetchFlags: vi.fn(),
}));

vi.mock('@/lib/client-telemetry', () => ({
  captureClientException: mockCaptureClientException,
}));

vi.mock('sonner', () => ({
  toast: { error: mockToastError, success: mockToastSuccess, info: vi.fn() },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: mockFetchFlags,
          }),
        }),
      }),
    }),
  }),
}));

// Stub out the fat downstream sub-components so we can render in isolation
vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    getDomainNames: () => ['Corporate'],
    getSubtopics: () => ['Topic'],
    formatSubtopic: (s: string) => s,
  }),
}));

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: () => new Map(),
}));

vi.mock('@/components/shared/domain-badge', () => ({
  DomainBadge: () => <span />,
}));

vi.mock('@/components/reader/source-metadata', () => ({
  SourceMetadata: () => <div />,
}));

vi.mock('@/components/shared/freshness-badge', () => ({
  FreshnessBadge: () => <div />,
}));

vi.mock('@/components/shared/expiry-date-display', () => ({
  ExpiryDateDisplay: () => <div />,
}));

vi.mock('@/components/item-detail/temporal-references-section', () => ({
  TemporalReferencesSection: () => <div />,
}));

vi.mock('@/components/shared/governance-badge', () => ({
  GovernanceBadge: () => <div />,
}));

vi.mock('@/components/content/content-owner-selector', () => ({
  ContentOwnerSelector: () => <div />,
}));

vi.mock('@/components/content/content-owner-badge', () => ({
  ContentOwnerBadge: () => <div />,
}));

vi.mock('@/components/shared/quality-score-breakdown', () => ({
  QualityScoreBreakdown: () => <div />,
}));

// ReviewCadenceEditor uses TanStack Query internally (§5.5 Phase 3 T3); mock
// it here so this isolated test file does not need a QueryClientProvider.
vi.mock('@/components/content/review-cadence-editor', () => ({
  ReviewCadenceEditor: () => <div data-testid="review-cadence-editor-mock" />,
}));

import { MetadataSidebar } from '@/components/item-detail/metadata-sidebar';
import type { ItemData } from '@/app/item/[id]/item-detail-client';

function createItem(overrides: Partial<ItemData> = {}): ItemData {
  return {
    id: 'item-123',
    title: 'Test',
    suggested_title: null,
    content: null,
    summary: null,
    ai_keywords: null,
    primary_domain: 'Corporate',
    primary_subtopic: 'Topic',
    secondary_domain: null,
    secondary_subtopic: null,
    content_type: 'article',
    platform: 'web',
    author_name: null,
    source_url: null,
    file_path: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: null,
    classification_confidence: null,
    classification_reasoning: null,
    classified_at: null,
    summary_data: null,
    priority: null,
    user_tags: null,
    freshness: null,
    governance_review_status: null,
    metadata: null,
    ...overrides,
  };
}

describe('MetadataSidebar — resolveFlag error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // One unresolved quality flag
    mockFetchFlags.mockResolvedValue({
      data: [
        {
          id: 'flag-1',
          flag_type: 'manual_review',
          severity: 'warning',
          details: null,
          created_at: '2026-04-01T00:00:00Z',
        },
      ],
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports telemetry and toasts an error when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network dead')),
    );

    render(
      <MetadataSidebar
        item={createItem()}
        editingField={null}
        editValue=""
        saveSuccess={null}
        startEdit={vi.fn()}
        saveEdit={vi.fn()}
      />,
    );

    // Wait for flag to appear in DOM
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /resolve/i }),
      ).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /resolve/i }));

    await waitFor(() => {
      expect(mockCaptureClientException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          scope: 'item-detail.metadata-sidebar.resolveQualityFlag',
          extras: expect.objectContaining({
            flagId: 'flag-1',
            itemId: 'item-123',
          }),
        }),
      );
    });
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to resolve quality flag',
    );
  });
});

describe('MetadataSidebar — classification details admin-only guard (P1-6 F2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchFlags.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not render a "Classification Details" heading or classification_reasoning text even when reasoning is populated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );

    const reasoningText =
      'This item was classified as Corporate because of explicit taxonomy signals.';
    render(
      <MetadataSidebar
        item={createItem({
          classification_confidence: 0.92,
          classification_reasoning: reasoningText,
          classified_at: '2026-04-01T00:00:00Z',
        })}
        editingField={null}
        editValue=""
        saveSuccess={null}
        startEdit={vi.fn()}
        saveEdit={vi.fn()}
      />,
    );

    expect(
      screen.queryByText('Classification Details'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(reasoningText)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/classified as Corporate/i),
    ).not.toBeInTheDocument();
    // Drain the supabase quality-flags fetch (mockFetchFlags) so its
    // setState lands inside an act boundary, not after teardown
    // ("wrapped into act(...)" warning).
    await waitFor(() => {
      expect(mockFetchFlags).toHaveBeenCalled();
    });
  });
});
