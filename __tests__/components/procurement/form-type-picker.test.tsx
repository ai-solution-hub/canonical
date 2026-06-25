import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createTestQueryClient } from '@/__tests__/helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Mock Supabase client — the picker fetches its option list at runtime from
// api.form_types (CV is the single source of truth, T-B12). We mock the
// `.from('form_types').select(...).contains(...).order(...)` chain.
// ---------------------------------------------------------------------------

const mockSelect = vi.fn();
const mockContains = vi.fn();
const mockOrder = vi.fn();
const mockFrom = vi.fn();

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mockCreateClient,
}));

// Import AFTER the mock so the component picks up the mocked client.
import { FormTypePicker } from '@/components/procurement/form-type-picker';

// The 7 procurement-applicable form types with their UK human labels
// (B-13 terminology review; post AD-4 pqq->psq rename). These are returned
// FROM the mocked api.form_types fetch, proving the option list is CV-driven
// rather than hardcoded in the component.
const FORM_TYPE_ROWS = [
  { key: 'bid', label: 'Bid' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'itt', label: 'ITT (Invitation To Tender)' },
  { key: 'psq', label: 'Selection Questionnaire (SQ/PSQ)' },
  { key: 'questionnaire', label: 'Questionnaire' },
  { key: 'rfp', label: 'RFP (Request For Proposal)' },
  { key: 'tender', label: 'Tender' },
];

function setupMockSupabase(
  data: { key: string; label: string }[] | null = FORM_TYPE_ROWS,
  error: unknown = null,
) {
  mockOrder.mockReturnValue(Promise.resolve({ data, error }));
  mockContains.mockReturnValue({ order: mockOrder });
  mockSelect.mockReturnValue({ contains: mockContains });
  mockFrom.mockReturnValue({ select: mockSelect });
  mockCreateClient.mockReturnValue({ from: mockFrom });
}

function renderPicker(
  props: Partial<React.ComponentProps<typeof FormTypePicker>>,
) {
  const queryClient = createTestQueryClient();
  const onConfirm = props.onConfirm ?? vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <FormTypePicker onConfirm={onConfirm} {...props} />
    </QueryClientProvider>,
  );
  return { onConfirm };
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMockSupabase();
});

describe('FormTypePicker', () => {
  it('fetches the option list from api.form_types filtered to procurement (CV-driven)', async () => {
    renderPicker({ inferredFormType: 'itt' });

    await waitFor(() =>
      expect(
        screen.getByRole('radio', { name: /ITT \(Invitation To Tender\)/ }),
      ).toBeInTheDocument(),
    );

    // CV is the single source of truth — the component queries the view and
    // filters by the procurement application type, rather than hardcoding.
    expect(mockFrom).toHaveBeenCalledWith('form_types');
    expect(mockContains).toHaveBeenCalledWith('applicable_application_types', [
      'procurement',
    ]);

    // All 7 procurement-applicable options render, by their UK human labels.
    for (const row of FORM_TYPE_ROWS) {
      expect(
        screen.getByRole('radio', { name: nameRe(row.label) }),
      ).toBeInTheDocument();
    }
  });

  it('pre-selects the inferred type on the common path', async () => {
    renderPicker({ inferredFormType: 'itt' });

    const itt = await screen.findByRole('radio', {
      name: /ITT \(Invitation To Tender\)/,
    });
    expect(itt).toHaveAttribute('aria-checked', 'true');

    // No other option is pre-selected.
    const tender = screen.getByRole('radio', { name: /^Tender/ });
    expect(tender).toHaveAttribute('aria-checked', 'false');
  });

  it('confirms the inferred type in a single click on the common path', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderPicker({ inferredFormType: 'itt' });

    await screen.findByRole('radio', { name: /ITT \(Invitation To Tender\)/ });

    // Single action: the inference is pre-selected, the user just confirms.
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('itt');
  });

  it('records an overridden choice from the 7-key list (the choice, not the inference, is authoritative)', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderPicker({ inferredFormType: 'itt' });

    await screen.findByRole('radio', { name: /ITT \(Invitation To Tender\)/ });

    // Override: pick a different type, then confirm.
    await user.click(screen.getByRole('radio', { name: /^Tender/ }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('tender');
  });

  it('does not pre-select when inference is unavailable (no document) — never silent-assigns', async () => {
    const { onConfirm } = renderPicker({ inferredFormType: null });

    await screen.findByRole('radio', { name: /ITT \(Invitation To Tender\)/ });

    // No option is selected.
    for (const row of FORM_TYPE_ROWS) {
      expect(
        screen.getByRole('radio', { name: nameRe(row.label) }),
      ).toHaveAttribute('aria-checked', 'false');
    }

    // Confirm is unavailable until the user explicitly picks — no silent assign.
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('requires an explicit pick before confirm when inference is unavailable', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderPicker({ inferredFormType: null });

    await screen.findByRole('radio', { name: /Selection Questionnaire/ });

    await user.click(
      screen.getByRole('radio', { name: /Selection Questionnaire/ }),
    );
    const confirm = screen.getByRole('button', { name: /confirm/i });
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('psq');
  });

  it('conveys selection by more than colour (selected-state text indicator, WCAG)', async () => {
    renderPicker({ inferredFormType: 'psq' });

    const selectedOption = await screen.findByRole('radio', {
      name: /Selection Questionnaire/,
    });
    // aria-checked + an explicit textual selected-state indicator (not colour
    // alone) live inside the selected option.
    expect(selectedOption).toHaveAttribute('aria-checked', 'true');
    expect(selectedOption).toHaveTextContent(/selected/i);
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Anchored accessible-name matcher: matches a radio whose label is exactly
// `label`, tolerating the trailing " Selected" indicator on the selected
// option. Prevents substring collisions (e.g. "Tender" vs
// "ITT (Invitation To Tender)", "Questionnaire" vs "Selection Questionnaire").
function nameRe(label: string): RegExp {
  return new RegExp(`^${escapeRegExp(label)}(\\s*Selected)?$`);
}
