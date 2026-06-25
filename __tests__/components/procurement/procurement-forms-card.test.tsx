import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createTestQueryClient } from '@/__tests__/helpers/query-wrapper';
import {
  createMockSupabaseTable,
  type MockSupabaseTable,
} from '@/__tests__/helpers/mock-supabase';
import type {
  ProcurementFormSummary,
  ProcurementRollup,
} from '@/lib/domains/procurement/procurement-detail-shape';

// ID-130 {130.13} — net-new multi-form navigation + roll-up + add-a-form
// (B-7/B-19/B-16). The card's add-a-form picker fetches the CV option list from
// api.form_types via the mocked Supabase client (shared factory, never
// hand-rolled per __tests__/CLAUDE.md).

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: mockCreateClient }));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

import { ProcurementFormsCard } from '@/components/procurement/procurement-forms-card';

const FORM_TYPE_ROWS = [
  { key: 'bid', label: 'Bid' },
  { key: 'itt', label: 'ITT (Invitation To Tender)' },
  { key: 'psq', label: 'Selection Questionnaire (SQ/PSQ)' },
  { key: 'tender', label: 'Tender' },
];

const PROC_ID = '00000000-0000-4000-8000-000000000001';

const PSQ_FORM: ProcurementFormSummary = {
  id: 'form-psq',
  form_type: 'psq',
  name: 'PSQ',
  workflow_state: 'submitted',
  outcome: null,
  outcome_notes: null,
  deadline: '2026-07-01T00:00:00.000Z',
  submission_date: null,
  issuing_organisation: 'Acme Council',
  outcome_recorded_at: null,
  outcome_recorded_by: null,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
};

const ROLLUP: ProcurementRollup = {
  nearest_deadline: '2026-07-01T00:00:00.000Z',
  overall_outcome: 'won',
  counts_toward_win_rate: true,
  rollup_updated_at: '2026-06-21T00:00:00.000Z',
};

let mockClient: MockSupabaseTable;
const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderCard(
  props: Partial<React.ComponentProps<typeof ProcurementFormsCard>> = {},
) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ProcurementFormsCard
        procurementId={PROC_ID}
        forms={props.forms ?? [PSQ_FORM]}
        rollup={props.rollup ?? ROLLUP}
        canEdit={props.canEdit ?? true}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClient = createMockSupabaseTable({ data: FORM_TYPE_ROWS, error: null });
  mockCreateClient.mockReturnValue(mockClient);
  // Radix Dialog pointer/scroll shims (jsdom does not implement these).
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProcurementFormsCard', () => {
  it('renders the roll-up summary (nearest deadline + overall outcome, B-7)', () => {
    renderCard();
    expect(screen.getByText(/Nearest deadline:/)).toBeInTheDocument();
    expect(screen.getByText(/Overall outcome: Won/)).toBeInTheDocument();
  });

  it('renders a single-form one-item list with its type, state and deadline (B-19)', async () => {
    renderCard({ forms: [PSQ_FORM] });
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    // The CV label resolves once the form_types fetch settles.
    await waitFor(() =>
      expect(
        within(items[0]).getByText('Selection Questionnaire (SQ/PSQ)'),
      ).toBeInTheDocument(),
    );
    // The form links to its composer surface.
    expect(within(items[0]).getByRole('link')).toHaveAttribute(
      'href',
      `/procurement/${PROC_ID}/session`,
    );
  });

  it('lists mixed-type forms (B-15)', () => {
    renderCard({
      forms: [
        PSQ_FORM,
        {
          ...PSQ_FORM,
          id: 'form-itt',
          form_type: 'itt',
          workflow_state: 'won',
          outcome: 'won',
        },
      ],
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the empty state when there are no forms', () => {
    renderCard({ forms: [], rollup: null });
    expect(screen.getByText(/No forms yet/)).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('hides the add-a-form affordance for read-only users', () => {
    renderCard({ canEdit: false });
    expect(
      screen.queryByRole('button', { name: /add a form/i }),
    ).not.toBeInTheDocument();
  });

  it('add-a-form confirms a chosen type and POSTs it (confirm-first persist, B-16)', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ form: { id: 'new-form', form_type: 'tender' } }),
    });

    renderCard({ forms: [] });

    await user.click(screen.getByRole('button', { name: /add a form/i }));

    // Dialog + picker render; confirm is disabled until a type is chosen
    // (confirm-first — never silent-assign).
    const confirmBtn = await screen.findByRole('button', {
      name: /confirm form type/i,
    });
    expect(confirmBtn).toBeDisabled();

    await user.click(await screen.findByRole('radio', { name: /^Tender/ }));
    expect(confirmBtn).toBeEnabled();
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/procurement/${PROC_ID}/forms`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ form_type: 'tender' }),
        }),
      );
    });
  });
});
