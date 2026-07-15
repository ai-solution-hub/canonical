/**
 * PromotionCandidatesPanel component tests (ID-145 {145.22} — TECH §5/§7
 * section I, BI-38/39).
 *
 * Acceptance (testStrategy): promotion candidates are reviewable; no record
 * is promoted without human confirmation (BI-39) — the panel must NOT call
 * the promote-corpus mutation on mount, only when the human clicks "Run
 * promotion pass"; an already-published-pair diff (DR-026 'awaiting_review')
 * is rendered honestly and never implied to be actionable; explicit
 * empty/loading/error states (INV-19 convention).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

const {
  mockFetchCandidates,
  mockPostPromote,
  mockPostAccept,
  mockPostEdit,
  mockPostReject,
} = vi.hoisted(() => ({
  mockFetchCandidates: vi.fn(),
  mockPostPromote: vi.fn(),
  mockPostAccept: vi.fn(),
  mockPostEdit: vi.fn(),
  mockPostReject: vi.fn(),
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return {
    ...actual,
    fetchQaPromotionCandidates: mockFetchCandidates,
    postQaPromoteCorpus: mockPostPromote,
    postQaPromotionCandidateAccept: mockPostAccept,
    postQaPromotionCandidateEdit: mockPostEdit,
    postQaPromotionCandidateReject: mockPostReject,
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PromotionCandidatesPanel } from '@/components/governance/promotion-gate/promotion-candidates-panel';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import type { QaPromotionCandidate } from '@/lib/query/fetchers';

const NEW_ID = '11111111-1111-4111-8111-111111111111';
const SELF_HEAL_ID = '22222222-2222-4222-8222-222222222222';
const AWAITING_REVIEW_ID = '33333333-3333-4333-8333-333333333333';

function makeCandidate(
  overrides: Partial<QaPromotionCandidate> = {},
): QaPromotionCandidate {
  return {
    id: NEW_ID,
    extractedQuestionText: 'What is your H&S policy?',
    extractedAnswerText: 'We maintain a documented H&S policy.',
    promotedToPairId: null,
    createdAt: '2026-07-01T08:00:00Z',
    kind: 'new',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installRadixPointerShims();
});

function renderPanel() {
  const { Wrapper } = createQueryWrapper();
  return render(<PromotionCandidatesPanel />, { wrapper: Wrapper });
}

describe('PromotionCandidatesPanel', () => {
  it('renders an explicit loading skeleton before data resolves', () => {
    mockFetchCandidates.mockReturnValueOnce(new Promise(() => {}));
    const { container } = renderPanel();
    expect(
      container.querySelector('[data-slot="skeleton"]'),
    ).toBeInTheDocument();
  });

  it('renders an explicit empty state when there are no candidates', async () => {
    mockFetchCandidates.mockResolvedValueOnce([]);
    renderPanel();
    await waitFor(() => {
      expect(
        screen.getByText(/no promotion candidates waiting/i),
      ).toBeInTheDocument();
    });
  });

  it('renders an explicit error panel with retry on fetch failure', async () => {
    mockFetchCandidates.mockRejectedValueOnce(new Error('boom'));
    renderPanel();
    await waitFor(() => {
      expect(
        screen.getByText(/failed to load promotion candidates/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('promotion-gate-list-retry')).toBeInTheDocument();
  });

  it('renders each candidate with an honest, non-colour-only kind label', async () => {
    mockFetchCandidates.mockResolvedValueOnce([
      makeCandidate({ id: NEW_ID, kind: 'new' }),
      makeCandidate({
        id: SELF_HEAL_ID,
        kind: 'self_healing',
        promotedToPairId: 'pair-1',
      }),
      makeCandidate({
        id: AWAITING_REVIEW_ID,
        kind: 'awaiting_review',
        promotedToPairId: 'pair-2',
      }),
    ]);
    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId(`promotion-gate-candidate-row-${NEW_ID}`),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId(`promotion-gate-candidate-kind-${NEW_ID}`),
    ).toHaveTextContent(/new/i);
    expect(
      screen.getByTestId(`promotion-gate-candidate-kind-${SELF_HEAL_ID}`),
    ).toHaveTextContent(/self-healing/i);
    expect(
      screen.getByTestId(`promotion-gate-candidate-kind-${AWAITING_REVIEW_ID}`),
    ).toHaveTextContent(/awaiting review/i);
  });

  it('does NOT trigger a promotion run on mount (BI-39 — human-gated, no auto-apply)', async () => {
    mockFetchCandidates.mockResolvedValueOnce([makeCandidate()]);
    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId(`promotion-gate-candidate-row-${NEW_ID}`),
      ).toBeInTheDocument();
    });
    expect(mockPostPromote).not.toHaveBeenCalled();
  });

  it('runs a promotion pass only after an explicit human click, then shows the last-run summary', async () => {
    mockFetchCandidates.mockResolvedValue([makeCandidate()]);
    mockPostPromote.mockResolvedValueOnce({
      considered: 1,
      promoted: 1,
      skipped: [],
      already_promoted: 0,
      embed_failed: 0,
      retired: 0,
      retired_no_replacement: 0,
      sidecar_failed: 0,
      failures: [],
      proposed: 1,
      proposals: [{ extractionId: AWAITING_REVIEW_ID, pairId: 'pair-2' }],
    });
    const user = userEvent.setup();
    renderPanel();

    const trigger = await screen.findByTestId('promotion-gate-run-trigger');
    await user.click(trigger);

    await waitFor(() => {
      expect(mockPostPromote).toHaveBeenCalledTimes(1);
    });

    const summary = await screen.findByTestId('promotion-gate-run-summary');
    expect(summary).toHaveTextContent(/1/); // promoted count surfaces somewhere
    // {145.30}: a published-pair diff is never AUTO-mutated (DR-026), but it
    // IS now individually actionable (accept/edit/reject) in the candidates
    // list above — the summary card points there rather than claiming "not
    // yet actionable".
    expect(summary).toHaveTextContent(/reviewable above/i);
  });

  it('surfaces a mutation failure without crashing and allows retry', async () => {
    mockFetchCandidates.mockResolvedValue([makeCandidate()]);
    mockPostPromote.mockRejectedValueOnce(new Error('promote boom'));
    const user = userEvent.setup();
    renderPanel();

    const trigger = await screen.findByTestId('promotion-gate-run-trigger');
    await user.click(trigger);

    await waitFor(() => {
      expect(mockPostPromote).toHaveBeenCalledTimes(1);
    });
    // Button is not left permanently disabled — a retry is possible.
    await waitFor(() => {
      expect(screen.getByTestId('promotion-gate-run-trigger')).toBeEnabled();
    });
  });

  // ---------------------------------------------------------------------
  // {145.30} — per-candidate accept/edit/reject, 'awaiting_review' ONLY.
  // 'new' / 'self_healing' candidates have no per-item write path (they
  // resolve wholesale via "Run promotion pass") — see
  // lib/q-a-pairs/promotion-candidate-review.ts's module header.
  // ---------------------------------------------------------------------
  describe('per-candidate accept/edit/reject (awaiting_review only)', () => {
    it('does NOT render accept/edit/reject affordances for new or self_healing candidates', async () => {
      mockFetchCandidates.mockResolvedValueOnce([
        makeCandidate({ id: NEW_ID, kind: 'new' }),
        makeCandidate({
          id: SELF_HEAL_ID,
          kind: 'self_healing',
          promotedToPairId: 'pair-1',
        }),
      ]);
      renderPanel();

      await waitFor(() => {
        expect(
          screen.getByTestId(`promotion-gate-candidate-row-${NEW_ID}`),
        ).toBeInTheDocument();
      });
      expect(
        screen.queryByTestId(`promotion-gate-candidate-accept-${NEW_ID}`),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(`promotion-gate-candidate-accept-${SELF_HEAL_ID}`),
      ).not.toBeInTheDocument();
    });

    it('renders accept/edit/reject affordances for an awaiting_review candidate', async () => {
      mockFetchCandidates.mockResolvedValueOnce([
        makeCandidate({ id: AWAITING_REVIEW_ID, kind: 'awaiting_review' }),
      ]);
      renderPanel();

      expect(
        await screen.findByTestId(
          `promotion-gate-candidate-accept-${AWAITING_REVIEW_ID}`,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(
          `promotion-gate-candidate-edit-${AWAITING_REVIEW_ID}`,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(
          `promotion-gate-candidate-reject-${AWAITING_REVIEW_ID}`,
        ),
      ).toBeInTheDocument();
    });

    it('accepts a candidate on click and refetches the list', async () => {
      mockFetchCandidates.mockResolvedValue([
        makeCandidate({ id: AWAITING_REVIEW_ID, kind: 'awaiting_review' }),
      ]);
      mockPostAccept.mockResolvedValueOnce({
        disposition: 'accepted',
        pair: { id: 'pair-x' },
        extraction: { id: AWAITING_REVIEW_ID },
      });
      const user = userEvent.setup();
      renderPanel();

      const acceptBtn = await screen.findByTestId(
        `promotion-gate-candidate-accept-${AWAITING_REVIEW_ID}`,
      );
      await user.click(acceptBtn);

      await waitFor(() => {
        expect(mockPostAccept).toHaveBeenCalledWith(AWAITING_REVIEW_ID);
      });
      // Refetch after mutation success (cache invalidation).
      await waitFor(() => {
        expect(mockFetchCandidates).toHaveBeenCalledTimes(2);
      });
    });

    it('rejects a candidate on click', async () => {
      mockFetchCandidates.mockResolvedValue([
        makeCandidate({ id: AWAITING_REVIEW_ID, kind: 'awaiting_review' }),
      ]);
      mockPostReject.mockResolvedValueOnce({
        disposition: 'rejected',
        pair: { id: 'pair-x' },
        extraction: { id: AWAITING_REVIEW_ID },
      });
      const user = userEvent.setup();
      renderPanel();

      const rejectBtn = await screen.findByTestId(
        `promotion-gate-candidate-reject-${AWAITING_REVIEW_ID}`,
      );
      await user.click(rejectBtn);

      await waitFor(() => {
        expect(mockPostReject).toHaveBeenCalledWith(AWAITING_REVIEW_ID);
      });
    });

    it('reveals a pre-filled edit form on Edit, then saves the edited fields', async () => {
      mockFetchCandidates.mockResolvedValue([
        makeCandidate({
          id: AWAITING_REVIEW_ID,
          kind: 'awaiting_review',
          extractedQuestionText: 'Original question?',
          extractedAnswerText: 'Original answer.',
        }),
      ]);
      mockPostEdit.mockResolvedValueOnce({
        disposition: 'edited',
        pair: { id: 'pair-x' },
        extraction: { id: AWAITING_REVIEW_ID },
      });
      const user = userEvent.setup();
      renderPanel();

      const editBtn = await screen.findByTestId(
        `promotion-gate-candidate-edit-${AWAITING_REVIEW_ID}`,
      );
      await user.click(editBtn);

      const questionField = await screen.findByTestId(
        `promotion-gate-candidate-edit-question-${AWAITING_REVIEW_ID}`,
      );
      expect(questionField).toHaveValue('Original question?');

      await user.clear(questionField);
      await user.type(questionField, 'Edited question?');

      const saveBtn = screen.getByTestId(
        `promotion-gate-candidate-edit-save-${AWAITING_REVIEW_ID}`,
      );
      await user.click(saveBtn);

      await waitFor(() => {
        expect(mockPostEdit).toHaveBeenCalledWith(AWAITING_REVIEW_ID, {
          question_text: 'Edited question?',
          answer_standard: 'Original answer.',
        });
      });
    });

    it('cancels edit mode without calling the mutation', async () => {
      mockFetchCandidates.mockResolvedValue([
        makeCandidate({ id: AWAITING_REVIEW_ID, kind: 'awaiting_review' }),
      ]);
      const user = userEvent.setup();
      renderPanel();

      const editBtn = await screen.findByTestId(
        `promotion-gate-candidate-edit-${AWAITING_REVIEW_ID}`,
      );
      await user.click(editBtn);

      const cancelBtn = await screen.findByTestId(
        `promotion-gate-candidate-edit-cancel-${AWAITING_REVIEW_ID}`,
      );
      await user.click(cancelBtn);

      expect(
        screen.queryByTestId(
          `promotion-gate-candidate-edit-question-${AWAITING_REVIEW_ID}`,
        ),
      ).not.toBeInTheDocument();
      expect(mockPostEdit).not.toHaveBeenCalled();
    });

    it('surfaces an accept failure via toast without crashing', async () => {
      mockFetchCandidates.mockResolvedValue([
        makeCandidate({ id: AWAITING_REVIEW_ID, kind: 'awaiting_review' }),
      ]);
      mockPostAccept.mockRejectedValueOnce(new Error('accept boom'));
      const user = userEvent.setup();
      renderPanel();

      const acceptBtn = await screen.findByTestId(
        `promotion-gate-candidate-accept-${AWAITING_REVIEW_ID}`,
      );
      await user.click(acceptBtn);

      await waitFor(() => {
        expect(mockPostAccept).toHaveBeenCalledTimes(1);
      });
      // Not left permanently disabled — a retry is possible.
      await waitFor(() => {
        expect(
          screen.getByTestId(
            `promotion-gate-candidate-accept-${AWAITING_REVIEW_ID}`,
          ),
        ).toBeEnabled();
      });
    });
  });
});
