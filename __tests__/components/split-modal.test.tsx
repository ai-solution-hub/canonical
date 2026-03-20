/**
 * SplitModal Component Tests
 *
 * Tests the entity split modal — variant checkbox rendering, new canonical
 * name input, split button disabled states, API call, and toast feedback.
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

import { SplitModal } from '@/components/entity-management/split-modal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultVariants = ['ISO 27001:2022', 'ISO27001', 'ISO/IEC 27001:2022'];

function renderModal(
  open = true,
  canonicalName = 'ISO 27001',
  variantNames = defaultVariants,
  onOpenChange = vi.fn(),
  onSplitComplete = vi.fn(),
) {
  return {
    onOpenChange,
    onSplitComplete,
    ...render(
      <SplitModal
        open={open}
        onOpenChange={onOpenChange}
        canonicalName={canonicalName}
        variantNames={variantNames}
        onSplitComplete={onSplitComplete}
      />,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SplitModal', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
  });

  it('renders variant checkboxes', () => {
    renderModal();

    for (const variant of defaultVariants) {
      expect(screen.getByText(variant)).toBeInTheDocument();
    }

    // Each variant has a checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(defaultVariants.length);
  });

  it('new canonical name input works', async () => {
    renderModal();

    const user = userEvent.setup();
    const input = screen.getByLabelText(
      /new canonical name for split variants/i,
    );

    expect(input).toHaveValue('');
    await user.type(input, 'ISO 27001:2022');
    expect(input).toHaveValue('ISO 27001:2022');
  });

  it('split button disabled when no variants selected or no name', () => {
    renderModal();

    // Initially: no variants selected and no name entered
    const splitButton = screen.getByRole('button', { name: /split 0 variant/i });
    expect(splitButton).toBeDisabled();
  });

  it('split button disabled when name equals canonical name', async () => {
    renderModal();

    const user = userEvent.setup();

    // Select a variant
    const firstCheckbox = screen.getAllByRole('checkbox')[0];
    await user.click(firstCheckbox);

    // Type in the same canonical name
    const input = screen.getByLabelText(
      /new canonical name for split variants/i,
    );
    await user.type(input, 'ISO 27001');

    const splitButton = screen.getByRole('button', { name: /split 1 variant/i });
    expect(splitButton).toBeDisabled();
  });

  it('calls POST /api/entities/split', async () => {
    const onSplitComplete = vi.fn();
    const onOpenChange = vi.fn();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        split: true,
        original: 'ISO 27001',
        new_canonical_name: 'ISO 27001:2022',
        mentions_moved: 4,
      }),
    });

    renderModal(true, 'ISO 27001', defaultVariants, onOpenChange, onSplitComplete);

    const user = userEvent.setup();

    // Select the first two variants
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);

    // Enter new canonical name
    const input = screen.getByLabelText(
      /new canonical name for split variants/i,
    );
    await user.type(input, 'ISO 27001:2022');

    // Click split button
    const splitButton = screen.getByRole('button', { name: /split 2 variants/i });
    expect(splitButton).not.toBeDisabled();
    await user.click(splitButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/entities/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.any(String),
      });
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.canonical_name).toBe('ISO 27001');
    expect(callBody.new_canonical_name).toBe('ISO 27001:2022');
    expect(callBody.variant_names).toEqual(
      expect.arrayContaining(['ISO 27001:2022', 'ISO27001']),
    );
    expect(callBody.variant_names).toHaveLength(2);
  });

  it('shows toast on success', async () => {
    const onSplitComplete = vi.fn();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        split: true,
        mentions_moved: 4,
      }),
    });

    renderModal(true, 'ISO 27001', defaultVariants, vi.fn(), onSplitComplete);

    const user = userEvent.setup();

    // Select a variant and enter name
    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.type(
      screen.getByLabelText(/new canonical name for split variants/i),
      'ISO 27001:2022',
    );
    await user.click(
      screen.getByRole('button', { name: /split 1 variant/i }),
    );

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        expect.stringContaining('Split 4 mentions'),
      );
    });

    expect(onSplitComplete).toHaveBeenCalled();
  });

  it('shows toast on error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'No matching variant mentions found to split' }),
    });

    renderModal();

    const user = userEvent.setup();

    // Select a variant and enter name
    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.type(
      screen.getByLabelText(/new canonical name for split variants/i),
      'New Entity Name',
    );
    await user.click(
      screen.getByRole('button', { name: /split 1 variant/i }),
    );

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'No matching variant mentions found to split',
      );
    });
  });

  it('shows empty state when no variants provided', () => {
    renderModal(true, 'ISO 27001', []);

    expect(
      screen.getByText(/no variants found for this entity/i),
    ).toBeInTheDocument();
  });
});
