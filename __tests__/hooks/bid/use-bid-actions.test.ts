import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BidState, ExtractionResult } from '@/types/bid';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { hoistedBidId, hoistedMockSearchParams, hoistedMockRouter } = vi.hoisted(
  () => {
    const id = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const searchParams = { current: new URLSearchParams() };
    const router = {
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    };
    return {
      hoistedBidId: id,
      hoistedMockSearchParams: searchParams,
      hoistedMockRouter: router,
    };
  },
);

const mockPush = hoistedMockRouter.push;
const mockReplace = hoistedMockRouter.replace;

vi.mock('next/navigation', () => ({
  useRouter: () => hoistedMockRouter,
  useSearchParams: () => hoistedMockSearchParams.current,
  usePathname: () => `/bid/${hoistedBidId}`,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

const mockCanTransition = vi.fn((..._args: unknown[]) => true);
const mockGetAvailableTransitions = vi.fn((..._args: unknown[]) => [
  'drafting',
  'submitted',
]);

vi.mock('@/lib/bid/bid-state-machine', () => ({
  canTransition: (...args: unknown[]) => mockCanTransition(...args),
  getAvailableTransitions: (...args: unknown[]) =>
    mockGetAvailableTransitions(...args),
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
import { useBidActions } from '@/hooks/bid/use-bid-actions';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_BID_ID = hoistedBidId;

const MOCK_BID = {
  id: TEST_BID_ID,
  title: 'Test Bid',
  status: 'drafting',
  domain_metadata: {
    tender_document_ids: ['doc-1', 'doc-2'],
  },
  question_stats: {
    total_questions: 10,
    drafted_count: 3,
    complete_count: 2,
  },
};

const MOCK_QUESTIONS_RESPONSE = {
  questions: [
    { id: 'q1', question_text: 'Question 1', status: 'drafted' },
    { id: 'q2', question_text: 'Question 2', status: 'pending' },
  ],
  stats: {
    total_questions: 15,
    drafted_count: 5,
    complete_count: 3,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return {
    queryClient,
    Wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
    },
  };
}

function mockFetchSuccess(overrides?: {
  bid?: unknown;
  questions?: unknown;
  bidStatus?: number;
}) {
  const bid = overrides?.bid ?? MOCK_BID;
  const questionsResp = overrides?.questions ?? MOCK_QUESTIONS_RESPONSE;
  const bidStatus = overrides?.bidStatus ?? 200;

  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    // Bid detail GET
    if (
      url === `/api/bids/${TEST_BID_ID}` &&
      (!init?.method || init?.method === 'GET')
    ) {
      if (bidStatus === 404) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({}),
        });
      }
      return Promise.resolve({
        ok: true,
        status: bidStatus,
        json: async () => bid,
      });
    }
    // Questions GET
    if (
      url === `/api/bids/${TEST_BID_ID}/questions` &&
      (!init?.method || init?.method === 'GET')
    ) {
      return Promise.resolve({
        ok: true,
        json: async () => questionsResp,
      });
    }
    // PATCH (status transition)
    if (url === `/api/bids/${TEST_BID_ID}` && init?.method === 'PATCH') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...MOCK_BID, ...JSON.parse(init.body as string) }),
      });
    }
    // DELETE
    if (url === `/api/bids/${TEST_BID_ID}` && init?.method === 'DELETE') {
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    }
    // Match questions
    if (
      url === `/api/bids/${TEST_BID_ID}/questions/match` &&
      init?.method === 'POST'
    ) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ matched: 5 }),
      });
    }
    // Draft all — post-S224 §5.4.1 D-4 contract: route returns 202 with
    // queued envelope, then UI polls /api/jobs/:id/status.
    if (
      url === `/api/bids/${TEST_BID_ID}/responses/draft-all` &&
      init?.method === 'POST'
    ) {
      return Promise.resolve({
        ok: true,
        status: 202,
        json: async () => ({
          job_id: STUB_JOB_ID,
          pipeline_run_id: STUB_PIPELINE_RUN_ID,
          status: 'queued',
          deduplicated: false,
        }),
      });
    }
    // Job status polling — terminal completed by default (per polling
    // tests override with their own polling sequences).
    if (url === `/api/jobs/${STUB_JOB_ID}/status` &&
        (!init?.method || init.method === 'GET')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: STUB_JOB_ID,
          job_type: 'bid_draft_all',
          status: 'completed',
          result: {
            drafted: 8,
            skipped: 2,
            failed: 0,
            total_cost: 0.05,
          },
          error_message: null,
        }),
      });
    }
    return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
  });
}

// Stub UUIDs for the queued + polling contract.
const STUB_JOB_ID = 'aabbccdd-eeff-4011-8022-001122334455';
const STUB_PIPELINE_RUN_ID = 'bbccddee-ff00-4022-8033-112233445566';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBidActions (TanStack Query)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedMockSearchParams.current = new URLSearchParams();
    mockCanTransition.mockReturnValue(true);
    mockGetAvailableTransitions.mockReturnValue(['drafting', 'submitted']);
  });

  // ─── 1. Initial loading state ─────────────────────────────────────────

  it('returns loading=true initially', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.bid).toBeNull();
  });

  // ─── 2. Bid data populated from query ─────────────────────────────────

  it('populates bid data from query', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    expect(result.current.bid?.title).toBe('Test Bid');
    expect(result.current.loading).toBe(false);
  });

  // ─── 3. Questions populated from query ────────────────────────────────

  it('populates questions from query', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.questions.length).toBeGreaterThan(0);
    });

    expect(result.current.questions).toHaveLength(2);
    expect(result.current.questions[0].question_text).toBe('Question 1');
  });

  // ─── 4. Stats from questions query take priority ──────────────────────

  it('uses stats from questions query over bid query', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.stats).not.toBeNull();
    });

    // Questions query stats (total_questions: 15) take priority over bid stats (10)
    expect(result.current.stats?.total_questions).toBe(15);
  });

  it('falls back to bid question_stats when questions query has no stats', async () => {
    mockFetchSuccess({
      questions: { questions: [], stats: null },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    expect(result.current.stats?.total_questions).toBe(10);
  });

  // ─── 5. 404 redirect handling ─────────────────────────────────────────

  it('redirects to /bid on 404', async () => {
    mockFetchSuccess({ bidStatus: 404 });
    const { Wrapper } = createWrapper();
    renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Bid not found');
    });
    expect(mockPush).toHaveBeenCalledWith('/bid');
  });

  // ─── 6. handleStatusTransition calls mutation ─────────────────────────

  it('handleStatusTransition calls PATCH with correct body', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleStatusTransition('in_review' as BidState);
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/bids/${TEST_BID_ID}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'in_review' }),
        }),
      );
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Bid moved to In Review');
    });
  });

  it('handleStatusTransition adds submission_date for submitted status', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleStatusTransition('submitted' as BidState);
    });

    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find(
        (c: unknown[]) => (c[1] as Record<string, string>)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse(patchCall![1].body);
      expect(body.status).toBe('submitted');
      expect(body.submission_date).toBeDefined();
    });
  });

  // ─── 7. handleStatusTransition rejects invalid transitions ────────────

  it('rejects invalid transitions with toast error', async () => {
    mockCanTransition.mockReturnValue(false);
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleStatusTransition('won' as BidState);
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Cannot transition from Drafting to Won',
    );
  });

  it('handleStatusTransition shows error toast on API failure', async () => {
    mockCanTransition.mockReturnValue(true);
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    // Override PATCH to fail
    vi.mocked(global.fetch).mockImplementation(async (url, init) => {
      if (
        String(url) === `/api/bids/${TEST_BID_ID}` &&
        init?.method === 'PATCH'
      ) {
        return {
          ok: false,
          json: async () => ({ error: 'Status change not allowed' }),
        } as Response;
      }
      // Default success for GET requests
      return { ok: true, json: async () => MOCK_BID } as Response;
    });

    await act(async () => {
      result.current.handleStatusTransition('in_review' as BidState);
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Status change not allowed');
    });
  });

  // ─── 8. handleDeleteConfirmed calls mutation and redirects ────────────

  it('handleDeleteConfirmed deletes and redirects', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleDeleteConfirmed();
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/bids/${TEST_BID_ID}`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Bid deleted');
      expect(mockPush).toHaveBeenCalledWith('/bid');
    });
  });

  // ─── 9. handleMatchQuestions calls mutation and invalidates ────────────

  it('handleMatchQuestions calls POST and shows success', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleMatchQuestions();
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/bids/${TEST_BID_ID}/questions/match`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Matched 5 questions against KB',
      );
    });
  });

  // ─── 10. handleDraftAll — post-S224 §5.4.1 queued contract ─────────────
  //
  // Mutation success → "queued" toast immediately; polling /api/jobs/:id/status
  // every 3s; on terminal completion → success/warning/error toast.

  it('handleDraftAll shows queued toast on mutation success (deduplicated:false)', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleDraftAll();
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "Drafting all responses queued — we'll let you know when it's done.",
      );
    });
  });

  it('handleDraftAll shows "Already drafting" info toast when deduplicated:true', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (
        url === `/api/bids/${TEST_BID_ID}` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({ ok: true, json: async () => MOCK_BID });
      }
      if (
        url === `/api/bids/${TEST_BID_ID}/questions` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => MOCK_QUESTIONS_RESPONSE,
        });
      }
      if (url.includes('draft-all') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            job_id: STUB_JOB_ID,
            pipeline_run_id: STUB_PIPELINE_RUN_ID,
            status: 'queued',
            deduplicated: true,
          }),
        });
      }
      // Polling: stay pending so the test can assert without terminal
      // path mutating the toast.
      if (url.includes('/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: STUB_JOB_ID,
            job_type: 'bid_draft_all',
            status: 'pending',
            result: null,
            error_message: null,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleDraftAll();
    });

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        'Already drafting — using existing job…',
      );
    });
  });

  it('handleDraftAll shows success toast on terminal status=completed (no failures)', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleDraftAll();
    });

    // Wait for both the queued toast AND the terminal success toast
    // (driven by the default polling-completed mock).
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Drafted 8 responses (2 skipped)',
      );
      expect(toast.info).toHaveBeenCalledWith('Total cost: $0.0500');
    });
  });

  it('handleDraftAll shows warning toast when terminal result has failures', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (
        url === `/api/bids/${TEST_BID_ID}` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({ ok: true, json: async () => MOCK_BID });
      }
      if (
        url === `/api/bids/${TEST_BID_ID}/questions` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => MOCK_QUESTIONS_RESPONSE,
        });
      }
      if (url.includes('draft-all') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            job_id: STUB_JOB_ID,
            pipeline_run_id: STUB_PIPELINE_RUN_ID,
            status: 'queued',
            deduplicated: false,
          }),
        });
      }
      if (url.includes(`/api/jobs/${STUB_JOB_ID}/status`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: STUB_JOB_ID,
            job_type: 'bid_draft_all',
            status: 'completed',
            result: {
              drafted: 5,
              skipped: 1,
              failed: 3,
              total_cost: 0,
            },
            error_message: null,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleDraftAll();
    });

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(
        'Drafted 5 responses, 3 failed, 1 skipped',
      );
    });
  });

  it('handleDraftAll shows error toast on terminal status=failed', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (
        url === `/api/bids/${TEST_BID_ID}` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({ ok: true, json: async () => MOCK_BID });
      }
      if (
        url === `/api/bids/${TEST_BID_ID}/questions` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => MOCK_QUESTIONS_RESPONSE,
        });
      }
      if (url.includes('draft-all') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            job_id: STUB_JOB_ID,
            pipeline_run_id: STUB_PIPELINE_RUN_ID,
            status: 'queued',
            deduplicated: false,
          }),
        });
      }
      if (url.includes(`/api/jobs/${STUB_JOB_ID}/status`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: STUB_JOB_ID,
            job_type: 'bid_draft_all',
            status: 'failed',
            result: null,
            error_message: 'bid_not_draftable: matching',
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleDraftAll();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('bid_not_draftable: matching');
    });
  });

  it('handleDraftAll shows info toast on terminal status=cancelled', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (
        url === `/api/bids/${TEST_BID_ID}` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({ ok: true, json: async () => MOCK_BID });
      }
      if (
        url === `/api/bids/${TEST_BID_ID}/questions` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => MOCK_QUESTIONS_RESPONSE,
        });
      }
      if (url.includes('draft-all') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            job_id: STUB_JOB_ID,
            pipeline_run_id: STUB_PIPELINE_RUN_ID,
            status: 'queued',
            deduplicated: false,
          }),
        });
      }
      if (url.includes(`/api/jobs/${STUB_JOB_ID}/status`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: STUB_JOB_ID,
            job_type: 'bid_draft_all',
            status: 'cancelled',
            result: null,
            error_message: null,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleDraftAll();
    });

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith('Drafting cancelled');
    });
  });

  // ─── 11. handleOutcomeRecorded closes dialog and invalidates ──────────

  it('handleOutcomeRecorded closes dialog and opens KB review when candidates exist', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    // First open the dialog
    act(() => {
      result.current.setShowOutcomeDialog(true);
    });
    expect(result.current.showOutcomeDialog).toBe(true);

    const candidates = [
      {
        id: 'c1',
        title: 'Candidate 1',
        action: 'create' as const,
        content_text: 'text',
      },
    ] as unknown as Parameters<
      ReturnType<typeof useBidActions>['handleOutcomeRecorded']
    >[1];
    act(() => {
      result.current.handleOutcomeRecorded('won', candidates);
    });

    expect(result.current.showOutcomeDialog).toBe(false);
    expect(result.current.showKBReview).toBe(true);
    expect(result.current.kbCandidates).toEqual(candidates);
  });

  it('handleOutcomeRecorded does not open KB review when no candidates', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    act(() => {
      result.current.handleOutcomeRecorded('lost', []);
    });

    expect(result.current.showKBReview).toBe(false);
  });

  // ─── 12. handleKBIntegrationComplete ──────────────────────────────────

  it('handleKBIntegrationComplete closes dialog and shows toast', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    // Open KB review first
    act(() => {
      result.current.setShowKBReview(true);
    });

    act(() => {
      result.current.handleKBIntegrationComplete({ created: 3, updated: 1 });
    });

    expect(result.current.showKBReview).toBe(false);
    expect(toast.success).toHaveBeenCalledWith(
      'KB integration complete: 3 created, 1 updated',
    );
  });

  // ─── 13. clearExtractedMetadata ───────────────────────────────────────

  it('clearExtractedMetadata clears metadata state', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    act(() => {
      result.current.clearExtractedMetadata();
    });

    expect(result.current.extractedMetadata).toBeNull();
  });

  // ─── 14. handleUploadComplete processes extraction results ────────────

  it('handleUploadComplete sets extracted questions and navigates to questions tab via URL', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    const extractionResult = {
      sections: [
        {
          section_name: 'Section A',
          section_sequence: 1,
          questions: [
            {
              question_sequence: 1,
              question_text: 'Q1',
              word_limit: 500,
              category: 'technical',
            },
            {
              question_sequence: 2,
              question_text: 'Q2',
              word_limit: null,
              category: 'general',
            },
          ],
        },
      ],
    } as unknown as ExtractionResult;

    act(() => {
      result.current.handleUploadComplete(extractionResult);
    });

    expect(result.current.showQuestionReview).toBe(true);
    expect(result.current.extractedQuestions).toHaveLength(2);
    // Tab switch now goes via router.replace (URL-synced)
    expect(mockReplace).toHaveBeenCalledWith(
      `/bid/${TEST_BID_ID}?tab=questions`,
    );
    expect(result.current.extractedQuestions[0]).toEqual({
      section_name: 'Section A',
      section_sequence: 1,
      question_sequence: 1,
      question_text: 'Q1',
      word_limit: 500,
      category: 'technical',
    });
  });

  it('handleUploadComplete sets extracted metadata when present', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    const extractionResult = {
      sections: [],
      extracted_metadata: { title: 'Test Tender', deadline: '2026-04-01' },
    } as unknown as ExtractionResult;

    act(() => {
      result.current.handleUploadComplete(extractionResult);
    });

    expect(result.current.extractedMetadata).toEqual({
      title: 'Test Tender',
      deadline: '2026-04-01',
    });
  });

  // ─── 15. Computed values ──────────────────────────────────────────────

  it('computes metadata, bidStatus, and progress correctly', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    expect(result.current.bidStatus).toBe('drafting');
    expect(result.current.metadata).toEqual({
      tender_document_ids: ['doc-1', 'doc-2'],
    });

    // Stats from questions query: total=15, drafted=5, complete=3 -> (5+3)/15 = 53%
    await waitFor(() => {
      expect(result.current.totalQuestions).toBe(15);
    });
    expect(result.current.completedCount).toBe(8);
    expect(result.current.progressPercent).toBe(53);
  });

  it('computes bidStatus as draft when bid has no status', async () => {
    mockFetchSuccess({
      bid: { ...MOCK_BID, status: null },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    expect(result.current.bidStatus).toBe('draft');
  });

  it('returns null metadata when bid is null', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    expect(result.current.metadata).toBeNull();
    expect(result.current.bidStatus).toBeNull();
  });

  it('computes availableTransitions from bid state machine', async () => {
    mockGetAvailableTransitions.mockReturnValue(['in_review', 'withdrawn']);
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    expect(result.current.availableTransitions).toEqual([
      'in_review',
      'withdrawn',
    ]);
  });

  it('computes isSubmitted correctly', async () => {
    mockFetchSuccess({
      bid: { ...MOCK_BID, status: 'submitted' },
    });
    mockGetAvailableTransitions.mockReturnValue([
      'won',
      'lost',
      'in_review',
      'withdrawn',
    ]);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    expect(result.current.isSubmitted).toBe(true);
    // regularTransitions should filter out outcome transitions when submitted
    expect(result.current.regularTransitions).toEqual(['in_review']);
  });

  // ─── 16. Tab definitions with correct counts ──────────────────────────

  it('builds tabs with correct counts', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await waitFor(() => {
      expect(result.current.totalQuestions).toBe(15);
    });

    const { tabs } = result.current;
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toEqual({ id: 'overview', label: 'Overview' });
    expect(tabs[1]).toEqual({ id: 'questions', label: 'Questions', count: 15 });
    expect(tabs[2]).toEqual({ id: 'documents', label: 'Documents', count: 2 });
  });

  // ─── 17. draftingAll reflects (mutation pending OR polling active) ────
  //
  // Post-S224 §5.4.1: draftingAll = mutation.isPending || activeJobId !== null.
  // While polling continues (status=pending/processing), draftingAll stays true.

  it('draftingAll is true while draft-all mutation is pending', async () => {
    let resolveDraftAll: ((value: unknown) => void) | undefined;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (
        url === `/api/bids/${TEST_BID_ID}` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({ ok: true, json: async () => MOCK_BID });
      }
      if (
        url === `/api/bids/${TEST_BID_ID}/questions` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => MOCK_QUESTIONS_RESPONSE,
        });
      }
      if (url.includes('draft-all') && init?.method === 'POST') {
        return new Promise((resolve) => {
          resolveDraftAll = resolve;
        });
      }
      // Status polling: terminal 'completed' so draftingAll clears.
      if (url.includes(`/api/jobs/${STUB_JOB_ID}/status`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: STUB_JOB_ID,
            job_type: 'bid_draft_all',
            status: 'completed',
            result: { drafted: 1, skipped: 0, failed: 0, total_cost: 0 },
            error_message: null,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    expect(result.current.draftingAll).toBe(false);

    act(() => {
      result.current.handleDraftAll();
    });

    await waitFor(() => {
      expect(result.current.draftingAll).toBe(true);
    });

    // Resolve the mutation with a 202 queued envelope. activeJobId is
    // then set, polling kicks in. draftingAll STAYS true while polling
    // is active.
    act(() => {
      resolveDraftAll!({
        ok: true,
        status: 202,
        json: async () => ({
          job_id: STUB_JOB_ID,
          pipeline_run_id: STUB_PIPELINE_RUN_ID,
          status: 'queued',
          deduplicated: false,
        }),
      });
    });

    // Once polling settles to terminal (default mock returns
    // status=completed), activeJobId clears and draftingAll → false.
    await waitFor(() => {
      expect(result.current.draftingAll).toBe(false);
    });
  });

  it('draftingAll stays true while job status remains pending (polling active)', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (
        url === `/api/bids/${TEST_BID_ID}` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({ ok: true, json: async () => MOCK_BID });
      }
      if (
        url === `/api/bids/${TEST_BID_ID}/questions` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => MOCK_QUESTIONS_RESPONSE,
        });
      }
      if (url.includes('draft-all') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({
            job_id: STUB_JOB_ID,
            pipeline_run_id: STUB_PIPELINE_RUN_ID,
            status: 'queued',
            deduplicated: false,
          }),
        });
      }
      // Polling: stay pending forever — exercises the "polling active
      // ⇒ draftingAll true" branch.
      if (url.includes(`/api/jobs/${STUB_JOB_ID}/status`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: STUB_JOB_ID,
            job_type: 'bid_draft_all',
            status: 'pending',
            result: null,
            error_message: null,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    expect(result.current.draftingAll).toBe(false);

    await act(async () => {
      result.current.handleDraftAll();
    });

    // After mutation success, activeJobId is set → draftingAll true and
    // it STAYS true (polling pending).
    await waitFor(() => {
      expect(result.current.draftingAll).toBe(true);
    });

    // Verify it persists for at least a few render cycles.
    await new Promise((r) => setTimeout(r, 100));
    expect(result.current.draftingAll).toBe(true);
  });

  // ─── 18. transitioning reflects mutation isPending ────────────────────

  it('transitioning is true while transition mutation is pending', async () => {
    let resolveTransition: ((value: unknown) => void) | undefined;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/bids/${TEST_BID_ID}` && init?.method === 'PATCH') {
        return new Promise((resolve) => {
          resolveTransition = resolve;
        });
      }
      if (
        url === `/api/bids/${TEST_BID_ID}` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({ ok: true, json: async () => MOCK_BID });
      }
      if (url === `/api/bids/${TEST_BID_ID}/questions`) {
        return Promise.resolve({
          ok: true,
          json: async () => MOCK_QUESTIONS_RESPONSE,
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    expect(result.current.transitioning).toBe(false);

    act(() => {
      result.current.handleStatusTransition('in_review' as BidState);
    });

    await waitFor(() => {
      expect(result.current.transitioning).toBe(true);
    });

    act(() => {
      resolveTransition!({
        ok: true,
        json: async () => ({ ...MOCK_BID, status: 'in_review' }),
      });
    });

    await waitFor(() => {
      expect(result.current.transitioning).toBe(false);
    });
  });

  // ─── Additional: handleDelete opens confirmation ──────────────────────

  it('handleDelete opens delete confirmation dialog', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    expect(result.current.deleteConfirmOpen).toBe(false);

    act(() => {
      result.current.handleDelete();
    });

    expect(result.current.deleteConfirmOpen).toBe(true);
  });

  // ─── handleQuestionReviewConfirmed / Cancelled ────────────────────────

  it('handleQuestionReviewConfirmed clears questions and refetches', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    // Set up extraction state first
    const extractionResult = {
      sections: [
        {
          section_name: 'S1',
          section_sequence: 1,
          questions: [
            {
              question_sequence: 1,
              question_text: 'Q',
              word_limit: null,
              category: 'general',
            },
          ],
        },
      ],
    } as unknown as ExtractionResult;

    act(() => {
      result.current.handleUploadComplete(extractionResult);
    });

    expect(result.current.showQuestionReview).toBe(true);
    expect(result.current.extractedQuestions).toHaveLength(1);

    act(() => {
      result.current.handleQuestionReviewConfirmed();
    });

    expect(result.current.showQuestionReview).toBe(false);
    expect(result.current.extractedQuestions).toHaveLength(0);
  });

  it('handleQuestionReviewCancelled clears state without refetch', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    const extractionResult = {
      sections: [
        {
          section_name: 'S1',
          section_sequence: 1,
          questions: [
            {
              question_sequence: 1,
              question_text: 'Q',
              word_limit: null,
              category: 'general',
            },
          ],
        },
      ],
    } as unknown as ExtractionResult;

    act(() => {
      result.current.handleUploadComplete(extractionResult);
    });

    act(() => {
      result.current.handleQuestionReviewCancelled();
    });

    expect(result.current.showQuestionReview).toBe(false);
    expect(result.current.extractedQuestions).toHaveLength(0);
  });

  // ─── Return interface completeness ────────────────────────────────────

  it('returns all expected properties', async () => {
    mockFetchSuccess();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    // Core state
    expect(result.current).toHaveProperty('bid');
    expect(result.current).toHaveProperty('questions');
    expect(result.current).toHaveProperty('stats');
    expect(result.current).toHaveProperty('loading');
    expect(result.current).toHaveProperty('activeTab');
    expect(result.current).toHaveProperty('setActiveTab');

    // Transition state
    expect(result.current).toHaveProperty('transitioning');

    // Question review
    expect(result.current).toHaveProperty('showQuestionReview');
    expect(result.current).toHaveProperty('extractedQuestions');

    // Dialog state
    expect(result.current).toHaveProperty('showCostEstimate');
    expect(result.current).toHaveProperty('setShowCostEstimate');
    expect(result.current).toHaveProperty('draftingAll');
    expect(result.current).toHaveProperty('showOutcomeDialog');
    expect(result.current).toHaveProperty('setShowOutcomeDialog');
    expect(result.current).toHaveProperty('showKBReview');
    expect(result.current).toHaveProperty('setShowKBReview');
    expect(result.current).toHaveProperty('kbCandidates');
    expect(result.current).toHaveProperty('extractedMetadata');

    // Delete
    expect(result.current).toHaveProperty('deleteConfirmOpen');
    expect(result.current).toHaveProperty('setDeleteConfirmOpen');
    expect(result.current).toHaveProperty('handleDeleteConfirmed');

    // Handlers
    expect(result.current).toHaveProperty('handleStatusTransition');
    expect(result.current).toHaveProperty('handleUploadComplete');
    expect(result.current).toHaveProperty('handleQuestionReviewConfirmed');
    expect(result.current).toHaveProperty('handleQuestionReviewCancelled');
    expect(result.current).toHaveProperty('handleDelete');
    expect(result.current).toHaveProperty('handleMatchQuestions');
    expect(result.current).toHaveProperty('handleDraftAll');
    expect(result.current).toHaveProperty('handleOutcomeRecorded');
    expect(result.current).toHaveProperty('clearExtractedMetadata');
    expect(result.current).toHaveProperty('handleKBIntegrationComplete');

    // Data refresh
    expect(result.current).toHaveProperty('fetchBid');
    expect(result.current).toHaveProperty('fetchQuestions');

    // Computed
    expect(result.current).toHaveProperty('metadata');
    expect(result.current).toHaveProperty('bidStatus');
    expect(result.current).toHaveProperty('totalQuestions');
    expect(result.current).toHaveProperty('completedCount');
    expect(result.current).toHaveProperty('progressPercent');
    expect(result.current).toHaveProperty('availableTransitions');
    expect(result.current).toHaveProperty('isSubmitted');
    expect(result.current).toHaveProperty('regularTransitions');
    expect(result.current).toHaveProperty('tabs');
  });

  // ─── Error handling for mutations ─────────────────────────────────────

  it('shows error toast when delete mutation fails', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/bids/${TEST_BID_ID}` && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Cannot delete active bid' }),
        });
      }
      if (
        url === `/api/bids/${TEST_BID_ID}` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({ ok: true, json: async () => MOCK_BID });
      }
      if (url === `/api/bids/${TEST_BID_ID}/questions`) {
        return Promise.resolve({
          ok: true,
          json: async () => MOCK_QUESTIONS_RESPONSE,
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleDeleteConfirmed();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Cannot delete active bid');
    });
  });

  it('shows error toast when match mutation fails', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('questions/match') && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'No questions to match' }),
        });
      }
      if (
        url === `/api/bids/${TEST_BID_ID}` &&
        (!init?.method || init?.method === 'GET')
      ) {
        return Promise.resolve({ ok: true, json: async () => MOCK_BID });
      }
      if (url === `/api/bids/${TEST_BID_ID}/questions`) {
        return Promise.resolve({
          ok: true,
          json: async () => MOCK_QUESTIONS_RESPONSE,
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.bid).not.toBeNull();
    });

    await act(async () => {
      result.current.handleMatchQuestions();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('No questions to match');
    });
  });

  // ─── URL-synced tab state (P1-5) ───────────────────────────────────────

  describe('URL-synced tab state (P1-5)', () => {
    it('reads active tab from ?tab= search param on mount', async () => {
      hoistedMockSearchParams.current = new URLSearchParams('tab=questions');
      mockFetchSuccess();
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.bid).not.toBeNull();
      });

      expect(result.current.activeTab).toBe('questions');
    });

    it('reads documents tab from URL', async () => {
      hoistedMockSearchParams.current = new URLSearchParams('tab=documents');
      mockFetchSuccess();
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.bid).not.toBeNull();
      });

      expect(result.current.activeTab).toBe('documents');
    });

    it('defaults to overview when no ?tab= param is present', async () => {
      hoistedMockSearchParams.current = new URLSearchParams();
      mockFetchSuccess();
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.bid).not.toBeNull();
      });

      expect(result.current.activeTab).toBe('overview');
    });

    it('falls back to overview for invalid ?tab= values without errors', async () => {
      hoistedMockSearchParams.current = new URLSearchParams('tab=invalid');
      mockFetchSuccess();
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.bid).not.toBeNull();
      });

      // Invalid tab silently defaults to overview
      expect(result.current.activeTab).toBe('overview');
    });

    it('setActiveTab calls router.replace (not push) with ?tab= param', async () => {
      mockFetchSuccess();
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.bid).not.toBeNull();
      });

      act(() => {
        result.current.setActiveTab('questions');
      });

      expect(mockReplace).toHaveBeenCalledWith(
        `/bid/${TEST_BID_ID}?tab=questions`,
      );
      // Must NOT use router.push (which pollutes browser history)
      expect(mockPush).not.toHaveBeenCalledWith(
        expect.stringContaining('tab='),
      );
    });

    it('setActiveTab to overview removes ?tab= param for clean URLs', async () => {
      hoistedMockSearchParams.current = new URLSearchParams('tab=questions');
      mockFetchSuccess();
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.bid).not.toBeNull();
      });

      act(() => {
        result.current.setActiveTab('overview');
      });

      // Overview is the default — clean URL without ?tab=
      expect(mockReplace).toHaveBeenCalledWith(`/bid/${TEST_BID_ID}`);
    });

    it('preserves other query params when setting tab', async () => {
      hoistedMockSearchParams.current = new URLSearchParams(
        'other=value&tab=overview',
      );
      mockFetchSuccess();
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useBidActions({ id: TEST_BID_ID }), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.bid).not.toBeNull();
      });

      act(() => {
        result.current.setActiveTab('documents');
      });

      // Should preserve 'other=value' and update 'tab'
      const replaceArg = mockReplace.mock.calls[0][0] as string;
      expect(replaceArg).toContain('other=value');
      expect(replaceArg).toContain('tab=documents');
    });
  });
});
