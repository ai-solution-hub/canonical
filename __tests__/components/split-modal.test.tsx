/**
 * SplitModal Component Tests
 *
 * Tests the entity split modal — variant display, checkbox selection,
 * new canonical name input, and API interaction.
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

import { SplitModal } from '@/components/entity-management/split-modal';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleVariants = ['Acme Corporation', 'Acme Corp', 'ACME'];

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  canonicalName: 'Acme Corporation',
  variantNames: sampleVariants,
  onSplitComplete: vi.fn(),
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

describe('SplitModal', () => {
  it('shows the modal title', () => {
    render(<SplitModal {...defaultProps} />);

    expect(screen.getByText('Split Entity')).toBeInTheDocument();
  });

  it('displays the canonical name in description', () => {
    render(<SplitModal {...defaultProps} />);

    // The description mentions the canonical name in "Select variants of ..."
    expect(
      screen.getByText(/select variants of/i),
    ).toBeInTheDocument();
  });

  it('renders all variant names as selectable items', () => {
    render(<SplitModal {...defaultProps} />);

    expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('ACME')).toBeInTheDocument();
  });

  it('shows empty state when no variants exist', () => {
    render(<SplitModal {...defaultProps} variantNames={[]} />);

    expect(
      screen.getByText('No variants found for this entity.'),
    ).toBeInTheDocument();
  });

  it('shows selected count (initially 0)', () => {
    render(<SplitModal {...defaultProps} />);

    expect(
      screen.getByText(/0 selected/),
    ).toBeInTheDocument();
  });

  it('updates selected count when variants are toggled', async () => {
    const user = userEvent.setup();
    render(<SplitModal {...defaultProps} />);

    // Click the label for "ACME" to toggle
    const acmeLabel = screen.getByText('ACME');
    await user.click(acmeLabel);

    expect(
      screen.getByText(/1 selected/),
    ).toBeInTheDocument();
  });

  it('has new canonical name input', () => {
    render(<SplitModal {...defaultProps} />);

    const input = screen.getByLabelText(/new canonical name/i);
    expect(input).toBeInTheDocument();
  });

  it('allows typing a new canonical name', async () => {
    const user = userEvent.setup();
    render(<SplitModal {...defaultProps} />);

    const input = screen.getByLabelText(/new canonical name/i);
    await user.type(input, 'Acme Ltd');

    expect(input).toHaveValue('Acme Ltd');
  });

  it('disables split button when no variants selected', () => {
    render(<SplitModal {...defaultProps} />);

    // Button text: "Split 0 variants"
    const button = screen.getByRole('button', { name: /split 0 variant/i });
    expect(button).toBeDisabled();
  });

  it('disables split button when name matches canonical', async () => {
    const user = userEvent.setup();
    render(<SplitModal {...defaultProps} />);

    // Select a variant
    const acmeLabel = screen.getByText('ACME');
    await user.click(acmeLabel);

    // Type the same canonical name
    const input = screen.getByLabelText(/new canonical name/i);
    await user.type(input, 'Acme Corporation');

    const button = screen.getByRole('button', { name: /split 1 variant/i });
    expect(button).toBeDisabled();
  });

  it('calls API on split and shows success toast', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          split: true,
          original: 'Acme Corporation',
          new_canonical_name: 'Acme Ltd',
          mentions_moved: 2,
        }),
    });

    render(<SplitModal {...defaultProps} />);

    // Select a variant
    const acmeLabel = screen.getByText('ACME');
    await user.click(acmeLabel);

    // Enter new canonical name
    const input = screen.getByLabelText(/new canonical name/i);
    await user.type(input, 'Acme Ltd');

    // Click split button
    const button = screen.getByRole('button', { name: /split 1 variant/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/entities/split',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });

    expect(defaultProps.onSplitComplete).toHaveBeenCalled();
  });

  it('shows error toast when API fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'No matching variants' }),
    });

    render(<SplitModal {...defaultProps} />);

    // Select and name
    const acmeLabel = screen.getByText('ACME');
    await user.click(acmeLabel);
    const input = screen.getByLabelText(/new canonical name/i);
    await user.type(input, 'Acme Ltd');

    const button = screen.getByRole('button', { name: /split 1 variant/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('No matching variants');
    });
  });

  it('has a cancel button that closes the modal', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<SplitModal {...defaultProps} onOpenChange={onOpenChange} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('pluralises variant count correctly for single selection', async () => {
    const user = userEvent.setup();
    render(<SplitModal {...defaultProps} />);

    // Select one variant
    const acmeLabel = screen.getByText('ACME');
    await user.click(acmeLabel);

    // Button should say "variant" not "variants"
    expect(
      screen.getByRole('button', { name: /split 1 variant$/i }),
    ).toBeInTheDocument();
  });

  it('pluralises variant count correctly for multiple selections', async () => {
    const user = userEvent.setup();
    render(<SplitModal {...defaultProps} />);

    // Select two variants
    await user.click(screen.getByText('ACME'));
    await user.click(screen.getByText('Acme Corp'));

    expect(
      screen.getByRole('button', { name: /split 2 variants/i }),
    ).toBeInTheDocument();
  });
});
