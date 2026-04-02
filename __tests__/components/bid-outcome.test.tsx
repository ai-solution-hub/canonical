/**
 * BidOutcomeDialog Component Tests
 *
 * Tests the bid outcome recording dialog — rendering, outcome selection,
 * form validation, KB integration checkbox, submission, error handling,
 * and cancel/reset behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockToast } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Import AFTER mocks
import { BidOutcomeDialog } from '@/components/bid/bid-outcome';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  bidId: 'bid-123',
  bidName: 'Test Bid Alpha',
  onOutcomeRecorded: vi.fn(),
};

function renderDialog(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<BidOutcomeDialog {...props} />);
}

/** Click a radio option by clicking the label element wrapping the radio button */
async function selectOutcome(
  user: ReturnType<typeof userEvent.setup>,
  value: string,
) {
  const radio = screen.getByRole('radio', { name: new RegExp(value, 'i') });
  await user.click(radio);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BidOutcomeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---- Rendering ----

  it('renders the dialog when open is true', () => {
    renderDialog();
    expect(screen.getByText('Record Bid Outcome')).toBeInTheDocument();
  });

  it('does not render content when open is false', () => {
    renderDialog({ open: false });
    expect(screen.queryByText('Record Bid Outcome')).not.toBeInTheDocument();
  });

  it('shows the bid name in the description', () => {
    renderDialog();
    expect(screen.getByText('Test Bid Alpha')).toBeInTheDocument();
  });

  it('renders all three outcome options', () => {
    renderDialog();
    expect(screen.getByText('Won')).toBeInTheDocument();
    expect(screen.getByText('Lost')).toBeInTheDocument();
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
  });

  it('renders outcome descriptions', () => {
    renderDialog();
    expect(screen.getByText('Bid was successful')).toBeInTheDocument();
    expect(screen.getByText('Bid was unsuccessful')).toBeInTheDocument();
    expect(
      screen.getByText('Bid was withdrawn before decision'),
    ).toBeInTheDocument();
  });

  it('renders the notes textarea', () => {
    renderDialog();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
  });

  it('renders Cancel and Record Outcome buttons', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Record Outcome' }),
    ).toBeInTheDocument();
  });

  it('disables Record Outcome button when no outcome is selected', () => {
    renderDialog();
    expect(
      screen.getByRole('button', { name: 'Record Outcome' }),
    ).toBeDisabled();
  });

  // ---- Outcome selection ----

  it('enables Record Outcome button after selecting an outcome', async () => {
    const user = userEvent.setup();
    renderDialog();
    await selectOutcome(user, 'Won');
    expect(
      screen.getByRole('button', { name: 'Record Outcome' }),
    ).not.toBeDisabled();
  });

  // ---- KB integration checkbox ----

  it('shows KB integration checkbox only when Won is selected', async () => {
    const user = userEvent.setup();
    renderDialog();

    // Not visible initially
    expect(
      screen.queryByText(/Review responses for knowledge base integration/),
    ).not.toBeInTheDocument();

    // Select Won
    await selectOutcome(user, 'Won');
    expect(
      screen.getByText(/Review responses for knowledge base integration/),
    ).toBeInTheDocument();
  });

  it('hides KB integration checkbox when switching from Won to Lost', async () => {
    const user = userEvent.setup();
    renderDialog();

    await selectOutcome(user, 'Won');
    expect(
      screen.getByText(/Review responses for knowledge base integration/),
    ).toBeInTheDocument();

    await selectOutcome(user, 'Lost');
    expect(
      screen.queryByText(/Review responses for knowledge base integration/),
    ).not.toBeInTheDocument();
  });

  // ---- Notes input ----

  it('allows typing notes', async () => {
    const user = userEvent.setup();
    renderDialog();
    const textarea = screen.getByLabelText('Notes');
    await user.type(textarea, 'Good feedback from buyer');
    expect(textarea).toHaveValue('Good feedback from buyer');
  });

  // ---- Successful submission ----

  it('submits the outcome and calls onOutcomeRecorded on success', async () => {
    const user = userEvent.setup();
    const onOutcomeRecorded = vi.fn();
    const onOpenChange = vi.fn();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ kb_candidates: [{ question_id: 'q1' }] }),
    });

    renderDialog({ onOutcomeRecorded, onOpenChange });

    await selectOutcome(user, 'Won');
    await user.click(screen.getByRole('button', { name: 'Record Outcome' }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/bids/bid-123/outcome',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ outcome: 'won' }),
        }),
      );
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        'Bid outcome recorded: Won',
        { duration: 3000 },
      );
      expect(onOutcomeRecorded).toHaveBeenCalledWith('won', [
        { question_id: 'q1' },
      ]);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('includes notes in the request body when provided', async () => {
    const user = userEvent.setup();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ kb_candidates: [] }),
    });

    renderDialog();

    await selectOutcome(user, 'Lost');
    await user.type(screen.getByLabelText('Notes'), 'Price was too high');
    await user.click(screen.getByRole('button', { name: 'Record Outcome' }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/bids/bid-123/outcome',
        expect.objectContaining({
          body: JSON.stringify({
            outcome: 'lost',
            notes: 'Price was too high',
          }),
        }),
      );
    });
  });

  it('includes integrate_to_kb flag when Won with checkbox ticked', async () => {
    const user = userEvent.setup();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ kb_candidates: [] }),
    });

    renderDialog();

    await selectOutcome(user, 'Won');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Record Outcome' }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/bids/bid-123/outcome',
        expect.objectContaining({
          body: JSON.stringify({ outcome: 'won', integrate_to_kb: true }),
        }),
      );
    });
  });

  // ---- Error handling ----

  it('shows error alert when API returns an error', async () => {
    const user = userEvent.setup();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Database unavailable' }),
    });

    renderDialog();

    await selectOutcome(user, 'Won');
    await user.click(screen.getByRole('button', { name: 'Record Outcome' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Database unavailable',
      );
      expect(mockToast.error).toHaveBeenCalledWith('Database unavailable');
    });
  });

  it('shows fallback error when API returns no JSON', async () => {
    const user = userEvent.setup();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('no body')),
    });

    renderDialog();

    await selectOutcome(user, 'Lost');
    await user.click(screen.getByRole('button', { name: 'Record Outcome' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to record outcome (502)',
      );
    });
  });

  it('shows error toast when fetch throws a network error', async () => {
    const user = userEvent.setup();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error'),
    );

    renderDialog();

    await selectOutcome(user, 'Won');
    await user.click(screen.getByRole('button', { name: 'Record Outcome' }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Network error');
    });
  });

  // ---- Cancel behaviour ----

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ---- Validation: no outcome selected ----

  it('keeps submit button disabled when no outcome is selected', () => {
    renderDialog();
    const submitButton = screen.getByRole('button', { name: 'Record Outcome' });
    expect(submitButton).toBeDisabled();
  });

  // ---- Empty kb_candidates response ----

  it('handles response with no kb_candidates field gracefully', async () => {
    const user = userEvent.setup();
    const onOutcomeRecorded = vi.fn();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    renderDialog({ onOutcomeRecorded });

    await selectOutcome(user, 'Lost');
    await user.click(screen.getByRole('button', { name: 'Record Outcome' }));

    await waitFor(() => {
      expect(onOutcomeRecorded).toHaveBeenCalledWith('lost', []);
    });
  });
});
