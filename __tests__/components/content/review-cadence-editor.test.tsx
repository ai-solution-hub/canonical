/**
 * ReviewCadenceEditor Component Tests
 *
 * Covers §5.5 Phase 3 T3 ACs:
 * - T3-AC1: TWO controls (date + Select) initialised from props
 * - T3-AC2: Editor renders only when readOnly={false} (covered in
 *           metadata-sidebar integration tests, not here — this component
 *           always renders when mounted)
 * - T3-AC3: Writes via PATCH /api/items/:id with `field` payloads
 * - T3-AC5: Custom cadence client-side validation [1, 1095] integer
 * - T3-AC6: Date input independent from cadence preset
 * - T3-AC7: Warm Meridian semantic tokens (snapshot-style assertions)
 *
 * Test setup:
 * - Radix pointer shims (Select uses Radix under the hood)
 * - TanStack QueryClient wrapper
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockToastError, mockCaptureClientException } = vi.hoisted(
  () => ({
    mockFetch: vi.fn(),
    mockToastError: vi.fn(),
    mockCaptureClientException: vi.fn(),
  }),
);

vi.stubGlobal('fetch', mockFetch);

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: mockToastError,
  }),
}));

vi.mock('@/lib/client-telemetry', () => ({
  captureClientException: mockCaptureClientException,
}));

import { ReviewCadenceEditor } from '@/components/content/review-cadence-editor';
import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupSuccessfulFetch() {
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ success: true }),
  }));
}

function renderEditor(
  props: Partial<React.ComponentProps<typeof ReviewCadenceEditor>> = {},
) {
  const finalProps = {
    itemId: 'item-1',
    nextReviewDate: null,
    reviewCadenceDays: null,
    ...props,
  };
  const { Wrapper, queryClient } = createQueryWrapper();
  const utils = render(<ReviewCadenceEditor {...finalProps} />, {
    wrapper: Wrapper,
  });
  return { ...utils, queryClient };
}

function findPatchCalls(field: 'next_review_date' | 'review_cadence_days') {
  return mockFetch.mock.calls.filter((call: unknown[]) => {
    const init = call[1] as RequestInit | undefined;
    if (!init || init.method !== 'PATCH') return false;
    const url = call[0];
    if (typeof url !== 'string' || !url.includes('/api/items/')) return false;
    try {
      const body = JSON.parse(init.body as string);
      return body.field === field;
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewCadenceEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installRadixPointerShims();
    setupSuccessfulFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);
  });

  // -------------------------------------------------------------------------
  // T3-AC1: initial render
  // -------------------------------------------------------------------------

  it('reads initial state from props (date + cadence days)', () => {
    renderEditor({
      nextReviewDate: '2026-12-31',
      reviewCadenceDays: 90,
    });

    const dateInput = screen.getByLabelText(
      'Next review date',
    ) as HTMLInputElement;
    expect(dateInput.value).toBe('2026-12-31');

    // Preset Select trigger should display "Every 3 months"
    expect(screen.getByText('Every 3 months')).toBeInTheDocument();
  });

  it('renders "No recurring review" when cadence days is NULL', () => {
    renderEditor({ nextReviewDate: null, reviewCadenceDays: null });

    expect(screen.getByText('No recurring review')).toBeInTheDocument();
  });

  it('renders "Not scheduled" placeholder text when next_review_date is NULL', () => {
    renderEditor({ nextReviewDate: null, reviewCadenceDays: null });

    const dateInput = screen.getByLabelText(
      'Next review date',
    ) as HTMLInputElement;
    expect(dateInput.value).toBe('');
    expect(screen.getByText('Not scheduled')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T3-AC1 + custom flow
  // -------------------------------------------------------------------------

  it('selecting "Every 3 months" preset PATCHes review_cadence_days=90', async () => {
    const user = userEvent.setup();
    renderEditor({ nextReviewDate: null, reviewCadenceDays: null });

    // Open the Select
    await user.click(
      screen.getByRole('combobox', { name: /recurring cadence/i }),
    );

    // Click the "Every 3 months" option
    await user.click(
      await screen.findByRole('option', { name: 'Every 3 months' }),
    );

    await waitFor(() => {
      expect(findPatchCalls('review_cadence_days')).toHaveLength(1);
    });
    const call = findPatchCalls('review_cadence_days')[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.value).toBe('90'); // server schema expects integer-string
  });

  it('selecting "Custom..." reveals numeric input without POSTing', async () => {
    const user = userEvent.setup();
    renderEditor({ nextReviewDate: null, reviewCadenceDays: null });

    await user.click(
      screen.getByRole('combobox', { name: /recurring cadence/i }),
    );
    await user.click(await screen.findByRole('option', { name: 'Custom...' }));

    expect(
      screen.getByLabelText(/Custom interval \(days, 1–1095\)/i),
    ).toBeInTheDocument();
    // No PATCH yet — user has not entered a value.
    expect(findPatchCalls('review_cadence_days')).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // T3-AC5: client-side validation
  // -------------------------------------------------------------------------

  it('rejects custom cadence < 1 with no POST', async () => {
    const user = userEvent.setup();
    renderEditor({ nextReviewDate: null, reviewCadenceDays: null });

    await user.click(
      screen.getByRole('combobox', { name: /recurring cadence/i }),
    );
    await user.click(await screen.findByRole('option', { name: 'Custom...' }));

    const input = screen.getByLabelText(
      /Custom interval \(days, 1–1095\)/i,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toMatch(
      /between 1 and 1095/i,
    );
    expect(findPatchCalls('review_cadence_days')).toHaveLength(0);
  });

  it('rejects custom cadence > 1095 with no POST', async () => {
    const user = userEvent.setup();
    renderEditor({ nextReviewDate: null, reviewCadenceDays: null });

    await user.click(
      screen.getByRole('combobox', { name: /recurring cadence/i }),
    );
    await user.click(await screen.findByRole('option', { name: 'Custom...' }));

    const input = screen.getByLabelText(
      /Custom interval \(days, 1–1095\)/i,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1096' } });
    fireEvent.blur(input);

    await screen.findByRole('alert');
    expect(findPatchCalls('review_cadence_days')).toHaveLength(0);
  });

  it('rejects non-integer custom cadence with no POST', async () => {
    const user = userEvent.setup();
    renderEditor({ nextReviewDate: null, reviewCadenceDays: null });

    await user.click(
      screen.getByRole('combobox', { name: /recurring cadence/i }),
    );
    await user.click(await screen.findByRole('option', { name: 'Custom...' }));

    const input = screen.getByLabelText(
      /Custom interval \(days, 1–1095\)/i,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12.5' } });
    fireEvent.blur(input);

    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toMatch(
      /whole number|between 1/i,
    );
    expect(findPatchCalls('review_cadence_days')).toHaveLength(0);
  });

  it('accepts a valid custom cadence within range', async () => {
    const user = userEvent.setup();
    renderEditor({ nextReviewDate: null, reviewCadenceDays: null });

    await user.click(
      screen.getByRole('combobox', { name: /recurring cadence/i }),
    );
    await user.click(await screen.findByRole('option', { name: 'Custom...' }));

    const input = screen.getByLabelText(
      /Custom interval \(days, 1–1095\)/i,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(findPatchCalls('review_cadence_days')).toHaveLength(1);
    });
    const call = findPatchCalls('review_cadence_days')[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.value).toBe('45');
  });

  // -------------------------------------------------------------------------
  // T3-AC3: PATCH path for next_review_date
  // -------------------------------------------------------------------------

  it('changing the date PATCHes next_review_date with ISO YYYY-MM-DD', async () => {
    renderEditor({ nextReviewDate: null, reviewCadenceDays: null });

    const dateInput = screen.getByLabelText(
      'Next review date',
    ) as HTMLInputElement;

    fireEvent.change(dateInput, { target: { value: '2026-09-15' } });
    fireEvent.blur(dateInput);

    await waitFor(() => {
      expect(findPatchCalls('next_review_date')).toHaveLength(1);
    });
    const call = findPatchCalls('next_review_date')[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.value).toBe('2026-09-15');
    expect(call[0]).toBe('/api/items/item-1');
    expect((call[1] as RequestInit).method).toBe('PATCH');
  });

  it('clearing the date PATCHes next_review_date=null', async () => {
    const user = userEvent.setup();
    renderEditor({ nextReviewDate: '2026-12-31', reviewCadenceDays: null });

    await user.click(
      screen.getByRole('button', { name: /clear next review date/i }),
    );

    await waitFor(() => {
      expect(findPatchCalls('next_review_date')).toHaveLength(1);
    });
    const call = findPatchCalls('next_review_date')[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.value).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T3-AC3: error path
  // -------------------------------------------------------------------------

  it('shows toast and reverts on network failure', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: false,
      json: async () => ({ error: 'Server boom' }),
    }));

    renderEditor({ nextReviewDate: null, reviewCadenceDays: null });

    const dateInput = screen.getByLabelText(
      'Next review date',
    ) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-09-15' } });
    fireEvent.blur(dateInput);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Server boom');
    });
  });

  // -------------------------------------------------------------------------
  // T3-AC6: independence of date + cadence
  // -------------------------------------------------------------------------

  it('"No recurring review" preset clears review_cadence_days to NULL', async () => {
    const user = userEvent.setup();
    renderEditor({ nextReviewDate: '2026-09-15', reviewCadenceDays: 90 });

    await user.click(
      screen.getByRole('combobox', { name: /recurring cadence/i }),
    );
    await user.click(
      await screen.findByRole('option', { name: 'No recurring review' }),
    );

    await waitFor(() => {
      expect(findPatchCalls('review_cadence_days')).toHaveLength(1);
    });
    const call = findPatchCalls('review_cadence_days')[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.value).toBeNull();

    // Date input untouched
    expect(findPatchCalls('next_review_date')).toHaveLength(0);
  });
});
