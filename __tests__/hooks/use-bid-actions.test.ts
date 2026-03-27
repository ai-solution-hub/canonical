import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();

// IMPORTANT: return a STABLE object reference — if the router object
// identity changes on every render, the useCallback deps that include
// `router` become unstable, causing the useEffect to re-fire in a loop.
const stableRouter = {
  push: mockPush,
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => stableRouter,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

const mockCanTransition = vi.fn(() => true);
const mockGetAvailableTransitions = vi.fn(() => ['drafting', 'submitted']);

vi.mock('@/lib/bid/bid-state-machine', () => ({
  canTransition: (...args: unknown[]) => mockCanTransition(...args),
  getAvailableTransitions: (...args: unknown[]) => mockGetAvailableTransitions(...args),
  BID_STATE_LABELS: {
    draft: 'Draft',
    questions_extracted: 'Questions Extracted',
    matching: 'Matching',
    drafting: 'Drafting',
    in_review: 'In Review',
    ready_for_export: 'Ready for Export',
    submitted: 'Submitted',
    won: 'Won',
    lost: 'Lost',
    withdrawn: 'Withdrawn',
  },
}));

import { toast } from 'sonner';
import { useBidActions } from '@/hooks/use-bid-actions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_BID = {
  id: 'bid-1',
  name: 'Test Bid',
  status: 'drafting' as const,
  description: 'A test bid',
  domain_metadata: {
    buyer: 'Acme Corp',
    status: 'drafting' as const,
    deadline: null,
    reference_number: null,
    estimated_value: null,
    tender_source: null,
    tender_document_ids: ['doc-1', 'doc-2'],
    submission_date: null,
    outcome: null,
    outcome_notes: null,
    notes: null,
  },
  question_stats: {
    total_questions: 10,
    strong_match_count: 2,
    partial_match_count: 3,
    needs_sme_count: 1,
    no_content_count: 0,
    unmatched_count: 4,
    drafted_count: 3,
    complete_count: 2,
  },
  created_by: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

const DEFAULT_QUESTIONS = [
  {
    id: 'q-1',
    project_id: 'bid-1',
    section_name: 'Section A',
    section_sequence: 1,
    question_sequence: 1,
    question_text: 'Describe your approach',
    word_limit: 500,
    evaluation_weight: null,
    confidence_posture: 'strong_match' as const,
    matched_content_ids: null,
    status: 'ai_drafted' as const,
    has_variants: false,
    assigned_to: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const DEFAULT_STATS = {
  total_questions: 10,
  strong_match_count: 2,
  partial_match_count: 3,
  needs_sme_count: 1,
  no_content_count: 0,
  unmatched_count: 4,
  drafted_count: 3,
  complete_count: 2,
};

let mockFetch: ReturnType<typeof vi.fn>;

/**
 * Creates a mock fetch that handles all standard routes.
 */
function createMockFetch(bidOverrides = {}, questionsOverrides = {}) {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    if (opts?.method === 'DELETE')
      return { ok: true, json: async () => ({}) };
    if (opts?.method === 'PATCH')
      return { ok: true, json: async () => ({}) };
    if (opts?.method === 'POST') {
      if (url.includes('/match'))
        return { ok: true, json: async () => ({ matched: 3 }) };
      if (url.includes('/draft-all'))
        return {
          ok: true,
          json: async () => ({
            drafted: 5, skipped: 2, failed: 0, total_cost: 0.15,
          }),
        };
      return { ok: true, json: async () => ({}) };
    }
    if (url.includes('/questions')) {
      return {
        ok: true,
        json: async () => ({
          questions: DEFAULT_QUESTIONS,
          stats: DEFAULT_STATS,
          ...questionsOverrides,
        }),
      };
    }
    if (url.includes('/bids/')) {
      return {
        ok: true,
        json: async () => ({ ...DEFAULT_BID, ...bidOverrides }),
      };
    }
    return { ok: false, json: async () => ({}) };
  });
}

/**
 * Render the hook and wait for loading to complete.
 */
async function renderAndWait(id = 'bid-1') {
  const hookResult = renderHook(() => useBidActions({ id }));
  await waitFor(() => {
    expect(hookResult.result.current.loading).toBe(false);
  });
  return hookResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBidActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanTransition.mockReturnValue(true);
    mockGetAvailableTransitions.mockReturnValue(['drafting', 'submitted']);

    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('returns loading=true initially', () => {
      const { result } = renderHook(() => useBidActions({ id: 'bid-1' }));
      expect(result.current.loading).toBe(true);
    });

    it('defaults activeTab to overview', () => {
      const { result } = renderHook(() => useBidActions({ id: 'bid-1' }));
      expect(result.current.activeTab).toBe('overview');
    });
  });

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  describe('data fetching', () => {
    it('fetches bid and questions on mount', async () => {
      const { result } = renderHook(() => useBidActions({ id: 'bid-1' }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const urls = mockFetch.mock.calls.map(
        (call: [string, ...unknown[]]) => call[0],
      );
      expect(urls).toContain('/api/bids/bid-1');
      expect(urls).toContain('/api/bids/bid-1/questions');
    });

    it('sets bid data after successful fetch', async () => {
      const { result } = await renderAndWait();

      expect(result.current.bid!.id).toBe('bid-1');
      expect(result.current.bid!.name).toBe('Test Bid');
      expect(result.current.loading).toBe(false);
    });

    it('sets questions from API response', async () => {
      const { result } = await renderAndWait();

      expect(result.current.questions).toHaveLength(1);
      expect(result.current.questions[0].id).toBe('q-1');
      expect(result.current.questions[0].question_text).toBe(
        'Describe your approach',
      );
    });

    it('sets stats from questions API response', async () => {
      const { result } = await renderAndWait();

      expect(result.current.stats).not.toBeNull();
      expect(result.current.stats!.total_questions).toBe(10);
      expect(result.current.stats!.drafted_count).toBe(3);
    });

    it('redirects to /bid on 404', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('/questions'))
            return { ok: true, json: async () => ({ questions: [], stats: null }) };
          return { ok: false, status: 404, json: async () => ({}) };
        }),
      );

      const { result } = renderHook(() =>
        useBidActions({ id: 'nonexistent' }),
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockPush).toHaveBeenCalledWith('/bid');
      expect(toast.error).toHaveBeenCalledWith('Bid not found');
    });

    it('shows error toast on fetch failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('/questions'))
            return { ok: true, json: async () => ({ questions: [], stats: null }) };
          throw new Error('Network error');
        }),
      );

      const { result } = renderHook(() => useBidActions({ id: 'bid-1' }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(toast.error).toHaveBeenCalledWith('Failed to load bid');
    });
  });

  // -------------------------------------------------------------------------
  // Status transitions
  // -------------------------------------------------------------------------

  describe('status transitions', () => {
    it('PATCHes bid with new status on handleStatusTransition', async () => {
      const { result } = await renderAndWait();

      await act(async () => {
        await result.current.handleStatusTransition('in_review');
      });

      const patchCall = mockFetch.mock.calls.find(
        (call: [string, RequestInit?]) => call[1]?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(patchCall![0]).toBe('/api/bids/bid-1');
      expect(JSON.parse(patchCall![1]!.body as string)).toEqual({
        status: 'in_review',
      });
    });

    it('shows success toast after status transition', async () => {
      const { result } = await renderAndWait();

      await act(async () => {
        await result.current.handleStatusTransition('in_review');
      });

      expect(toast.success).toHaveBeenCalledWith('Bid moved to In Review');
    });

    it('shows error when canTransition returns false', async () => {
      const { result } = await renderAndWait();

      mockCanTransition.mockReturnValue(false);

      await act(async () => {
        await result.current.handleStatusTransition('won');
      });

      expect(toast.error).toHaveBeenCalledWith(
        'Cannot transition from Drafting to Won',
      );
      const patchCall = mockFetch.mock.calls.find(
        (call: [string, RequestInit?]) => call[1]?.method === 'PATCH',
      );
      expect(patchCall).toBeUndefined();
    });

    it('sets transitioning=true during request', async () => {
      const { result } = await renderAndWait();

      let resolvePatch!: () => void;
      const patchGate = new Promise<void>((r) => { resolvePatch = r; });

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, opts?: RequestInit) => {
          if (opts?.method === 'PATCH') {
            await patchGate;
            return { ok: true, json: async () => ({}) };
          }
          if (url.includes('/questions'))
            return { ok: true, json: async () => ({ questions: DEFAULT_QUESTIONS, stats: DEFAULT_STATS }) };
          return { ok: true, json: async () => ({ ...DEFAULT_BID }) };
        }),
      );

      let transitionPromise: Promise<void>;
      act(() => {
        transitionPromise = result.current.handleStatusTransition('in_review');
      });

      expect(result.current.transitioning).toBe(true);

      await act(async () => {
        resolvePatch();
        await transitionPromise!;
      });

      expect(result.current.transitioning).toBe(false);
    });

    it('includes submission_date when transitioning to submitted', async () => {
      const { result } = await renderAndWait();

      await act(async () => {
        await result.current.handleStatusTransition('submitted');
      });

      const patchCall = mockFetch.mock.calls.find(
        (call: [string, RequestInit?]) => call[1]?.method === 'PATCH',
      );
      const body = JSON.parse(patchCall![1]!.body as string);
      expect(body.status).toBe('submitted');
      expect(body.submission_date).toBeDefined();
    });

    it('shows error toast on PATCH failure', async () => {
      const { result } = await renderAndWait();

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, opts?: RequestInit) => {
          if (opts?.method === 'PATCH')
            return { ok: false, json: async () => ({ error: 'Server error' }) };
          if (url.includes('/questions'))
            return { ok: true, json: async () => ({ questions: DEFAULT_QUESTIONS, stats: DEFAULT_STATS }) };
          return { ok: true, json: async () => ({ ...DEFAULT_BID }) };
        }),
      );

      await act(async () => {
        await result.current.handleStatusTransition('in_review');
      });

      expect(toast.error).toHaveBeenCalledWith('Server error');
    });
  });

  // -------------------------------------------------------------------------
  // Question handling
  // -------------------------------------------------------------------------

  describe('question handling', () => {
    it('handleUploadComplete refreshes bid and questions', async () => {
      const { result } = await renderAndWait();

      mockFetch.mockClear();

      act(() => {
        result.current.handleUploadComplete({
          sections: [],
          total_questions: 0,
          total_sections: 0,
          format: 'docx',
          extraction_method: 'programmatic',
        });
      });

      await waitFor(() => {
        const urls = mockFetch.mock.calls.map(
          (call: [string, ...unknown[]]) => call[0],
        );
        expect(urls).toContain('/api/bids/bid-1');
        expect(urls).toContain('/api/bids/bid-1/questions');
      });
    });

    it('handleUploadComplete opens question review when sections extracted', async () => {
      const { result } = await renderAndWait();

      act(() => {
        result.current.handleUploadComplete({
          sections: [
            {
              section_name: 'Section A',
              section_sequence: 1,
              questions: [
                { question_text: 'Question 1', question_sequence: 1, word_limit: 200, evaluation_weight: null, category: 'mandatory' as const },
                { question_text: 'Question 2', question_sequence: 2, word_limit: null, evaluation_weight: null, category: 'desirable' as const },
              ],
            },
          ],
          total_questions: 2,
          total_sections: 1,
          format: 'docx' as const,
          extraction_method: 'programmatic' as const,
        });
      });

      expect(result.current.showQuestionReview).toBe(true);
      expect(result.current.extractedQuestions).toHaveLength(2);
      expect(result.current.extractedQuestions[0].section_name).toBe('Section A');
      expect(result.current.extractedQuestions[0].question_text).toBe('Question 1');
      expect(result.current.extractedQuestions[1].question_text).toBe('Question 2');
      expect(result.current.activeTab).toBe('questions');
    });

    it('handleQuestionReviewConfirmed clears review state and refreshes', async () => {
      const { result } = await renderAndWait();

      // First trigger review state
      act(() => {
        result.current.handleUploadComplete({
          sections: [{
            section_name: 'S1', section_sequence: 1,
            questions: [{ question_text: 'Q1', question_sequence: 1, word_limit: null, evaluation_weight: null, category: 'mandatory' as const }],
          }],
          total_questions: 1, total_sections: 1,
          format: 'docx' as const, extraction_method: 'programmatic' as const,
        });
      });

      expect(result.current.showQuestionReview).toBe(true);
      mockFetch.mockClear();

      act(() => {
        result.current.handleQuestionReviewConfirmed();
      });

      expect(result.current.showQuestionReview).toBe(false);
      expect(result.current.extractedQuestions).toHaveLength(0);

      await waitFor(() => {
        const urls = mockFetch.mock.calls.map(
          (call: [string, ...unknown[]]) => call[0],
        );
        expect(urls).toContain('/api/bids/bid-1/questions');
      });
    });

    it('handleQuestionReviewCancelled clears review state without refreshing', async () => {
      const { result } = await renderAndWait();

      act(() => {
        result.current.handleUploadComplete({
          sections: [{
            section_name: 'S1', section_sequence: 1,
            questions: [{ question_text: 'Q1', question_sequence: 1, word_limit: null, evaluation_weight: null, category: 'mandatory' as const }],
          }],
          total_questions: 1, total_sections: 1,
          format: 'docx' as const, extraction_method: 'programmatic' as const,
        });
      });

      mockFetch.mockClear();

      act(() => {
        result.current.handleQuestionReviewCancelled();
      });

      expect(result.current.showQuestionReview).toBe(false);
      expect(result.current.extractedQuestions).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  describe('actions', () => {
    it('handleDelete opens confirm dialog, handleDeleteConfirmed calls DELETE and navigates', async () => {
      const { result } = await renderAndWait();

      // handleDelete should open the confirmation dialog
      act(() => {
        result.current.handleDelete();
      });
      expect(result.current.deleteConfirmOpen).toBe(true);

      // handleDeleteConfirmed should perform the actual deletion
      await act(async () => {
        await result.current.handleDeleteConfirmed();
      });

      const deleteCall = mockFetch.mock.calls.find(
        (call: [string, RequestInit?]) => call[1]?.method === 'DELETE',
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall![0]).toBe('/api/bids/bid-1');
      expect(toast.success).toHaveBeenCalledWith('Bid deleted');
      expect(mockPush).toHaveBeenCalledWith('/bid');
      expect(result.current.deleteConfirmOpen).toBe(false);
    });

    it('handleDeleteConfirmed shows error toast on DELETE failure', async () => {
      const { result } = await renderAndWait();

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, opts?: RequestInit) => {
          if (opts?.method === 'DELETE')
            return { ok: false, json: async () => ({ error: 'Cannot delete' }) };
          if (url.includes('/questions'))
            return { ok: true, json: async () => ({ questions: DEFAULT_QUESTIONS, stats: DEFAULT_STATS }) };
          return { ok: true, json: async () => ({ ...DEFAULT_BID }) };
        }),
      );

      await act(async () => {
        await result.current.handleDeleteConfirmed();
      });

      expect(toast.error).toHaveBeenCalledWith('Cannot delete');
      expect(mockPush).not.toHaveBeenCalledWith('/bid');
    });

    it('handleMatchQuestions calls POST to match endpoint', async () => {
      const { result } = await renderAndWait();

      await act(async () => {
        await result.current.handleMatchQuestions();
      });

      const postCall = mockFetch.mock.calls.find(
        (call: [string, RequestInit?]) =>
          call[0].includes('/match') && call[1]?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      expect(postCall![0]).toBe('/api/bids/bid-1/questions/match');
      expect(toast.success).toHaveBeenCalledWith('Matched 3 questions against KB');
    });

    it('handleMatchQuestions shows error toast on failure', async () => {
      const { result } = await renderAndWait();

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, opts?: RequestInit) => {
          if (opts?.method === 'POST' && url.includes('/match'))
            return { ok: false, json: async () => ({ error: 'Match failed' }) };
          if (url.includes('/questions'))
            return { ok: true, json: async () => ({ questions: DEFAULT_QUESTIONS, stats: DEFAULT_STATS }) };
          return { ok: true, json: async () => ({ ...DEFAULT_BID }) };
        }),
      );

      await act(async () => {
        await result.current.handleMatchQuestions();
      });

      expect(toast.error).toHaveBeenCalledWith('Match failed');
    });

    it('handleDraftAll calls POST to draft-all endpoint and shows results', async () => {
      const { result } = await renderAndWait();

      await act(async () => {
        await result.current.handleDraftAll();
      });

      const postCall = mockFetch.mock.calls.find(
        (call: [string, RequestInit?]) =>
          call[0].includes('/draft-all') && call[1]?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      expect(postCall![0]).toBe('/api/bids/bid-1/responses/draft-all');
      expect(JSON.parse(postCall![1]!.body as string)).toEqual({ skip_existing: true });
      expect(toast.success).toHaveBeenCalledWith('Drafted 5 responses (2 skipped)');
      expect(toast.info).toHaveBeenCalledWith('Total cost: $0.1500');
    });

    it('handleDraftAll sets draftingAll=true during request', async () => {
      const { result } = await renderAndWait();

      let resolveDraft!: () => void;
      const draftGate = new Promise<void>((r) => { resolveDraft = r; });

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, opts?: RequestInit) => {
          if (opts?.method === 'POST' && url.includes('/draft-all')) {
            await draftGate;
            return { ok: true, json: async () => ({ drafted: 5, skipped: 2, failed: 0, total_cost: 0.0 }) };
          }
          if (url.includes('/questions'))
            return { ok: true, json: async () => ({ questions: DEFAULT_QUESTIONS, stats: DEFAULT_STATS }) };
          return { ok: true, json: async () => ({ ...DEFAULT_BID }) };
        }),
      );

      let draftAllPromise: Promise<void>;
      act(() => {
        draftAllPromise = result.current.handleDraftAll();
      });

      expect(result.current.draftingAll).toBe(true);

      await act(async () => {
        resolveDraft();
        await draftAllPromise!;
      });

      expect(result.current.draftingAll).toBe(false);
    });

    it('handleDraftAll shows warning toast when some drafts fail', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, opts?: RequestInit) => {
          if (opts?.method === 'POST' && url.includes('/draft-all'))
            return { ok: true, json: async () => ({ drafted: 3, skipped: 1, failed: 2, total_cost: 0.1 }) };
          if (url.includes('/questions'))
            return { ok: true, json: async () => ({ questions: DEFAULT_QUESTIONS, stats: DEFAULT_STATS }) };
          return { ok: true, json: async () => ({ ...DEFAULT_BID }) };
        }),
      );

      const { result } = renderHook(() => useBidActions({ id: 'bid-1' }));
      await waitFor(() => { expect(result.current.loading).toBe(false); });

      await act(async () => {
        await result.current.handleDraftAll();
      });

      expect(toast.warning).toHaveBeenCalledWith(
        'Drafted 3 responses, 2 failed, 1 skipped',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Computed values
  // -------------------------------------------------------------------------

  describe('computed values', () => {
    it('progressPercent calculates correctly from stats', async () => {
      const { result } = await renderAndWait();
      // drafted_count=3, complete_count=2 => completed=5, total=10 => 50%
      expect(result.current.progressPercent).toBe(50);
    });

    it('progressPercent is 0 when no questions exist', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('/questions'))
            return { ok: true, json: async () => ({ questions: [], stats: { total_questions: 0, drafted_count: 0, complete_count: 0 } }) };
          return { ok: true, json: async () => ({ ...DEFAULT_BID, question_stats: { total_questions: 0, drafted_count: 0, complete_count: 0 } }) };
        }),
      );

      const { result } = renderHook(() => useBidActions({ id: 'bid-1' }));
      await waitFor(() => { expect(result.current.loading).toBe(false); });

      expect(result.current.progressPercent).toBe(0);
    });

    it('tabs include correct counts', async () => {
      const { result } = await renderAndWait();

      const tabsById = Object.fromEntries(
        result.current.tabs.map((t) => [t.id, t]),
      );

      expect(tabsById['overview'].label).toBe('Overview');
      expect(tabsById['overview'].count).toBeUndefined();
      expect(tabsById['questions'].label).toBe('Questions');
      expect(tabsById['questions'].count).toBe(10);
      expect(tabsById['documents'].label).toBe('Documents');
      expect(tabsById['documents'].count).toBe(2);
      expect(tabsById['responses'].label).toBe('Responses');
      expect(tabsById['responses'].count).toBeUndefined();
    });

    it('bidStatus defaults to draft when bid.status is undefined', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('/questions'))
            return { ok: true, json: async () => ({ questions: DEFAULT_QUESTIONS, stats: DEFAULT_STATS }) };
          return { ok: true, json: async () => ({ ...DEFAULT_BID, status: undefined }) };
        }),
      );

      const { result } = renderHook(() => useBidActions({ id: 'bid-1' }));
      await waitFor(() => { expect(result.current.bid).not.toBeNull(); });

      // S117 promoted status to a proper column — no JSONB metadata fallback
      expect(result.current.bidStatus).toBe('draft');
    });

    it('availableTransitions uses getAvailableTransitions with current status', async () => {
      mockGetAvailableTransitions.mockReturnValue(['in_review', 'withdrawn']);

      const { result } = await renderAndWait();

      expect(result.current.availableTransitions).toEqual(['in_review', 'withdrawn']);
      expect(mockGetAvailableTransitions).toHaveBeenCalledWith('drafting');
    });

    it('regularTransitions filters outcome states when bid is submitted', async () => {
      mockGetAvailableTransitions.mockReturnValue(['won', 'lost', 'in_review', 'withdrawn']);

      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('/questions'))
            return { ok: true, json: async () => ({ questions: DEFAULT_QUESTIONS, stats: DEFAULT_STATS }) };
          return { ok: true, json: async () => ({ ...DEFAULT_BID, status: 'submitted' }) };
        }),
      );

      const { result } = renderHook(() => useBidActions({ id: 'bid-1' }));
      await waitFor(() => { expect(result.current.bid).not.toBeNull(); });

      expect(result.current.isSubmitted).toBe(true);
      expect(result.current.regularTransitions).toEqual(['in_review']);
    });
  });

  // -------------------------------------------------------------------------
  // Outcome and KB integration
  // -------------------------------------------------------------------------

  describe('outcome and KB integration', () => {
    it('handleOutcomeRecorded closes dialog and refreshes bid', async () => {
      const { result } = await renderAndWait();

      act(() => { result.current.setShowOutcomeDialog(true); });
      expect(result.current.showOutcomeDialog).toBe(true);

      act(() => { result.current.handleOutcomeRecorded('won', []); });

      expect(result.current.showOutcomeDialog).toBe(false);
      expect(result.current.showKBReview).toBe(false);
    });

    it('handleOutcomeRecorded opens KB review when candidates exist', async () => {
      const { result } = await renderAndWait();

      const candidates = [
        { question_id: 'q-1', question_text: 'Q1', response_text: 'R1', source_content_ids: null, recommendation: 'new_entry' as const },
      ];

      act(() => { result.current.handleOutcomeRecorded('won', candidates); });

      expect(result.current.showKBReview).toBe(true);
      expect(result.current.kbCandidates).toEqual(candidates);
    });

    it('handleKBIntegrationComplete closes review and shows success toast', async () => {
      const { result } = await renderAndWait();

      act(() => {
        result.current.handleKBIntegrationComplete({ created: 3, updated: 1 });
      });

      expect(result.current.showKBReview).toBe(false);
      expect(result.current.kbCandidates).toEqual([]);
      expect(toast.success).toHaveBeenCalledWith(
        'KB integration complete: 3 created, 1 updated',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Tab management
  // -------------------------------------------------------------------------

  describe('tab management', () => {
    it('setActiveTab changes the active tab', async () => {
      const { result } = await renderAndWait();

      act(() => { result.current.setActiveTab('questions'); });
      expect(result.current.activeTab).toBe('questions');

      act(() => { result.current.setActiveTab('documents'); });
      expect(result.current.activeTab).toBe('documents');
    });
  });

  // -------------------------------------------------------------------------
  // Extracted metadata
  // -------------------------------------------------------------------------

  describe('extracted metadata', () => {
    it('clearExtractedMetadata resets metadata and refreshes bid', async () => {
      const { result } = await renderAndWait();
      mockFetch.mockClear();

      act(() => { result.current.clearExtractedMetadata(); });

      expect(result.current.extractedMetadata).toBeNull();

      await waitFor(() => {
        const urls = mockFetch.mock.calls.map(
          (call: [string, ...unknown[]]) => call[0],
        );
        expect(urls).toContain('/api/bids/bid-1');
      });
    });
  });
});
