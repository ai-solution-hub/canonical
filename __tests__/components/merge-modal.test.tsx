/**
 * MergeModal Component Tests
 *
 * Tests the entity merge modal — entity list rendering, target name
 * pre-filling, entity type selection, merge API call, and toast feedback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockToast } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.stubGlobal('fetch', mockFetch);

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/lib/validation/schemas', () => ({
  VALID_ENTITY_TYPES: [
    'organisation',
    'certification',
    'regulation',
    'framework',
    'capability',
    'person',
    'technology',
    'project',
    'sector',
    'product',
  ],
}));

import { MergeModal } from '@/components/entity-management/merge-modal';
import type { EntityForMerge } from '@/components/entity-management/merge-modal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultEntities: EntityForMerge[] = [
  {
    canonical_name: 'ISO 27001',
    entity_type: 'certification',
    mention_count: 12,
  },
  {
    canonical_name: 'ISO27001',
    entity_type: 'certification',
    mention_count: 5,
  },
  {
    canonical_name: 'ISO/IEC 27001',
    entity_type: 'certification',
    mention_count: 3,
  },
];

function renderModal(
  entities = defaultEntities,
  open = true,
  onOpenChange = vi.fn(),
  onMergeComplete = vi.fn(),
) {
  return render(
    <MergeModal
      open={open}
      onOpenChange={onOpenChange}
      entities={entities}
      onMergeComplete={onMergeComplete}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MergeModal', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
  });

  it('renders entity list with mention counts', () => {
    renderModal();

    expect(screen.getByText('ISO 27001')).toBeInTheDocument();
    expect(screen.getByText('(12)')).toBeInTheDocument();
    expect(screen.getByText('ISO27001')).toBeInTheDocument();
    expect(screen.getByText('(5)')).toBeInTheDocument();
    expect(screen.getByText('ISO/IEC 27001')).toBeInTheDocument();
    expect(screen.getByText('(3)')).toBeInTheDocument();
  });

  it('shows total mentions across entities', () => {
    renderModal();

    const matches = screen.getAllByText(
      /update 20 mentions across.*3 entities/,
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  it('pre-fills target name input with highest-mention entity', () => {
    renderModal();

    const input = screen.getByLabelText(/canonical name for merged entity/i);
    expect(input).toHaveValue('ISO 27001');
  });

  it('calls POST /api/entities/merge on merge button click', async () => {
    const onMergeComplete = vi.fn();
    const onOpenChange = vi.fn();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mentions_updated: 8 }),
    });

    renderModal(defaultEntities, true, onOpenChange, onMergeComplete);

    const user = userEvent.setup();

    // The entity type should already be pre-filled with 'certification'
    // Click the merge button
    const mergeButton = screen.getByRole('button', {
      name: /merge 3 entities/i,
    });
    await user.click(mergeButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/entities/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.any(String),
      });
    });

    // Verify the body contents
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.target).toBe('ISO 27001');
    expect(callBody.sources).toEqual(['ISO27001', 'ISO/IEC 27001']);
    expect(callBody.entity_type).toBe('certification');
  });

  it('shows toast on success', async () => {
    const onMergeComplete = vi.fn();
    const onOpenChange = vi.fn();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mentions_updated: 8 }),
    });

    renderModal(defaultEntities, true, onOpenChange, onMergeComplete);

    const user = userEvent.setup();
    const mergeButton = screen.getByRole('button', {
      name: /merge 3 entities/i,
    });
    await user.click(mergeButton);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        expect.stringContaining('Merged 3 entities'),
      );
    });

    expect(onMergeComplete).toHaveBeenCalled();
  });

  it('shows toast on error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Merge failed: duplicate target' }),
    });

    renderModal();

    const user = userEvent.setup();
    const mergeButton = screen.getByRole('button', {
      name: /merge 3 entities/i,
    });
    await user.click(mergeButton);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'Merge failed: duplicate target',
      );
    });
  });

  it('returns null when entities array is empty', () => {
    const { container } = renderModal([]);

    expect(container.innerHTML).toBe('');
  });
});
