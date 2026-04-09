/**
 * EntityBadges Component Tests
 *
 * Tests the EntityBadges component which displays entity mentions
 * for a content item, grouped by type. Uses client-side Supabase
 * queries to fetch entity data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock Supabase chain (must be hoisted above vi.mock)
// ---------------------------------------------------------------------------

const { mockChain, mockFrom } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'eq', 'neq', 'in', 'order', 'or', 'limit'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Default: awaiting the chain resolves to { data: [], error: null }
  chain.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null }),
  );

  return {
    mockChain: chain,
    mockFrom: vi.fn().mockReturnValue(chain),
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

import { EntityBadges } from '@/components/item-detail/entity-badges';

// ---------------------------------------------------------------------------
// Helper: configure what the chain resolves to when awaited
// ---------------------------------------------------------------------------

function configureFetchResult(data: unknown[] | null, error: unknown = null) {
  mockChain.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ data, error }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntityBadges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain methods to return chain
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'or', 'limit']) {
      mockChain[m].mockReturnValue(mockChain);
    }
    mockFrom.mockReturnValue(mockChain);
    // Default: empty result
    configureFetchResult([]);
  });

  it('renders empty state when no entities are found', async () => {
    configureFetchResult([]);

    render(<EntityBadges contentItemId="item-1" />);

    // Wait for the fetch to complete
    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('entity_mentions');
    });

    // Should render the empty state with consistent pattern
    expect(
      screen.getByText('No entities detected in this content.'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Entities mentioned in this content'),
    ).toBeInTheDocument();
  });

  it('renders entity badges grouped by type when data is returned', async () => {
    configureFetchResult([
      {
        id: 'e1',
        entity_type: 'organisation',
        canonical_name: 'Acme Corp',
        confidence: 0.9,
      },
      {
        id: 'e2',
        entity_type: 'organisation',
        canonical_name: 'Widget Ltd',
        confidence: 0.8,
      },
      {
        id: 'e3',
        entity_type: 'certification',
        canonical_name: 'ISO 27001',
        confidence: 0.95,
      },
    ]);

    render(<EntityBadges contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    // Check type labels
    expect(screen.getByText('Organisations:')).toBeInTheDocument();
    expect(screen.getByText('Certifications:')).toBeInTheDocument();

    // Check all entity names
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Widget Ltd')).toBeInTheDocument();
    expect(screen.getByText('ISO 27001')).toBeInTheDocument();
  });

  it('renders the section with correct aria-label', async () => {
    configureFetchResult([
      {
        id: 'e1',
        entity_type: 'technology',
        canonical_name: 'React',
        confidence: 0.9,
      },
    ]);

    render(<EntityBadges contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('React')).toBeInTheDocument();
    });

    const section = screen.getByLabelText('Entities mentioned in this content');
    expect(section).toBeInTheDocument();
  });

  it('renders the "Entities" heading', async () => {
    configureFetchResult([
      {
        id: 'e1',
        entity_type: 'location',
        canonical_name: 'London',
        confidence: 0.85,
      },
    ]);

    render(<EntityBadges contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('Entities')).toBeInTheDocument();
    });
  });

  it('deduplicates entities with the same type and canonical_name', async () => {
    configureFetchResult([
      {
        id: 'e1',
        entity_type: 'standard',
        canonical_name: 'ISO 27001',
        confidence: 0.9,
      },
      {
        id: 'e2',
        entity_type: 'standard',
        canonical_name: 'ISO 27001',
        confidence: 0.85,
      },
      {
        id: 'e3',
        entity_type: 'standard',
        canonical_name: 'ISO 9001',
        confidence: 0.8,
      },
    ]);

    render(<EntityBadges contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('ISO 9001')).toBeInTheDocument();
    });

    // ISO 27001 should appear only once
    const badges = screen.getAllByText('ISO 27001');
    expect(badges).toHaveLength(1);
  });

  it('renders correct type labels for all known entity types', async () => {
    configureFetchResult([
      {
        id: 'e1',
        entity_type: 'person',
        canonical_name: 'Jane Doe',
        confidence: 0.9,
      },
      {
        id: 'e2',
        entity_type: 'regulation',
        canonical_name: 'GDPR',
        confidence: 0.95,
      },
      {
        id: 'e3',
        entity_type: 'technology',
        canonical_name: 'Python',
        confidence: 0.85,
      },
      {
        id: 'e4',
        entity_type: 'methodology',
        canonical_name: 'Agile',
        confidence: 0.8,
      },
    ]);

    render(<EntityBadges contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('People:')).toBeInTheDocument();
    });

    expect(screen.getByText('Regulations:')).toBeInTheDocument();
    expect(screen.getByText('Technologies:')).toBeInTheDocument();
    expect(screen.getByText('Methodologies:')).toBeInTheDocument();
  });

  it('handles unknown entity types with capitalised fallback label', async () => {
    configureFetchResult([
      {
        id: 'e1',
        entity_type: 'widget',
        canonical_name: 'Test Widget',
        confidence: 0.7,
      },
    ]);

    render(<EntityBadges contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('Test Widget')).toBeInTheDocument();
    });

    // Unknown type "widget" should become "Widgets"
    expect(screen.getByText('Widgets:')).toBeInTheDocument();
  });

  it('renders error state with retry button on fetch error', async () => {
    // S158 WP4: the component now surfaces failures via an inline error
    // state + Retry button instead of silently falling through to the
    // empty state.
    const fetchError = { message: 'Database error', code: '500' };
    configureFetchResult(null, fetchError);

    render(<EntityBadges contentItemId="item-1" />);

    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load entities/i),
      ).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('queries the correct table with the content item ID', async () => {
    configureFetchResult([]);

    render(<EntityBadges contentItemId="item-abc-123" />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('entity_mentions');
    });

    expect(mockChain.select).toHaveBeenCalledWith(
      'id, entity_type, canonical_name, confidence',
    );
    expect(mockChain.eq).toHaveBeenCalledWith(
      'content_item_id',
      'item-abc-123',
    );
    expect(mockChain.order).toHaveBeenCalledWith('entity_type');
    expect(mockChain.order).toHaveBeenCalledWith('canonical_name');
  });

  it('passes className prop to the section element', async () => {
    configureFetchResult([
      {
        id: 'e1',
        entity_type: 'location',
        canonical_name: 'Birmingham',
        confidence: 0.8,
      },
    ]);

    render(<EntityBadges contentItemId="item-1" className="mt-4 border-t" />);

    await waitFor(() => {
      expect(screen.getByText('Birmingham')).toBeInTheDocument();
    });

    const section = screen.getByLabelText('Entities mentioned in this content');
    expect(section.className).toContain('mt-4 border-t');
  });

  it('sorts entity type groups alphabetically by label', async () => {
    configureFetchResult([
      {
        id: 'e1',
        entity_type: 'technology',
        canonical_name: 'React',
        confidence: 0.9,
      },
      {
        id: 'e2',
        entity_type: 'certification',
        canonical_name: 'ISO 27001',
        confidence: 0.95,
      },
      {
        id: 'e3',
        entity_type: 'organisation',
        canonical_name: 'Acme',
        confidence: 0.8,
      },
    ]);

    render(<EntityBadges contentItemId="item-1" />);

    await waitFor(() => {
      expect(screen.getByText('React')).toBeInTheDocument();
    });

    // Verify ordering: Certifications < Organisations < Technologies
    const labels = screen.getAllByText(/:$/);
    const labelTexts = labels.map((el) => el.textContent);
    expect(labelTexts).toEqual([
      'Certifications:',
      'Organisations:',
      'Technologies:',
    ]);
  });
});
