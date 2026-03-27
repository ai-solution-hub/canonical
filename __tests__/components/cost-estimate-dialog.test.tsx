/**
 * CostEstimateDialog Component Tests
 *
 * Tests the cost estimate dialog — loading state, estimate display,
 * error state with retry, proceed/cancel actions, token/cost formatting,
 * and zero-eligible-questions edge case.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Import AFTER mocks
import { CostEstimateDialog } from '@/components/coverage/cost-estimate-dialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  bidId: 'bid-456',
  onProceed: vi.fn(),
};

function makeEstimate(overrides: Record<string, unknown> = {}) {
  return {
    total_questions: 12,
    eligible_questions: 8,
    estimated_cost_min: 0.45,
    estimated_cost_max: 1.20,
    estimated_input_tokens: 150000,
    estimated_output_tokens: 30000,
    breakdown: [],
    ...overrides,
  };
}

function renderDialog(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<CostEstimateDialog {...props} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CostEstimateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  // ---- Rendering ----

  it('renders the dialog when open is true', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate()),
    });

    renderDialog();
    expect(screen.getByText('Cost Estimate')).toBeInTheDocument();
  });

  it('does not render content when open is false', () => {
    renderDialog({ open: false });
    expect(screen.queryByText('Cost Estimate')).not.toBeInTheDocument();
  });

  it('shows the description text', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate()),
    });

    renderDialog();
    expect(
      screen.getByText(/Estimated API cost for drafting all eligible questions/),
    ).toBeInTheDocument();
  });

  // ---- Loading state ----

  it('shows loading state while fetching estimate', () => {
    // Never resolves to keep loading state
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    renderDialog();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Calculating cost estimate...')).toBeInTheDocument();
  });

  it('disables Proceed button while loading', () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    renderDialog();
    expect(screen.getByRole('button', { name: 'Proceed with Drafting' })).toBeDisabled();
  });

  // ---- Fetching ----

  it('fetches estimate when dialog opens', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate()),
    });

    renderDialog();

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/bids/bid-456/responses/estimate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ skip_existing: true }),
        }),
      );
    });
  });

  // ---- Estimate display ----

  it('displays eligible questions count', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate()),
    });

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText('Eligible Questions')).toBeInTheDocument();
      expect(screen.getByText('8')).toBeInTheDocument();
      expect(screen.getByText('/ 12')).toBeInTheDocument();
    });
  });

  it('displays estimated tokens', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate()),
    });

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText('Estimated Tokens')).toBeInTheDocument();
      // 150000 + 30000 = 180000 -> "180.0K"
      expect(screen.getByText('180.0K')).toBeInTheDocument();
    });
  });

  it('displays cost range', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate({ estimated_cost_min: 0.45, estimated_cost_max: 1.20 })),
    });

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText('Estimated Cost (USD)')).toBeInTheDocument();
      // Cost range is in a single <p> with ndash between values
      const costEl = screen.getByText(/\$0\.45/);
      expect(costEl).toBeInTheDocument();
      expect(costEl.textContent).toContain('$1.20');
    });
  });

  it('formats very small costs as less than $0.01', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate({ estimated_cost_min: 0.005, estimated_cost_max: 0.008 })),
    });

    renderDialog();

    await waitFor(() => {
      const costEl = screen.getByText(/<\$0\.01/);
      expect(costEl).toBeInTheDocument();
    });
  });

  it('formats million-scale tokens with M suffix', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate({ estimated_input_tokens: 1500000, estimated_output_tokens: 500000 })),
    });

    renderDialog();

    await waitFor(() => {
      // 1500000 + 500000 = 2000000 -> "2.0M"
      expect(screen.getByText('2.0M')).toBeInTheDocument();
    });
  });

  it('shows input/output token breakdown', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate()),
    });

    renderDialog();

    await waitFor(() => {
      // "Input:" and "Output:" are inside <span> children; find them by text
      expect(screen.getByText('Input:')).toBeInTheDocument();
      expect(screen.getByText('Output:')).toBeInTheDocument();
      // The containing div has the full breakdown text
      const inputSpan = screen.getByText('Input:');
      const container = inputSpan.closest('div');
      expect(container?.textContent).toContain('150.0K');
      expect(container?.textContent).toContain('30.0K');
    });
  });

  // ---- Zero eligible questions ----

  it('shows message when zero questions are eligible', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate({ eligible_questions: 0 })),
    });

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText(/No questions are eligible for drafting/)).toBeInTheDocument();
    });
  });

  it('disables Proceed button when zero questions are eligible', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate({ eligible_questions: 0 })),
    });

    renderDialog();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Proceed with Drafting' })).toBeDisabled();
    });
  });

  // ---- Error state ----

  it('shows error message when fetch fails', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal error' }),
    });

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText('Internal error')).toBeInTheDocument();
    });
  });

  it('shows fallback error when API returns no JSON', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('no json')),
    });

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch cost estimate')).toBeInTheDocument();
    });
  });

  it('disables Proceed button when in error state', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Error' }),
    });

    renderDialog();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Proceed with Drafting' })).toBeDisabled();
    });
  });

  it('shows Retry button on error and retries when clicked', async () => {
    const user = userEvent.setup();

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Temporary error' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeEstimate()),
      });

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText('Temporary error')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('Eligible Questions')).toBeInTheDocument();
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  // ---- Actions ----

  it('calls onProceed and closes dialog when Proceed is clicked', async () => {
    const user = userEvent.setup();
    const onProceed = vi.fn();
    const onOpenChange = vi.fn();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate()),
    });

    renderDialog({ onProceed, onOpenChange });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Proceed with Drafting' })).not.toBeDisabled();
    });

    await user.click(screen.getByRole('button', { name: 'Proceed with Drafting' }));

    expect(onProceed).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeEstimate()),
    });

    renderDialog({ onOpenChange });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ---- Cancel and Proceed buttons always visible ----

  it('renders Cancel and Proceed buttons regardless of state', () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    renderDialog();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proceed with Drafting' })).toBeInTheDocument();
  });
});
