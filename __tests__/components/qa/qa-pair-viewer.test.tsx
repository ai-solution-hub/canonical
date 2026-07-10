/**
 * QAPairViewer — the `/library/[id]` single-`q_a_pairs`-pair read/edit
 * presenter (ID-135 {135.22}).
 *
 * Behaviour-first: renders the real component tree (QAAnswerDisplay +
 * QARevisionHistory are the REAL, reused `components/qa` modules — this is
 * the point of the Subtask, wiring the previously-orphaned components to a
 * live caller) and asserts on what a user sees/can do, not on internals.
 * `QARevisionHistory` does its own network fetch (TanStack Query) so it is
 * wrapped in a query client provider; its own behaviour is covered by
 * existing tests and is not re-asserted here beyond "it renders".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { QAPairViewer } from '@/components/qa/qa-pair-viewer';
import type { Tables } from '@/supabase/types/database.types';

const PAIR_ID = '44444444-4444-4444-8444-444444444444';

function makePair(
  overrides: Partial<Tables<'q_a_pairs'>> = {},
): Tables<'q_a_pairs'> {
  return {
    id: PAIR_ID,
    question_text: 'What is the refund policy?',
    answer_standard: 'Refunds within 30 days.',
    answer_advanced: null,
    scope_tag: ['returns'],
    anti_scope_tag: [],
    source_workspace_id: null,
    origin_kind: 'manually_authored',
    publication_status: 'published',
    superseded_by: null,
    valid_from: null,
    valid_to: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    alternate_question_phrasings: [],
    edit_intent: null,
    source_form_response_id: null,
    source_question_id: null,
    source_document_id: null,
    source_form_template_id: null,
    ...overrides,
  } as Tables<'q_a_pairs'>;
}

function renderViewer(props: { pair: Tables<'q_a_pairs'>; canEdit: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <QAPairViewer {...props} />
    </QueryClientProvider>,
  );
}

describe('QAPairViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    // QARevisionHistory's fetch only fires once its collapsible panel opens
    // (enabled: isOpen) — default it to a benign empty response either way.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ versions: [], total: 0 }),
    });
  });

  it('shows the question text and a link back to /library', () => {
    renderViewer({ pair: makePair(), canEdit: false });

    expect(screen.getByText('What is the refund policy?')).toBeInTheDocument();
    const backLink = screen.getByRole('link', { name: /library/i });
    expect(backLink).toHaveAttribute('href', '/library');
  });

  it('renders the standard answer via the reused QAAnswerDisplay', () => {
    renderViewer({ pair: makePair(), canEdit: false });

    expect(screen.getByText('Refunds within 30 days.')).toBeInTheDocument();
  });

  it('does not offer an Edit affordance for a read-only (viewer-role) caller', () => {
    renderViewer({ pair: makePair(), canEdit: false });

    expect(
      screen.queryByRole('button', { name: /edit/i }),
    ).not.toBeInTheDocument();
  });

  it('offers an Edit affordance for an editor/admin caller (canEdit=true)', () => {
    renderViewer({ pair: makePair(), canEdit: true });

    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('renders the scope tags', () => {
    renderViewer({
      pair: makePair({ scope_tag: ['returns', 'billing'] }),
      canEdit: false,
    });

    expect(screen.getByText('returns')).toBeInTheDocument();
    expect(screen.getByText('billing')).toBeInTheDocument();
  });
});
