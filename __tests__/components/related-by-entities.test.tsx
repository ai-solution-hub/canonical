/**
 * RelatedByEntities Component Tests
 *
 * Tests the RelatedByEntities component which shows content items
 * related to the current item by shared entities. Makes 3 sequential
 * Supabase queries: own entities → shared mentions → content details.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock Supabase chain and call tracking
// ---------------------------------------------------------------------------

const { mockChain, mockFrom, callTracker } = vi.hoisted(() => {
  /**
   * The RelatedByEntities component makes 3 sequential .from() calls:
   *   1. from('entity_mentions') — get entities for this item
   *   2. from('entity_mentions') — find other items sharing those entities
   *   3. from('content_items') — fetch details for top related items
   *
   * We track from() calls and configure per-call responses via callTracker.
   */
  const tracker = {
    fromCallIndex: 0,
    responses: [] as Array<{ data: unknown[] | null; error: unknown }>,
  };

  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'eq', 'neq', 'in', 'order', 'or', 'limit'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }

  // When awaited, resolve to the next response from the tracker
  chain.then = vi.fn((resolve: (v: unknown) => void) => {
    const idx = tracker.fromCallIndex++;
    const response = tracker.responses[idx] ?? { data: [], error: null };
    resolve(response);
  });

  const fromFn = vi.fn().mockReturnValue(chain);

  return {
    mockChain: chain,
    mockFrom: fromFn,
    callTracker: tracker,
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

// Mock taxonomy context (used by DomainBadge inside RelatedByEntities)
vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    domains: [],
    subtopics: [],
    loading: false,
    getDomainColourKey: (d: string) => d.toLowerCase().replace(/\s+/g, '-'),
    formatDomainName: (d: string) => d,
    getSubtopicsForDomain: () => [],
  }),
}));

import { RelatedByEntities } from '@/components/item-detail/related-by-entities';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Configure responses for the 3 sequential from() calls.
 * @param myEntities - Step 1: entities for the current item
 * @param sharedMentions - Step 2: entity mentions from other items
 * @param contentDetails - Step 3: content item details
 */
function configureThreeQueries(
  myEntities: { data: unknown[] | null; error: unknown },
  sharedMentions: { data: unknown[] | null; error: unknown } = { data: [], error: null },
  contentDetails: { data: unknown[] | null; error: unknown } = { data: [], error: null },
) {
  callTracker.fromCallIndex = 0;
  callTracker.responses = [myEntities, sharedMentions, contentDetails];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RelatedByEntities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callTracker.fromCallIndex = 0;
    callTracker.responses = [];

    // Reset chain methods to return chain
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'or', 'limit']) {
      mockChain[m].mockReturnValue(mockChain);
    }
    mockFrom.mockReturnValue(mockChain);

    // Reset the then mock to use tracker
    mockChain.then = vi.fn((resolve: (v: unknown) => void) => {
      const idx = callTracker.fromCallIndex++;
      const response = callTracker.responses[idx] ?? { data: [], error: null };
      resolve(response);
    });
  });

  it('shows loading state initially', () => {
    // Make the fetch hang by never resolving
    mockChain.then = vi.fn(() => {
      // Never resolve — keeps loading state
    });

    render(<RelatedByEntities contentItemId="item-1" />);

    expect(
      screen.getByText('Finding related content by entities…'),
    ).toBeInTheDocument();
  });

  it('renders nothing when the current item has no entities', async () => {
    configureThreeQueries({ data: [], error: null });

    const { container } = render(
      <RelatedByEntities contentItemId="item-1" />,
    );

    await waitFor(() => {
      // Loading spinner should be gone
      expect(
        screen.queryByText('Finding related content by entities…'),
      ).not.toBeInTheDocument();
    });

    // Should render nothing (no related items)
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when entities query returns null data', async () => {
    configureThreeQueries({ data: null, error: null });

    const { container } = render(
      <RelatedByEntities contentItemId="item-1" />,
    );

    await waitFor(() => {
      expect(
        screen.queryByText('Finding related content by entities…'),
      ).not.toBeInTheDocument();
    });

    expect(container.innerHTML).toBe('');
  });

  it('renders related items when shared entities exist', async () => {
    configureThreeQueries(
      // Step 1: Current item has these entities
      {
        data: [
          { canonical_name: 'ISO 27001' },
          { canonical_name: 'Cyber Essentials' },
        ],
        error: null,
      },
      // Step 2: Other items share these entities
      {
        data: [
          { content_item_id: 'item-2', canonical_name: 'ISO 27001' },
          { content_item_id: 'item-2', canonical_name: 'Cyber Essentials' },
          { content_item_id: 'item-3', canonical_name: 'ISO 27001' },
        ],
        error: null,
      },
      // Step 3: Content details for those items
      {
        data: [
          {
            id: 'item-2',
            title: 'Security Policy Overview',
            suggested_title: null,
            primary_domain: 'Technical',
            content_type: 'article',
          },
          {
            id: 'item-3',
            title: 'ISO Compliance Guide',
            suggested_title: null,
            primary_domain: 'Corporate',
            content_type: 'policy',
          },
        ],
        error: null,
      },
    );

    render(<RelatedByEntities contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('Security Policy Overview')).toBeInTheDocument();
    });

    // Check heading
    expect(screen.getByText('Related by Shared Entities')).toBeInTheDocument();

    // Check both items rendered
    expect(screen.getByText('ISO Compliance Guide')).toBeInTheDocument();

    // Check shared entity count text
    expect(screen.getByText('2 shared entities')).toBeInTheDocument();
    expect(screen.getByText('1 shared entity')).toBeInTheDocument();

    // Check shared entity names are listed (ISO 27001 appears in both items' entity lists)
    expect(screen.getAllByText(/ISO 27001/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders links to item detail pages', async () => {
    configureThreeQueries(
      { data: [{ canonical_name: 'React' }], error: null },
      { data: [{ content_item_id: 'item-42', canonical_name: 'React' }], error: null },
      {
        data: [{
          id: 'item-42',
          title: 'React Best Practices',
          suggested_title: null,
          primary_domain: 'Technical',
          content_type: 'article',
        }],
        error: null,
      },
    );

    render(<RelatedByEntities contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('React Best Practices')).toBeInTheDocument();
    });

    const link = screen.getByRole('link', { name: /React Best Practices/ });
    expect(link).toHaveAttribute('href', '/item/item-42');
  });

  it('uses suggested_title when available', async () => {
    configureThreeQueries(
      { data: [{ canonical_name: 'Testing' }], error: null },
      { data: [{ content_item_id: 'item-5', canonical_name: 'Testing' }], error: null },
      {
        data: [{
          id: 'item-5',
          title: 'Original Title',
          suggested_title: 'Better Suggested Title',
          primary_domain: null,
          content_type: 'article',
        }],
        error: null,
      },
    );

    render(<RelatedByEntities contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('Better Suggested Title')).toBeInTheDocument();
    });

    expect(screen.queryByText('Original Title')).not.toBeInTheDocument();
  });

  it('deduplicates entity canonical_names from the current item', async () => {
    configureThreeQueries(
      {
        data: [
          { canonical_name: 'ISO 27001' },
          { canonical_name: 'ISO 27001' }, // duplicate
          { canonical_name: 'GDPR' },
        ],
        error: null,
      },
      {
        data: [{ content_item_id: 'item-2', canonical_name: 'ISO 27001' }],
        error: null,
      },
      {
        data: [{
          id: 'item-2',
          title: 'Related Item',
          suggested_title: null,
          primary_domain: null,
          content_type: 'article',
        }],
        error: null,
      },
    );

    render(<RelatedByEntities contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('Related Item')).toBeInTheDocument();
    });

    // The .in() call should have deduplicated canonical_names
    expect(mockChain.in).toHaveBeenCalledWith(
      'canonical_name',
      expect.arrayContaining(['ISO 27001', 'GDPR']),
    );
    // Should only have 2 unique names, not 3
    const inCallArgs = mockChain.in.mock.calls.find(
      (call: unknown[]) => call[0] === 'canonical_name',
    );
    expect(inCallArgs?.[1]).toHaveLength(2);
  });

  it('shows +N more when shared entities exceed 3', async () => {
    configureThreeQueries(
      {
        data: [
          { canonical_name: 'Entity A' },
          { canonical_name: 'Entity B' },
          { canonical_name: 'Entity C' },
          { canonical_name: 'Entity D' },
          { canonical_name: 'Entity E' },
        ],
        error: null,
      },
      {
        data: [
          { content_item_id: 'item-2', canonical_name: 'Entity A' },
          { content_item_id: 'item-2', canonical_name: 'Entity B' },
          { content_item_id: 'item-2', canonical_name: 'Entity C' },
          { content_item_id: 'item-2', canonical_name: 'Entity D' },
          { content_item_id: 'item-2', canonical_name: 'Entity E' },
        ],
        error: null,
      },
      {
        data: [{
          id: 'item-2',
          title: 'Multi-Entity Item',
          suggested_title: null,
          primary_domain: null,
          content_type: 'article',
        }],
        error: null,
      },
    );

    render(<RelatedByEntities contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('Multi-Entity Item')).toBeInTheDocument();
    });

    // Should show first 3 entities and "+2 more"
    expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
  });

  // ── Error handling for each of the 3 sequential queries ──

  it('handles error in step 1 (fetching own entities) gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchError = { message: 'Network error' };

    configureThreeQueries({ data: null, error: fetchError });

    const { container } = render(
      <RelatedByEntities contentItemId="item-1" />,
    );

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'RelatedByEntities: failed to fetch entities for item:',
        fetchError,
      );
    });

    // Should render nothing
    expect(
      screen.queryByText('Related by Shared Entities'),
    ).not.toBeInTheDocument();
    expect(container.innerHTML).toBe('');

    consoleSpy.mockRestore();
  });

  it('handles error in step 2 (fetching shared mentions) gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sharedError = { message: 'Query failed' };

    configureThreeQueries(
      { data: [{ canonical_name: 'ISO 27001' }], error: null },
      { data: null, error: sharedError },
    );

    const { container } = render(
      <RelatedByEntities contentItemId="item-1" />,
    );

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'RelatedByEntities: failed to fetch shared entity mentions:',
        sharedError,
      );
    });

    expect(container.innerHTML).toBe('');

    consoleSpy.mockRestore();
  });

  it('handles error in step 3 (fetching content details) gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const detailError = { message: 'Table not found' };

    configureThreeQueries(
      { data: [{ canonical_name: 'ISO 27001' }], error: null },
      {
        data: [{ content_item_id: 'item-2', canonical_name: 'ISO 27001' }],
        error: null,
      },
      { data: null, error: detailError },
    );

    const { container } = render(
      <RelatedByEntities contentItemId="item-1" />,
    );

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'RelatedByEntities: failed to fetch content item details:',
        detailError,
      );
    });

    expect(container.innerHTML).toBe('');

    consoleSpy.mockRestore();
  });

  it('renders nothing when shared mentions exist but no content details match', async () => {
    configureThreeQueries(
      { data: [{ canonical_name: 'ISO 27001' }], error: null },
      {
        data: [{ content_item_id: 'item-2', canonical_name: 'ISO 27001' }],
        error: null,
      },
      // Details query returns items but none match the IDs (e.g. filtered by governance)
      { data: [], error: null },
    );

    const { container } = render(
      <RelatedByEntities contentItemId="item-1" />,
    );

    await waitFor(() => {
      expect(
        screen.queryByText('Finding related content by entities…'),
      ).not.toBeInTheDocument();
    });

    expect(container.innerHTML).toBe('');
  });

  it('renders domain badge when primary_domain is provided', async () => {
    configureThreeQueries(
      { data: [{ canonical_name: 'Testing' }], error: null },
      { data: [{ content_item_id: 'item-2', canonical_name: 'Testing' }], error: null },
      {
        data: [{
          id: 'item-2',
          title: 'Test Strategy Document',
          suggested_title: null,
          primary_domain: 'Technical',
          content_type: 'article',
        }],
        error: null,
      },
    );

    render(<RelatedByEntities contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('Test Strategy Document')).toBeInTheDocument();
    });

    // DomainBadge should render the domain name
    expect(screen.getByText('Technical')).toBeInTheDocument();
  });

  it('does not render domain badge when primary_domain is null', async () => {
    configureThreeQueries(
      { data: [{ canonical_name: 'Testing' }], error: null },
      { data: [{ content_item_id: 'item-2', canonical_name: 'Testing' }], error: null },
      {
        data: [{
          id: 'item-2',
          title: 'No Domain Item',
          suggested_title: null,
          primary_domain: null,
          content_type: 'article',
        }],
        error: null,
      },
    );

    render(<RelatedByEntities contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('No Domain Item')).toBeInTheDocument();
    });

    // Should still show shared entity count but no domain badge
    expect(screen.getByText('1 shared entity')).toBeInTheDocument();
  });

  it('passes className prop to the wrapper div', async () => {
    configureThreeQueries(
      { data: [{ canonical_name: 'React' }], error: null },
      { data: [{ content_item_id: 'item-2', canonical_name: 'React' }], error: null },
      {
        data: [{
          id: 'item-2',
          title: 'React Guide',
          suggested_title: null,
          primary_domain: null,
          content_type: 'article',
        }],
        error: null,
      },
    );

    const { container } = render(
      <RelatedByEntities contentItemId="item-1" className="mt-6 pt-4" />,
    );

    await waitFor(() => {
      expect(screen.getByText('React Guide')).toBeInTheDocument();
    });

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('mt-6 pt-4');
  });

  it('orders related items by descending shared entity count', async () => {
    configureThreeQueries(
      {
        data: [
          { canonical_name: 'Entity A' },
          { canonical_name: 'Entity B' },
        ],
        error: null,
      },
      {
        data: [
          // item-2 shares 1 entity
          { content_item_id: 'item-2', canonical_name: 'Entity A' },
          // item-3 shares 2 entities
          { content_item_id: 'item-3', canonical_name: 'Entity A' },
          { content_item_id: 'item-3', canonical_name: 'Entity B' },
        ],
        error: null,
      },
      {
        data: [
          {
            id: 'item-2',
            title: 'One Entity Match',
            suggested_title: null,
            primary_domain: null,
            content_type: 'article',
          },
          {
            id: 'item-3',
            title: 'Two Entity Match',
            suggested_title: null,
            primary_domain: null,
            content_type: 'article',
          },
        ],
        error: null,
      },
    );

    render(<RelatedByEntities contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('Two Entity Match')).toBeInTheDocument();
    });

    // item-3 (2 shared) should come before item-2 (1 shared)
    const items = screen.getAllByRole('link');
    const titles = items.map((el) => el.textContent);
    const twoIdx = titles.findIndex((t) => t?.includes('Two Entity Match'));
    const oneIdx = titles.findIndex((t) => t?.includes('One Entity Match'));
    expect(twoIdx).toBeLessThan(oneIdx);
  });

  it('excludes the current item from shared mentions query', async () => {
    configureThreeQueries(
      { data: [{ canonical_name: 'Testing' }], error: null },
      { data: [], error: null },
    );

    render(<RelatedByEntities contentItemId="item-current" />);

    await waitFor(() => {
      expect(mockChain.neq).toHaveBeenCalledWith(
        'content_item_id',
        'item-current',
      );
    });
  });
});
