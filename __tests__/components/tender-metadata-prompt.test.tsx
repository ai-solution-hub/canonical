/**
 * TenderMetadataPrompt Component Tests
 *
 * Tests the dismissable metadata card — rendering metadata fields,
 * confidence indicator, apply/dismiss actions, API call, and edge cases
 * (empty data, partial fields, low/medium/high confidence).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockToast, mockFormatDateUK } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
  mockFormatDateUK: vi.fn((d: string) => d),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/lib/format', () => ({
  formatDateUK: (d: string) => mockFormatDateUK(d),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: Record<string, unknown>) => (
    <button
      onClick={onClick as React.MouseEventHandler}
      disabled={disabled as boolean}
      aria-label={props['aria-label'] as string}
      {...props}
    >
      {children as React.ReactNode}
    </button>
  ),
}));

vi.mock('lucide-react', () => ({
  Building2: (props: Record<string, unknown>) => <span data-testid="building-icon" aria-hidden={props['aria-hidden'] as string} />,
  Calendar: (props: Record<string, unknown>) => <span data-testid="calendar-icon" aria-hidden={props['aria-hidden'] as string} />,
  Hash: (props: Record<string, unknown>) => <span data-testid="hash-icon" aria-hidden={props['aria-hidden'] as string} />,
  PoundSterling: (props: Record<string, unknown>) => <span data-testid="pound-icon" aria-hidden={props['aria-hidden'] as string} />,
  FileText: (props: Record<string, unknown>) => <span data-testid="file-icon" aria-hidden={props['aria-hidden'] as string} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" aria-hidden={props['aria-hidden'] as string} />,
}));

// Import AFTER mocks
import { TenderMetadataPrompt } from '@/components/tender-metadata-prompt';
import type { TenderExtractedMetadata } from '@/types/bid-metadata';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetadata(overrides: Partial<TenderExtractedMetadata> = {}): TenderExtractedMetadata {
  return {
    buyer_name: 'Acme Council',
    deadline: '2026-04-15',
    reference_number: 'REF-2026-001',
    estimated_value: '£75,000',
    title: 'Waste Collection Services',
    confidence: 0.85,
    ...overrides,
  };
}

function mockFetchResponse(data: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenderMetadataPrompt', () => {
  const defaultProps = {
    metadata: makeMetadata(),
    bidId: 'bid-1',
    onUpdated: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    mockFormatDateUK.mockImplementation((d: string) => d);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---- Rendering ----

  it('renders the heading', () => {
    render(<TenderMetadataPrompt {...defaultProps} />);
    expect(screen.getByText('Tender Metadata Detected')).toBeInTheDocument();
  });

  it('renders accessible region', () => {
    render(<TenderMetadataPrompt {...defaultProps} />);
    expect(screen.getByRole('region', { name: 'Extracted tender metadata' })).toBeInTheDocument();
  });

  it('renders description text', () => {
    render(<TenderMetadataPrompt {...defaultProps} />);
    expect(screen.getByText(/following details were extracted/)).toBeInTheDocument();
  });

  // ---- Metadata fields ----

  it('renders title field', () => {
    render(<TenderMetadataPrompt {...defaultProps} />);
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Waste Collection Services')).toBeInTheDocument();
  });

  it('renders buyer name', () => {
    render(<TenderMetadataPrompt {...defaultProps} />);
    expect(screen.getByText('Buyer')).toBeInTheDocument();
    expect(screen.getByText('Acme Council')).toBeInTheDocument();
  });

  it('renders deadline with formatted date', () => {
    mockFormatDateUK.mockReturnValue('15/04/2026');
    render(<TenderMetadataPrompt {...defaultProps} />);
    expect(screen.getByText('Deadline')).toBeInTheDocument();
    expect(screen.getByText('15/04/2026')).toBeInTheDocument();
  });

  it('renders estimated value', () => {
    render(<TenderMetadataPrompt {...defaultProps} />);
    expect(screen.getByText('Value')).toBeInTheDocument();
    expect(screen.getByText('£75,000')).toBeInTheDocument();
  });

  it('renders reference number', () => {
    render(<TenderMetadataPrompt {...defaultProps} />);
    expect(screen.getByText('Reference')).toBeInTheDocument();
    expect(screen.getByText('REF-2026-001')).toBeInTheDocument();
  });

  // ---- Partial fields ----

  it('only renders fields that have values', () => {
    const metadata = makeMetadata({
      buyer_name: null,
      deadline: null,
      estimated_value: null,
      reference_number: null,
    });
    render(<TenderMetadataPrompt {...defaultProps} metadata={metadata} />);
    expect(screen.getByText('Waste Collection Services')).toBeInTheDocument();
    expect(screen.queryByText('Buyer')).not.toBeInTheDocument();
    expect(screen.queryByText('Deadline')).not.toBeInTheDocument();
    expect(screen.queryByText('Value')).not.toBeInTheDocument();
    expect(screen.queryByText('Reference')).not.toBeInTheDocument();
  });

  // ---- Confidence indicator ----

  it('shows high confidence for values above 0.7', () => {
    render(<TenderMetadataPrompt {...defaultProps} metadata={makeMetadata({ confidence: 0.9 })} />);
    expect(screen.getByText(/High confidence/)).toBeInTheDocument();
    expect(screen.getByText(/90%/)).toBeInTheDocument();
  });

  it('shows medium confidence for values between 0.3 and 0.7', () => {
    render(<TenderMetadataPrompt {...defaultProps} metadata={makeMetadata({ confidence: 0.5 })} />);
    expect(screen.getByText(/Medium confidence/)).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it('shows low confidence for values below 0.3', () => {
    render(<TenderMetadataPrompt {...defaultProps} metadata={makeMetadata({ confidence: 0.2 })} />);
    expect(screen.getByText(/Low confidence/)).toBeInTheDocument();
    expect(screen.getByText(/20%/)).toBeInTheDocument();
  });

  // ---- Null / empty data ----

  it('returns null when no metadata fields have values', () => {
    const metadata = makeMetadata({
      buyer_name: null,
      deadline: null,
      reference_number: null,
      estimated_value: null,
      title: null,
    });
    const { container } = render(<TenderMetadataPrompt {...defaultProps} metadata={metadata} />);
    expect(container.innerHTML).toBe('');
  });

  // ---- Dismiss ----

  it('renders dismiss button with icon', () => {
    render(<TenderMetadataPrompt {...defaultProps} />);
    expect(screen.getByLabelText('Dismiss tender metadata')).toBeInTheDocument();
  });

  it('hides component when dismiss X button is clicked', async () => {
    const user = userEvent.setup();
    render(<TenderMetadataPrompt {...defaultProps} />);
    await user.click(screen.getByLabelText('Dismiss tender metadata'));
    expect(screen.queryByText('Tender Metadata Detected')).not.toBeInTheDocument();
  });

  it('hides component when Dismiss button is clicked', async () => {
    const user = userEvent.setup();
    render(<TenderMetadataPrompt {...defaultProps} />);
    await user.click(screen.getByText('Dismiss'));
    expect(screen.queryByText('Tender Metadata Detected')).not.toBeInTheDocument();
  });

  // ---- Apply / Update Bid Details ----

  it('renders Update Bid Details button', () => {
    render(<TenderMetadataPrompt {...defaultProps} />);
    expect(screen.getByText('Update Bid Details')).toBeInTheDocument();
  });

  it('calls PATCH API when Update Bid Details is clicked', async () => {
    mockFetch.mockReturnValueOnce(mockFetchResponse({ ok: true }));
    const user = userEvent.setup();
    render(<TenderMetadataPrompt {...defaultProps} />);
    await user.click(screen.getByText('Update Bid Details'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/bids/bid-1',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });

  it('sends correct fields in PATCH body', async () => {
    mockFetch.mockReturnValueOnce(mockFetchResponse({ ok: true }));
    const user = userEvent.setup();
    render(<TenderMetadataPrompt {...defaultProps} />);
    await user.click(screen.getByText('Update Bid Details'));

    await waitFor(() => {
      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body).toEqual({
        buyer: 'Acme Council',
        deadline: '2026-04-15',
        reference_number: 'REF-2026-001',
        estimated_value: '£75,000',
        name: 'Waste Collection Services',
      });
    });
  });

  it('only sends non-null fields in PATCH body', async () => {
    mockFetch.mockReturnValueOnce(mockFetchResponse({ ok: true }));
    const metadata = makeMetadata({
      buyer_name: null,
      deadline: null,
      reference_number: null,
      estimated_value: null,
    });
    const user = userEvent.setup();
    render(<TenderMetadataPrompt {...defaultProps} metadata={metadata} />);
    await user.click(screen.getByText('Update Bid Details'));

    await waitFor(() => {
      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body).toEqual({ name: 'Waste Collection Services' });
      expect(body.buyer).toBeUndefined();
      expect(body.deadline).toBeUndefined();
    });
  });

  it('shows success toast and dismisses on successful apply', async () => {
    mockFetch.mockReturnValueOnce(mockFetchResponse({ ok: true }));
    const user = userEvent.setup();
    render(<TenderMetadataPrompt {...defaultProps} />);
    await user.click(screen.getByText('Update Bid Details'));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Tender metadata applied to bid');
    });
    expect(screen.queryByText('Tender Metadata Detected')).not.toBeInTheDocument();
  });

  it('calls onUpdated after successful apply', async () => {
    mockFetch.mockReturnValueOnce(mockFetchResponse({ ok: true }));
    const user = userEvent.setup();
    render(<TenderMetadataPrompt {...defaultProps} />);
    await user.click(screen.getByText('Update Bid Details'));

    await waitFor(() => {
      expect(defaultProps.onUpdated).toHaveBeenCalled();
    });
  });

  it('shows error toast when apply fails with non-ok response', async () => {
    mockFetch.mockReturnValueOnce(mockFetchResponse({}, false, 500));
    const user = userEvent.setup();
    render(<TenderMetadataPrompt {...defaultProps} />);
    await user.click(screen.getByText('Update Bid Details'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'Failed to apply tender metadata. Please try again.',
      );
    });
  });

  it('does not dismiss when apply fails', async () => {
    mockFetch.mockReturnValueOnce(mockFetchResponse({}, false, 500));
    const user = userEvent.setup();
    render(<TenderMetadataPrompt {...defaultProps} />);
    await user.click(screen.getByText('Update Bid Details'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(screen.getByText('Tender Metadata Detected')).toBeInTheDocument();
  });

  it('shows error toast when apply throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const user = userEvent.setup();
    render(<TenderMetadataPrompt {...defaultProps} />);
    await user.click(screen.getByText('Update Bid Details'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'Failed to apply tender metadata. Check your connection and try again.',
      );
    });
  });

  it('disables button while applying', async () => {
    // Use a never-resolving promise to observe the disabled state
    mockFetch.mockReturnValueOnce(new Promise(() => {}));
    const user = userEvent.setup();
    render(<TenderMetadataPrompt {...defaultProps} />);
    await user.click(screen.getByText('Update Bid Details'));

    await waitFor(() => {
      expect(screen.getByText('Updating\u2026')).toBeInTheDocument();
    });
  });

  // ---- Optional className ----

  it('applies className prop to root element', () => {
    render(<TenderMetadataPrompt {...defaultProps} className="mt-4" />);
    const region = screen.getByRole('region');
    expect(region.className).toContain('mt-4');
  });

  // ---- Optional onUpdated ----

  it('works without onUpdated callback', async () => {
    mockFetch.mockReturnValueOnce(mockFetchResponse({ ok: true }));
    const user = userEvent.setup();
    const { onUpdated: _unused, ...propsNoCallback } = defaultProps; // eslint-disable-line @typescript-eslint/no-unused-vars
    render(<TenderMetadataPrompt {...propsNoCallback} />);
    await user.click(screen.getByText('Update Bid Details'));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
    // Should not throw
  });
});
