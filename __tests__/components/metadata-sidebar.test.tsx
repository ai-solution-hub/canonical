/**
 * MetadataSidebar Component Tests
 *
 * Tests the MetadataSidebar component which displays item metadata fields
 * (domain, type, priority, freshness, quality flags, etc.) with inline
 * editing support. Uses Supabase client for fetching quality flags.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockTaxonomyContext } from '../helpers/mock-contexts';

// ---------------------------------------------------------------------------
// vi.hoisted() — Supabase chain mock (hoisted above vi.mock)
// ---------------------------------------------------------------------------

const { mockChain, mockFrom } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'select',
    'eq',
    'neq',
    'in',
    'order',
    'or',
    'limit',
    'insert',
    'update',
    'delete',
    'is',
    'not',
    'single',
  ];
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

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockTaxonomyContext(),
}));

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: () =>
    new Map([
      ['user-123', 'Jane Smith'],
      ['user-456', 'Bob Jones'],
    ]),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// SourceMetadata now calls useUserRole() internally (S197 §1.19 Phase 4);
// mock it out for this test to avoid needing a QueryClientProvider. Matches
// the pattern in __tests__/components/item-detail/metadata-sidebar.test.tsx.
vi.mock('@/components/reader/source-metadata', () => ({
  SourceMetadata: () => <div />,
}));

import { MetadataSidebar } from '@/components/item-detail/metadata-sidebar';
import type { ItemData } from '@/app/item/[id]/item-detail-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function configureFetchResult(data: unknown[] | null, error: unknown = null) {
  mockChain.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ data, error }),
  );
}

function createItem(overrides: Partial<ItemData> = {}): ItemData {
  return {
    id: 'item-1',
    title: 'Test Item',
    suggested_title: 'Suggested Title',
    content: 'Test content body',
    summary: 'AI-generated summary',
    ai_keywords: ['security', 'compliance'],
    primary_domain: 'Technical',
    primary_subtopic: 'Infrastructure',
    secondary_domain: null,
    secondary_subtopic: null,
    content_type: 'article',
    platform: 'web',
    author_name: 'Jane Smith',
    source_url: 'https://example.com/article',
    file_path: null,
    source_domain: 'example.com',
    thumbnail_url: null,
    captured_date: '2026-01-15T10:00:00Z',
    classification_confidence: 0.85,
    classification_reasoning: 'Strong match for technical infrastructure',
    classified_at: '2026-01-15T10:00:00Z',
    summary_data: null,
    priority: 'high',
    user_tags: ['important'],
    freshness: 'fresh',
    governance_review_status: null,
    metadata: {},
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-16T12:00:00Z',
    created_by: 'user-123',
    updated_by: 'user-456',
    ...overrides,
  };
}

const defaultProps = {
  editingField: null as string | null,
  editValue: '',
  saveSuccess: null as string | null,
  startEdit: vi.fn(),
  saveEdit: vi.fn(),
  readOnly: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetadataSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain methods to return chain
    for (const m of [
      'select',
      'eq',
      'neq',
      'in',
      'order',
      'or',
      'limit',
      'insert',
      'update',
      'delete',
      'is',
      'not',
      'single',
    ]) {
      mockChain[m].mockReturnValue(mockChain);
    }
    mockFrom.mockReturnValue(mockChain);
    configureFetchResult([]);
  });

  it('renders core metadata fields', async () => {
    const item = createItem();

    render(<MetadataSidebar item={item} {...defaultProps} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    expect(screen.getByText('Domain')).toBeInTheDocument();
    expect(screen.getByText('Subtopic')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
  });

  it('renders content type and platform values', async () => {
    const item = createItem({ content_type: 'case_study', platform: 'manual' });

    render(<MetadataSidebar item={item} {...defaultProps} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    expect(screen.getByText('Case Study')).toBeInTheDocument();
    expect(screen.getByText('Manual entry')).toBeInTheDocument();
  });

  it('renders author when present', async () => {
    const item = createItem({ author_name: 'Dr Alice Brown' });

    render(<MetadataSidebar item={item} {...defaultProps} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    expect(screen.getByText('Author')).toBeInTheDocument();
    expect(screen.getByText('Dr Alice Brown')).toBeInTheDocument();
  });

  it('hides author field when author_name is null', async () => {
    const item = createItem({ author_name: null });

    render(<MetadataSidebar item={item} {...defaultProps} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    expect(screen.queryByText('Author')).not.toBeInTheDocument();
  });

  it('renders freshness badge when freshness is set', async () => {
    const item = createItem({ freshness: 'aging' });

    render(<MetadataSidebar item={item} {...defaultProps} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    expect(screen.getByText('Freshness')).toBeInTheDocument();
    expect(screen.getByLabelText('Freshness: Aging')).toBeInTheDocument();
  });

  it('hides freshness when not set', async () => {
    const item = createItem({ freshness: null });

    render(<MetadataSidebar item={item} {...defaultProps} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    expect(screen.queryByText('Freshness')).not.toBeInTheDocument();
  });

  it('shows quality flags when present', async () => {
    configureFetchResult([
      {
        id: 'flag-1',
        flag_type: 'short_content',
        severity: 'warning',
        details: { reason: 'Content is under 100 characters' },
        created_at: '2026-01-15T10:00:00Z',
      },
    ]);

    const item = createItem();

    render(<MetadataSidebar item={item} {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Quality Flags (1)')).toBeInTheDocument();
    });

    expect(screen.getByText('Short Content')).toBeInTheDocument();
    expect(
      screen.getByText('Content is under 100 characters'),
    ).toBeInTheDocument();
  });

  it('shows resolve button for quality flags when not read-only', async () => {
    configureFetchResult([
      {
        id: 'flag-1',
        flag_type: 'missing_content',
        severity: 'error',
        details: null,
        created_at: '2026-01-15T10:00:00Z',
      },
    ]);

    const item = createItem();

    render(<MetadataSidebar item={item} {...defaultProps} readOnly={false} />);

    await waitFor(() => {
      expect(screen.getByText('Missing Content')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: 'Resolve Missing Content flag' }),
    ).toBeInTheDocument();
  });

  it('hides resolve button in read-only mode', async () => {
    configureFetchResult([
      {
        id: 'flag-1',
        flag_type: 'missing_content',
        severity: 'error',
        details: null,
        created_at: '2026-01-15T10:00:00Z',
      },
    ]);

    const item = createItem();

    render(<MetadataSidebar item={item} {...defaultProps} readOnly={true} />);

    await waitFor(() => {
      expect(screen.getByText('Missing Content')).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('button', { name: 'Resolve Missing Content flag' }),
    ).not.toBeInTheDocument();
  });

  it('shows edit button for domain field when not read-only', async () => {
    const item = createItem();

    render(<MetadataSidebar item={item} {...defaultProps} readOnly={false} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    expect(
      screen.getByRole('button', { name: 'Edit domain' }),
    ).toBeInTheDocument();
  });

  it('hides edit buttons in read-only mode via CSS hidden class', async () => {
    const item = createItem();

    render(<MetadataSidebar item={item} {...defaultProps} readOnly={true} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    // In read-only mode, the edit buttons are rendered with a 'hidden' CSS class
    const editDomainBtn = screen.getByRole('button', { name: 'Edit domain' });
    expect(editDomainBtn.className).toContain('hidden');

    const editSubtopicBtn = screen.getByRole('button', {
      name: 'Edit subtopic',
    });
    expect(editSubtopicBtn.className).toContain('hidden');
  });

  it('calls startEdit when edit domain button is clicked', async () => {
    const user = userEvent.setup();
    const startEdit = vi.fn();
    const item = createItem();

    render(
      <MetadataSidebar item={item} {...defaultProps} startEdit={startEdit} />,
    );

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    await user.click(screen.getByRole('button', { name: 'Edit domain' }));

    expect(startEdit).toHaveBeenCalledWith('primary_domain');
  });

  it('handles null/empty metadata gracefully', async () => {
    const item = createItem({
      author_name: null,
      source_domain: null,
      freshness: null,
      governance_review_status: null,
      classification_confidence: null,
      created_by: null,
      updated_by: null,
    });

    render(<MetadataSidebar item={item} {...defaultProps} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    // Core fields should still render
    expect(screen.getByText('Domain')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();

    // Optional fields should be absent
    expect(screen.queryByText('Author')).not.toBeInTheDocument();
    expect(screen.queryByText('Source')).not.toBeInTheDocument();
    expect(screen.queryByText('Freshness')).not.toBeInTheDocument();
    expect(screen.queryByText('Review Status')).not.toBeInTheDocument();
  });

  it('renders created-by display name from useDisplayNames', async () => {
    // Use a different author_name to avoid collision with display name
    const item = createItem({ created_by: 'user-123', author_name: null });

    render(<MetadataSidebar item={item} {...defaultProps} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    expect(screen.getByText('Created by')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('renders updated-by display name', async () => {
    const item = createItem({ updated_by: 'user-456' });

    render(<MetadataSidebar item={item} {...defaultProps} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    expect(screen.getByText('Last edited by')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('fetches quality flags from the correct table with correct filters', async () => {
    const item = createItem({ id: 'item-xyz' });

    render(<MetadataSidebar item={item} {...defaultProps} />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('ingestion_quality_log');
    });

    expect(mockChain.select).toHaveBeenCalledWith(
      'id, flag_type, severity, details, created_at',
    );
    expect(mockChain.eq).toHaveBeenCalledWith('content_item_id', 'item-xyz');
    expect(mockChain.eq).toHaveBeenCalledWith('resolved', false);
  });

});
