import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BidCreationForm } from '@/components/bid/bid-creation-form';

describe('BidCreationForm', () => {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderForm(open = true) {
    return render(
      <BidCreationForm
        open={open}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
    );
  }

  // ----------------------------------------------------------
  // Rendering
  // ----------------------------------------------------------

  it('renders the form with required fields when open', () => {
    renderForm();
    expect(screen.getByLabelText(/Bid Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Buyer/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Submission Deadline/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Create Bid/ }),
    ).toBeInTheDocument();
  });

  it('renders optional fields (reference number, estimated value, notes)', () => {
    renderForm();
    expect(screen.getByLabelText(/Reference Number/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Estimated Value/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Notes/)).toBeInTheDocument();
  });

  // ----------------------------------------------------------
  // Submit button state
  // ----------------------------------------------------------

  it('disables submit when required fields are empty', () => {
    renderForm();
    const submitBtn = screen.getByRole('button', { name: /Create Bid/ });
    expect(submitBtn).toBeDisabled();
  });

  it('enables submit when name and buyer are filled', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Bid Name/), 'NHS Trust ITT');
    await user.type(screen.getByLabelText(/Buyer/), 'NHS Digital');

    const submitBtn = screen.getByRole('button', { name: /Create Bid/ });
    expect(submitBtn).toBeEnabled();
  });

  // ----------------------------------------------------------
  // Successful submission
  // ----------------------------------------------------------

  it('submits the form and calls onCreated on success', async () => {
    const user = userEvent.setup();
    const created = { id: 'bid-123', name: 'NHS Trust ITT' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => created,
    });

    renderForm();

    await user.type(screen.getByLabelText(/Bid Name/), 'NHS Trust ITT');
    await user.type(screen.getByLabelText(/Buyer/), 'NHS Digital');
    await user.click(screen.getByRole('button', { name: /Create Bid/ }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(created);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ----------------------------------------------------------
  // Error handling
  // ----------------------------------------------------------

  it('displays an error message on failed submission', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error occurred' }),
    });

    renderForm();

    await user.type(screen.getByLabelText(/Bid Name/), 'Test Bid');
    await user.type(screen.getByLabelText(/Buyer/), 'Test Org');
    await user.click(screen.getByRole('button', { name: /Create Bid/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Server error occurred',
      );
    });
    expect(onCreated).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Cancel
  // ----------------------------------------------------------

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ----------------------------------------------------------
  // Sends optional fields when filled
  // ----------------------------------------------------------

  it('includes optional fields in the request body when filled', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'bid-456', name: 'Full Bid' }),
    });

    renderForm();

    await user.type(screen.getByLabelText(/Bid Name/), 'Full Bid');
    await user.type(screen.getByLabelText(/Buyer/), 'HMRC');
    await user.type(screen.getByLabelText(/Reference Number/), 'ITT-2026-042');
    await user.type(screen.getByLabelText(/Estimated Value/), '£50,000');

    await user.click(screen.getByRole('button', { name: /Create Bid/ }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(requestBody.name).toBe('Full Bid');
    expect(requestBody.buyer).toBe('HMRC');
    expect(requestBody.reference_number).toBe('ITT-2026-042');
    expect(requestBody.estimated_value).toBe('£50,000');
  });
});
