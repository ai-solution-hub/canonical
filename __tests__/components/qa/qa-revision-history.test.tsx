/**
 * QARevisionHistory — Q&A revision-history surface (ID-59 {59.16}).
 *
 * Verifies the Q&A leg of the user-edit Diff-UI (PC-14..17 / INV-14..17):
 *   - Fetches q_a_pair_history (via fetchQAPairHistory → TanStack Query) once
 *     the section is expanded.
 *   - Renders RevisionDiffView comparing the latest two revisions, surfacing
 *     each revision's edit_intent in the diff metadata (the bl-273 contract).
 *   - Shows the empty/identical state RevisionDiffView owns when the two
 *     revisions are identical (never a blank panel).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: vi.fn().mockReturnValue(new Map()),
}));

import { QARevisionHistory } from '@/components/qa/qa-revision-history';

const PAIR_ID = '44444444-4444-4444-8444-444444444444';

const NEWER = {
  id: 'h2',
  q_a_pair_id: PAIR_ID,
  version: 2,
  question_text: 'What is the support SLA?',
  answer_standard: 'We respond within four hours.',
  answer_advanced: null,
  origin_kind: 'curated_explicit',
  publication_status: 'published',
  changed_at: '2026-06-10T10:00:00.000Z',
  changed_by: null,
  edit_intent: 'data',
};

const OLDER = {
  id: 'h1',
  q_a_pair_id: PAIR_ID,
  version: 1,
  question_text: 'What is the support SLA?',
  answer_standard: 'We respond within eight hours.',
  answer_advanced: null,
  origin_kind: 'curated_explicit',
  publication_status: 'published',
  changed_at: '2026-06-09T10:00:00.000Z',
  changed_by: null,
  edit_intent: 'cosmetic',
};

function stubHistoryFetch(rows: unknown[]) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      versions: rows,
      total: rows.length,
      limit: 50,
      offset: 0,
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('QARevisionHistory (ID-59 {59.16})', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the Q&A history diff for the latest two revisions, incl edit_intent', async () => {
    // List is version-descending: NEWER (v2) then OLDER (v1).
    stubHistoryFetch([NEWER, OLDER]);
    const { Wrapper } = createQueryWrapper();

    render(<QARevisionHistory qaPairId={PAIR_ID} />, { wrapper: Wrapper });

    // Expand the section to trigger the fetch.
    await userEvent.click(
      screen.getByRole('button', { name: /revision history/i }),
    );

    // RevisionDiffView renders the changed text as a diff.
    await waitFor(() => {
      expect(screen.getByLabelText('Revision text diff')).toBeInTheDocument();
    });
    // The newer revision's edit_intent surfaces in the diff metadata.
    expect(screen.getByText(/data/i)).toBeInTheDocument();
    // Removal + addition of the changed answer wording.
    expect(screen.getByText(/eight hours/i)).toBeInTheDocument();
    expect(screen.getByText(/four hours/i)).toBeInTheDocument();
  });

  it('shows the explicit no-changes state when the two revisions are identical', async () => {
    stubHistoryFetch([
      NEWER,
      { ...OLDER, answer_standard: NEWER.answer_standard },
    ]);
    const { Wrapper } = createQueryWrapper();

    render(<QARevisionHistory qaPairId={PAIR_ID} />, { wrapper: Wrapper });

    await userEvent.click(
      screen.getByRole('button', { name: /revision history/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('revision-diff-empty')).toBeInTheDocument();
    });
  });

  it('shows an empty state when the pair has fewer than two revisions', async () => {
    stubHistoryFetch([NEWER]);
    const { Wrapper } = createQueryWrapper();

    render(<QARevisionHistory qaPairId={PAIR_ID} />, { wrapper: Wrapper });

    await userEvent.click(
      screen.getByRole('button', { name: /revision history/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/no earlier revision to compare/i),
      ).toBeInTheDocument();
    });
  });
});
