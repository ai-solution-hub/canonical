/**
 * MergeModal Component Tests
 *
 * Tests the entity merge modal — entity display, target name input,
 * entity type selection, preview counts, and API interaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock values referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockToast } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

import {
  MergeModal,
  type EntityForMerge,
} from '@/components/entity-management/merge-modal';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleEntities: EntityForMerge[] = [
  { canonical_name: 'Acme Corp', entity_type: 'organisation', mention_count: 10 },
  { canonical_name: 'ACME Corporation', entity_type: 'organisation', mention_count: 5 },
  { canonical_name: 'Acme', entity_type: 'organisation', mention_count: 3 },
];

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  entities: sampleEntities,
  onMergeComplete: vi.fn(),
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MergeModal', () => {
  it('renders nothing when entities array is empty', () => {
    const { container } = render(
      <MergeModal {...defaultProps} entities={[]} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('shows the modal title', () => {
    render(<MergeModal {...defaultProps} />);

    expect(screen.getByText('Merge Entities')).toBeInTheDocument();
  });

  it('displays all entities with their mention counts', () => {
    render(<MergeModal {...defaultProps} />);

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('ACME Corporation')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();

    expect(screen.getByText('(10)')).toBeInTheDocument();
    expect(screen.getByText('(5)')).toBeInTheDocument();
    expect(screen.getByText('(3)')).toBeInTheDocument();
  });

  it('shows preview counts — total mentions and entity count with consolidation note', () => {
    render(<MergeModal {...defaultProps} />);

    // Total: 10 + 5 + 3 = 18 mentions across 3 entities
    expect(
      screen.getByText(/18 mentions across 3 entities/),
    ).toBeInTheDocument();

    // Should mention relationship consolidation
    expect(
      screen.getByText(/consolidate relationships/),
    ).toBeInTheDocument();
  });

  it('pre-fills target name with the entity having the most mentions', () => {
    render(<MergeModal {...defaultProps} />);

    const input = screen.getByLabelText(/canonical name for merged entity/i);
    expect(input).toHaveValue('Acme Corp');
  });

  it('allows editing the target name', async () => {
    const user = userEvent.setup();
    render(<MergeModal {...defaultProps} />);

    const input = screen.getByLabelText(/canonical name for merged entity/i);
    // The input starts pre-filled with "Acme Corp" (highest mention entity)
    expect(input).toHaveValue('Acme Corp');

    // Type additional text — appends to the pre-filled value
    await user.type(input, ' Ltd');

    expect(input).toHaveValue('Acme Corp Ltd');
  });

  it('has entity type selector', () => {
    render(<MergeModal {...defaultProps} />);

    expect(screen.getByText('Entity type')).toBeInTheDocument();
  });

  it('shows merge button with entity count', () => {
    render(<MergeModal {...defaultProps} />);

    expect(
      screen.getByRole('button', { name: /merge 3 entities/i }),
    ).toBeInTheDocument();
  });

  it('calls API on merge and shows success toast', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          merged: true,
          target: 'Acme Corp',
          entity_type: 'organisation',
          mentions_updated: 8,
          duplicates_removed: 0,
        }),
    });

    render(<MergeModal {...defaultProps} />);

    const mergeButton = screen.getByRole('button', { name: /merge 3 entities/i });
    await user.click(mergeButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/entities/merge',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });

    expect(defaultProps.onMergeComplete).toHaveBeenCalled();
  });

  it('shows error toast when API fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Merge conflict' }),
    });

    render(<MergeModal {...defaultProps} />);

    const mergeButton = screen.getByRole('button', { name: /merge 3 entities/i });
    await user.click(mergeButton);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Merge conflict');
    });
  });

  it('has a cancel button that closes the modal', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<MergeModal {...defaultProps} onOpenChange={onOpenChange} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
