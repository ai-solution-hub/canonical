import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that reference them
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockRouter = {
  push: mockPush,
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const mockStartDraft = vi.fn();
const mockCancel = vi.fn();
// Stream mock must be a STABLE object reference — returning a new object every
// render causes handleAction's useCallback to be recreated every render
// (stream is in its dependency array), triggering infinite re-render loops.
// We mutate this single object's properties in tests.
const mockStreamReturn = {
  phase: 'idle' as string,
  text: '' as string,
  error: null as string | null,
  qualityScore: null as number | null,
  totalCost: null as number | null,
  citations: [] as unknown[],
  responseId: null as string | null,
  startDraft: mockStartDraft,
  cancel: mockCancel,
};
vi.mock('@/hooks/streaming/use-draft-stream', () => ({
  useDraftStream: () => mockStreamReturn,
}));

vi.mock('@/lib/drawer-insert', () => ({
  insertLibraryContent: vi.fn(() => true),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { toast } from 'sonner';
import {
  useStreamCoordination,
  normaliseForComparison,
  type ProcurementResponse,
} from '@/hooks/streaming/use-stream-coordination';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import { queryKeys } from '@/lib/query/query-keys';

// ---------------------------------------------------------------------------
// Global mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

global.requestAnimationFrame = vi.fn((cb) => {
  cb(0);
  return 0;
});
global.cancelAnimationFrame = vi.fn();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tracks PATCH calls */
const patchTracker: Array<{ url: string; body: Record<string, unknown> }> = [];

/** Tracks POST calls */
const postTracker: Array<{ url: string; body: Record<string, unknown> }> = [];

function mockBidResponse(bid = {}) {
  return {
    ok: true,
    json: async () => ({
      id: 'bid-1',
      name: 'Test Procurement',
      status: 'drafting',
      domain_metadata: { buyer: 'Acme Corp' },
      ...bid,
    }),
  };
}

function mockQuestionsResponse(questions: unknown[] = []) {
  return {
    ok: true,
    json: async () => ({
      questions: questions.length
        ? questions
        : [
            {
              id: 'q-1',
              question_text: 'What is your approach?',
              section_name: 'Section 1',
              section_sequence: 1,
              question_sequence: 1,
              confidence_posture: 'strong_match',
              status: 'not_started',
              word_limit: 500,
              has_variants: false,
              assigned_to: null,
              created_by: null,
              created_at: '2026-01-01',
              updated_at: '2026-01-01',
              workspace_id: 'bid-1',
              evaluation_weight: null,
              matched_record_ids: null,
              response: { id: 'r-1', review_status: 'draft', word_count: 50 },
            },
            {
              id: 'q-2',
              question_text: 'Describe your team',
              section_name: 'Section 2',
              section_sequence: 1,
              question_sequence: 2,
              confidence_posture: null,
              status: 'not_started',
              word_limit: null,
              has_variants: false,
              assigned_to: null,
              created_by: null,
              created_at: '2026-01-01',
              updated_at: '2026-01-01',
              workspace_id: 'bid-1',
              evaluation_weight: null,
              matched_record_ids: null,
              response: null,
            },
          ],
    }),
  };
}

function mockResponseData(overrides = {}): {
  ok: boolean;
  json: () => Promise<ProcurementResponse>;
} {
  return {
    ok: true,
    json: async () => ({
      id: 'r-1',
      question_id: 'q-1',
      response_text: '<p>Our approach involves...</p>',
      response_text_advanced: null,
      version: 1,
      citations: [],
      source_content: [],
      quality_check: null,
      review_status: 'draft',
      question: {
        question_text: 'What is your approach?',
        word_limit: 500,
        section_name: 'Section 1',
        confidence_posture: 'strong_match',
      },
      ...overrides,
    }),
  };
}

const mockContentLibrary = {
  isOpen: false,
  questionText: undefined as string | undefined,
  open: vi.fn(),
  close: vi.fn(),
  toggle: vi.fn(),
};

const mockEditorInstanceRef = { current: null } as React.RefObject<null>;

function defaultParams() {
  return {
    procurementId: 'bid-1',
    contentLibrary: mockContentLibrary,
    editorInstanceRef: mockEditorInstanceRef,
  };
}

/**
 * Set up fetch to handle all URL patterns. PATCH and POST calls are tracked
 * in patchTracker/postTracker for assertions. This mock persists throughout
 * each test to prevent cascading refetches from hanging.
 */
function setupDefaultFetch(
  opts: {
    patchOk?: boolean;
    postOk?: boolean;
    bidOverride?: () => {
      ok: boolean;
      status?: number;
      json?: () => Promise<unknown>;
    };
    questionsOverride?: unknown[];
  } = {},
) {
  patchTracker.length = 0;
  postTracker.length = 0;

  const patchOk = opts.patchOk ?? true;
  const postOk = opts.postOk ?? true;

  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';

    if (method === 'PATCH') {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      patchTracker.push({ url, body });
      if (!patchOk) {
        return {
          ok: false,
          json: async () => ({ error: 'Failed to save response' }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }

    if (method === 'POST') {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      postTracker.push({ url, body });
      if (!postOk) {
        return { ok: false, json: async () => ({ error: 'Request failed' }) };
      }
      return { ok: postOk, json: async () => ({}) };
    }

    // GET requests — URL-based dispatch
    if (
      opts.bidOverride &&
      typeof url === 'string' &&
      url.match(/\/api\/procurement\/[^/]+$/)
    ) {
      return opts.bidOverride();
    }
    if (typeof url === 'string' && url.includes('/questions')) {
      if (opts.questionsOverride !== undefined) {
        return {
          ok: true,
          json: async () => ({ questions: opts.questionsOverride }),
        };
      }
      return mockQuestionsResponse();
    }
    if (typeof url === 'string' && url.includes('/responses/'))
      return mockResponseData();
    if (typeof url === 'string' && url.includes('/procurement/'))
      return mockBidResponse();
    return { ok: false, json: async () => ({}) };
  });
}

/**
 * Render the hook with TanStack Query wrapper and wait for initial loading.
 *
 * `wrapperOpts` are forwarded to `createQueryWrapper` — pass production-like
 * `{ staleTime, gcTime }` when testing cache-hit behaviour. Default is the
 * deterministic fresh-cache setup (`staleTime: 0`, `gcTime: 0`).
 */
async function renderAndWaitForLoad(
  params = defaultParams(),
  fetchOpts: Parameters<typeof setupDefaultFetch>[0] = {},
  wrapperOpts: Parameters<typeof createQueryWrapper>[0] = {},
) {
  setupDefaultFetch(fetchOpts);
  const { Wrapper } = createQueryWrapper(wrapperOpts);
  const hookResult = renderHook(() => useStreamCoordination(params), {
    wrapper: Wrapper,
  });
  await waitFor(() => {
    expect(hookResult.result.current.loading).toBe(false);
  });
  return hookResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useStreamCoordination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    patchTracker.length = 0;
    postTracker.length = 0;
    mockStreamReturn.phase = 'idle';
    mockStreamReturn.text = '';
    mockStreamReturn.error = null;
    mockStreamReturn.qualityScore = null;
    mockStreamReturn.totalCost = null;
  });

  // =========================================================================
  // Initial state
  // =========================================================================

  describe('initial state', () => {
    it('returns loading=true initially', () => {
      setupDefaultFetch();
      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(
        () => useStreamCoordination(defaultParams()),
        { wrapper: Wrapper },
      );

      expect(result.current.loading).toBe(true);
    });

    it('isStreaming is false when phase is idle', async () => {
      const { result } = await renderAndWaitForLoad();

      expect(result.current.isStreaming).toBe(false);
    });
  });

  // =========================================================================
  // Data fetching
  // =========================================================================

  describe('data fetching', () => {
    it('fetchProcurementData fetches bid and questions on mount', async () => {
      setupDefaultFetch();
      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(
        () => useStreamCoordination(defaultParams()),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const fetchedUrls = mockFetch.mock.calls.map(
        (call: unknown[]) => call[0],
      );
      expect(fetchedUrls).toContain('/api/procurement/bid-1');
      expect(fetchedUrls).toContain('/api/procurement/bid-1/questions');
    });

    it('sets bid data after successful fetch', async () => {
      const { result } = await renderAndWaitForLoad();

      expect(result.current.bid).toEqual(
        expect.objectContaining({
          id: 'bid-1',
          name: 'Test Procurement',
          status: 'drafting',
        }),
      );
      expect(result.current.questions).toHaveLength(2);
    });

    it('redirects to /bid on 404', async () => {
      setupDefaultFetch({
        bidOverride: () => ({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not found' }),
        }),
      });

      const { Wrapper } = createQueryWrapper();
      renderHook(() => useStreamCoordination(defaultParams()), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/procurement');
      });
      expect(toast.error).toHaveBeenCalledWith('Procurement not found');
    });

    it('shows error toast on fetch failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(
        () => useStreamCoordination(defaultParams()),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Network error');
    });
  });

  // =========================================================================
  // Response fetching
  // =========================================================================

  describe('response fetching', () => {
    it('fetchResponse loads response when question has a response ID', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      expect(result.current.response?.id).toBe('r-1');
      expect(result.current.response?.response_text).toBe(
        '<p>Our approach involves...</p>',
      );
    });

    it('sets editorContent from response_text', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.editorContent).toBe(
          '<p>Our approach involves...</p>',
        );
      });
    });

    it('clears response when question has no response', async () => {
      const { result } = await renderAndWaitForLoad();

      // Navigate to question 2 which has no response
      act(() => {
        result.current.handleNavigate(1);
      });

      await waitFor(() => {
        expect(result.current.response).toBeNull();
      });
      expect(result.current.editorContent).toBe('');
    });
  });

  // =========================================================================
  // Navigation
  // =========================================================================

  describe('navigation', () => {
    it('handleNavigate changes currentIndex', async () => {
      const { result } = await renderAndWaitForLoad();

      expect(result.current.currentIndex).toBe(0);

      act(() => {
        result.current.handleNavigate(1);
      });

      expect(result.current.currentIndex).toBe(1);
    });

    it('handleNavigate cancels stream when streaming', async () => {
      mockStreamReturn.phase = 'drafting';
      mockStreamReturn.text = 'partial text';

      const { result } = await renderAndWaitForLoad();

      act(() => {
        result.current.handleNavigate(1);
      });

      expect(mockCancel).toHaveBeenCalled();
    });

    it('does not navigate to out-of-bounds index', async () => {
      const { result } = await renderAndWaitForLoad();

      act(() => {
        result.current.handleNavigate(99);
      });

      expect(result.current.currentIndex).toBe(0);

      act(() => {
        result.current.handleNavigate(-1);
      });

      expect(result.current.currentIndex).toBe(0);
    });
  });

  // =========================================================================
  // Actions
  // =========================================================================

  describe('actions', () => {
    it('handleAction save PATCHes the response', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      patchTracker.length = 0;

      await act(async () => {
        await result.current.handleAction('save');
      });

      expect(result.current.actionLoading).toBe(false);
      expect(patchTracker.length).toBeGreaterThanOrEqual(1);
      expect(patchTracker[0].url).toContain(
        '/api/procurement/bid-1/responses/r-1',
      );
      expect(patchTracker[0].body).toHaveProperty('response_text');
      expect(toast.success).toHaveBeenCalledWith('Response saved');
    });

    it('handleAction accept PATCHes with review_status approved', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      patchTracker.length = 0;

      await act(async () => {
        await result.current.handleAction('accept');
      });

      expect(result.current.actionLoading).toBe(false);
      expect(patchTracker.length).toBeGreaterThanOrEqual(1);
      expect(patchTracker[0].body.review_status).toBe('approved');
      expect(toast.success).toHaveBeenCalledWith('Response approved');
    });

    it('handleAction regenerate with existing response calls regenerate endpoint', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      postTracker.length = 0;

      await act(async () => {
        await result.current.handleAction('regenerate', 'Make it shorter');
      });

      expect(result.current.actionLoading).toBe(false);
      const regenPosts = postTracker.filter((p) =>
        p.url.includes('/regenerate'),
      );
      expect(regenPosts).toHaveLength(1);
      expect(regenPosts[0].body.instructions).toBe('Make it shorter');
      expect(toast.success).toHaveBeenCalledWith('Response regenerated');
    });

    it('handleAction regenerate without response starts draft stream', async () => {
      const { result } = await renderAndWaitForLoad();

      // Navigate to question 2 which has no response
      act(() => {
        result.current.handleNavigate(1);
      });

      await waitFor(() => {
        expect(result.current.response).toBeNull();
      });

      await act(async () => {
        await result.current.handleAction('regenerate');
      });

      expect(mockStartDraft).toHaveBeenCalledWith('q-2');
    });

    it('handleAction author_manually sets editor content to empty paragraph', async () => {
      const { result } = await renderAndWaitForLoad();

      await act(async () => {
        await result.current.handleAction('author_manually');
      });

      expect(result.current.actionLoading).toBe(false);
      expect(result.current.editorContent).toBe('<p></p>');
      expect(toast.info).toHaveBeenCalledWith(
        'Start typing your response. Save when ready.',
      );
    });

    it('handleAction flag_for_review PATCHes with review_status needs_review', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      patchTracker.length = 0;

      await act(async () => {
        await result.current.handleAction('flag_for_review');
      });

      expect(result.current.actionLoading).toBe(false);
      expect(patchTracker.length).toBeGreaterThanOrEqual(1);
      expect(patchTracker[0].body.review_status).toBe('needs_review');
      expect(toast.success).toHaveBeenCalledWith('Response flagged for review');
    });

    it('handleAction shows error toast when save fails', async () => {
      const { result } = await renderAndWaitForLoad(defaultParams(), {
        patchOk: false,
      });

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      await act(async () => {
        // mutateAsync will throw — the handleAction catches via onError
        // but also rethrows, so we need to catch here
        try {
          await result.current.handleAction('save');
        } catch {
          // Expected — mutateAsync propagates error
        }
      });

      expect(toast.error).toHaveBeenCalledWith('Failed to save response');
    });

    it('handleAction save shows error when no response exists', async () => {
      const { result } = await renderAndWaitForLoad();

      // Navigate to question 2 which has no response
      act(() => {
        result.current.handleNavigate(1);
      });

      await waitFor(() => {
        expect(result.current.response).toBeNull();
      });

      patchTracker.length = 0;

      await act(async () => {
        await result.current.handleAction('save');
      });

      expect(toast.error).toHaveBeenCalledWith('No response to save');
      expect(patchTracker).toHaveLength(0);
    });
  });

  // =========================================================================
  // Derived data
  // =========================================================================

  describe('derived data', () => {
    it('navigatorQuestions maps questions correctly', async () => {
      const { result } = await renderAndWaitForLoad();

      expect(result.current.navigatorQuestions).toHaveLength(2);
      expect(result.current.navigatorQuestions[0]).toEqual({
        id: 'q-1',
        question_text: 'What is your approach?',
        section_name: 'Section 1',
        confidence_posture: 'strong_match',
        status: 'not_started',
      });
      expect(result.current.navigatorQuestions[1]).toEqual({
        id: 'q-2',
        question_text: 'Describe your team',
        section_name: 'Section 2',
        confidence_posture: null,
        status: 'not_started',
      });
    });

    it('currentQuestion tracks the question at currentIndex', async () => {
      const { result } = await renderAndWaitForLoad();

      expect(result.current.currentQuestion?.id).toBe('q-1');

      act(() => {
        result.current.handleNavigate(1);
      });

      expect(result.current.currentQuestion?.id).toBe('q-2');
    });
  });

  // =========================================================================
  // Streaming state
  // =========================================================================

  describe('streaming state', () => {
    it('isStreaming is true when phase is drafting', async () => {
      mockStreamReturn.phase = 'drafting';
      mockStreamReturn.text = 'some text';

      const { result } = await renderAndWaitForLoad();

      expect(result.current.isStreaming).toBe(true);
    });

    it('isStreaming is true for analysing phase', async () => {
      mockStreamReturn.phase = 'analysing';

      const { result } = await renderAndWaitForLoad();

      expect(result.current.isStreaming).toBe(true);
    });

    it('isStreaming is false for done phase', async () => {
      mockStreamReturn.phase = 'done';
      mockStreamReturn.text = 'final text';
      mockStreamReturn.qualityScore = 0.85;
      mockStreamReturn.totalCost = 0.023;

      const { result } = await renderAndWaitForLoad();

      expect(result.current.isStreaming).toBe(false);
    });

    it('isStreaming is false for error phase', async () => {
      mockStreamReturn.phase = 'error';
      mockStreamReturn.error = 'Something went wrong';

      const { result } = await renderAndWaitForLoad();

      expect(result.current.isStreaming).toBe(false);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles empty questions list gracefully', async () => {
      const { result } = await renderAndWaitForLoad(defaultParams(), {
        questionsOverride: [],
      });

      expect(result.current.questions).toHaveLength(0);
      expect(result.current.currentQuestion).toBeNull();
      expect(result.current.navigatorQuestions).toHaveLength(0);
    });

    it('handleAction does nothing when currentQuestion is null', async () => {
      const { result } = await renderAndWaitForLoad(defaultParams(), {
        questionsOverride: [],
      });

      patchTracker.length = 0;
      postTracker.length = 0;

      await act(async () => {
        await result.current.handleAction('save');
      });

      expect(patchTracker).toHaveLength(0);
    });

    it('questions endpoint failure does not crash the hook', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/questions'))
          return {
            ok: false,
            json: async () => ({ error: 'Questions failed' }),
          };
        if (typeof url === 'string' && url.includes('/procurement/'))
          return mockBidResponse();
        return { ok: false, json: async () => ({}) };
      });

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(
        () => useStreamCoordination(defaultParams()),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.bid).not.toBeNull();
      expect(result.current.questions).toHaveLength(0);
    });

    // S152B WP5 / Q-37 regression — see docs/audits/s151-decision-responses.md
    // and docs/audits/s151-silent-failure-recheck.md §7 item 2. Before the fix,
    // `fetchProcurementQuestions` and `fetchProcurementResponseData` silently swallowed fetch
    // errors and returned `[]` / `null`, masking real connectivity / auth
    // failures from TanStack Query's `isError` / `error` state. The fix
    // removes the catches so errors propagate, and combines all three query
    // errors into the hook's `error` field.
    it('Q-37: questions endpoint failure surfaces in result.current.error', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/questions'))
          return {
            ok: false,
            json: async () => ({ error: 'Questions failed' }),
          };
        if (typeof url === 'string' && url.match(/\/api\/procurement\/[^\/]+$/))
          return mockBidResponse();
        return { ok: false, json: async () => ({}) };
      });

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(
        () => useStreamCoordination(defaultParams()),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // The questions fetch failed — this should be observable via the
      // hook's `error` field. Before the Q-37 fix this was `null` because
      // `fetchProcurementQuestions` caught and swallowed the error.
      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
      expect(result.current.error).toContain('Questions failed');
    });

    it('Q-37: response endpoint failure surfaces in result.current.error', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/responses/'))
          return {
            ok: false,
            json: async () => ({ error: 'Response fetch failed' }),
          };
        if (typeof url === 'string' && url.includes('/questions'))
          return mockQuestionsResponse();
        if (typeof url === 'string' && url.match(/\/api\/procurement\/[^\/]+$/))
          return mockBidResponse();
        return { ok: false, json: async () => ({}) };
      });

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(
        () => useStreamCoordination(defaultParams()),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // The response fetch failed — this should be observable via the
      // hook's `error` field. Before the Q-37 fix this was `null` because
      // `fetchProcurementResponseData` caught and swallowed the error.
      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
      expect(result.current.error).toContain('Response fetch failed');
    });
  });

  // =========================================================================
  // TanStack Query integration (new tests)
  // =========================================================================

  describe('TanStack Query integration', () => {
    it('handleAction returns Promise that resolves on success', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      // Should resolve without throwing
      await act(async () => {
        await result.current.handleAction('save');
      });

      expect(toast.success).toHaveBeenCalledWith('Response saved');
    });

    it('handleAction returns Promise that rejects on failure', async () => {
      const { result } = await renderAndWaitForLoad(defaultParams(), {
        patchOk: false,
      });

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      let didThrow = false;
      await act(async () => {
        try {
          await result.current.handleAction('save');
        } catch {
          didThrow = true;
        }
      });

      // mutateAsync propagates the error
      expect(didThrow).toBe(true);
      expect(toast.error).toHaveBeenCalledWith('Failed to save response');
    });

    it('fetchProcurementData wrapper invalidates correctly', async () => {
      const { result } = await renderAndWaitForLoad();

      const fetchCountBefore = mockFetch.mock.calls.length;

      await act(async () => {
        await result.current.fetchProcurementData();
      });

      // Should have triggered additional fetches via invalidation
      await waitFor(() => {
        expect(mockFetch.mock.calls.length).toBeGreaterThan(fetchCountBefore);
      });
    });

    it('fetchResponse wrapper invalidates correctly', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      const fetchCountBefore = mockFetch.mock.calls.length;

      await act(async () => {
        await result.current.fetchResponse();
      });

      await waitFor(() => {
        expect(mockFetch.mock.calls.length).toBeGreaterThan(fetchCountBefore);
      });
    });

    // Cache-hit regression — see WP7 (S152A).
    //
    // Decision: Option 1 — fix the test environment so it actually exercises
    // production cache behaviour. The original test asserted "switching back
    // does not refetch" but used the default `createQueryWrapper()` which has
    // `gcTime: 0` and `staleTime: 0`. With those defaults, q-1's cache entry
    // is destroyed the moment navigation removes its observer, so a fresh
    // refetch is unavoidable on navigate-back — meaning the test was running
    // against a configuration that fundamentally cannot demonstrate the
    // production cache hit (`lib/query/query-provider.tsx` ships
    // `staleTime: 30s`, `gcTime: 5min`). The production hook code is correct;
    // the test wrapper was lying about the environment.
    //
    // We now pass production-like cache options to the wrapper. The two
    // tests below pin both halves of the contract:
    //   1. Navigating away from q-1 and back within `staleTime` MUST NOT
    //      issue a second fetch for q-1.
    //   2. Navigating to a previously-unvisited q-2 (whose response also
    //      lives at a real endpoint) MUST issue exactly one fetch — caching
    //      must not over-suppress unrelated questions.
    it('response is cached per question (switching back does not refetch within staleTime)', async () => {
      const { result } = await renderAndWaitForLoad(
        defaultParams(),
        {},
        { staleTime: 30_000, gcTime: 5 * 60_000 },
      );

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      const fetchCountAfterFirstLoad = mockFetch.mock.calls.length;

      // Navigate away to q-2 (which has no response → no fetch issued for it)
      await act(async () => {
        result.current.handleNavigate(1);
      });

      // …and back to q-1.
      await act(async () => {
        result.current.handleNavigate(0);
      });

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      // No additional fetch — q-1's data is still fresh, served from cache.
      // If this assertion regresses (e.g. queryKey instability, an effect
      // calling `invalidateQueries` on every navigation, or a wrapper config
      // drift) the test will fail loudly.
      expect(mockFetch.mock.calls.length).toBe(fetchCountAfterFirstLoad);
    });

    it('navigating to a different question still fetches its response (no over-caching)', async () => {
      // Both questions have a response — proves the cache is keyed per
      // question and we are not accidentally suppressing legitimate fetches.
      const questions = [
        {
          id: 'q-1',
          question_text: 'What is your approach?',
          section_name: 'Section 1',
          section_sequence: 1,
          question_sequence: 1,
          confidence_posture: 'strong_match',
          status: 'not_started',
          word_limit: 500,
          has_variants: false,
          assigned_to: null,
          created_by: null,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
          workspace_id: 'bid-1',
          evaluation_weight: null,
          matched_record_ids: null,
          response: { id: 'r-1', review_status: 'draft', word_count: 50 },
        },
        {
          id: 'q-2',
          question_text: 'Describe your team',
          section_name: 'Section 2',
          section_sequence: 1,
          question_sequence: 2,
          confidence_posture: null,
          status: 'not_started',
          word_limit: null,
          has_variants: false,
          assigned_to: null,
          created_by: null,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
          workspace_id: 'bid-1',
          evaluation_weight: null,
          matched_record_ids: null,
          response: { id: 'r-2', review_status: 'draft', word_count: 80 },
        },
      ];
      const { result } = await renderAndWaitForLoad(
        defaultParams(),
        { questionsOverride: questions },
        { staleTime: 30_000, gcTime: 5 * 60_000 },
      );

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      const fetchCountAfterFirstLoad = mockFetch.mock.calls.length;
      const r2UrlsBefore = mockFetch.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('/responses/r-2'),
      ).length;
      expect(r2UrlsBefore).toBe(0);

      await act(async () => {
        result.current.handleNavigate(1);
      });

      // Wait for q-2's response to arrive — proves the new fetch happened.
      await waitFor(() => {
        const r2UrlsAfter = mockFetch.mock.calls.filter((c: unknown[]) =>
          String(c[0]).includes('/responses/r-2'),
        ).length;
        expect(r2UrlsAfter).toBe(1);
      });

      expect(mockFetch.mock.calls.length).toBe(fetchCountAfterFirstLoad + 1);
    });

    it('mutation error does not corrupt query cache', async () => {
      const { result } = await renderAndWaitForLoad(defaultParams(), {
        patchOk: false,
      });

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      const responseBefore = result.current.response;

      // Attempt a failing save
      await act(async () => {
        try {
          await result.current.handleAction('save');
        } catch {
          // Expected to throw
        }
      });

      // Response data should be unchanged after failed mutation
      expect(result.current.response).toEqual(responseBefore);
    });

    it('handleLibraryInsert updates editor and tracks provenance', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      // handleLibraryInsert takes (html, sourceId, sourceTitle)
      // In jsdom without a real editor, it falls back to clipboard/toast path
      await act(async () => {
        await result.current.handleLibraryInsert(
          '<p>Test content</p>',
          'source-123',
          'Test Source',
        );
      });

      // The function should complete without throwing
      // Provenance tracking fires via provenanceMutation.mutate() if response.id
      // exists and sourceId is not already in source_content
    });
  });

  // =========================================================================
  // Editor content sync — lastServerContentRef protection (S129 adversarial)
  // =========================================================================

  describe('editor content sync (lastServerContentRef)', () => {
    it('response data syncs to editor when content matches lastServerContent', async () => {
      const { result } = await renderAndWaitForLoad();

      // After initial load, editorContent should be synced from response
      await waitFor(() => {
        expect(result.current.editorContent).toBe(
          '<p>Our approach involves...</p>',
        );
      });
    });

    it('response data does NOT sync when user has edited', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.editorContent).toBe(
          '<p>Our approach involves...</p>',
        );
      });

      // Simulate user editing (changes editorContent away from lastServerContent)
      act(() => {
        result.current.setEditorContent('<p>User edited content</p>');
      });

      expect(result.current.editorContent).toBe('<p>User edited content</p>');

      // Trigger a refetch by calling fetchResponse
      await act(async () => {
        await result.current.fetchResponse();
      });

      // Wait for refetch to settle, but editor should NOT be overwritten
      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      // Editor should still have user's content, not server content
      expect(result.current.editorContent).toBe('<p>User edited content</p>');
    });

    it('after save, lastServerContent is updated and sync resumes', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      // Edit the content
      act(() => {
        result.current.setEditorContent('<p>Edited by user</p>');
      });

      // Save — this should update lastServerContent to the editor content
      await act(async () => {
        await result.current.handleAction('save');
      });

      // After save, the editor content should be the saved content
      expect(result.current.editorContent).toBe('<p>Edited by user</p>');
    });

    it('streaming updates bypass sync entirely', async () => {
      mockStreamReturn.phase = 'drafting';
      mockStreamReturn.text = 'streaming text';

      const { result } = await renderAndWaitForLoad();

      // isStreaming should be true, which blocks the sync effect
      expect(result.current.isStreaming).toBe(true);
    });

    it('author_manually resets lastServerContent', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.editorContent).toBe(
          '<p>Our approach involves...</p>',
        );
      });

      // Trigger author_manually
      await act(async () => {
        await result.current.handleAction('author_manually');
      });

      // Editor should be empty paragraph
      expect(result.current.editorContent).toBe('<p></p>');

      // Trigger a response refetch — should NOT overwrite because
      // lastServerContent was reset to '' which does not match '<p></p>'
      await act(async () => {
        await result.current.fetchResponse();
      });

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      // Editor should still have the empty paragraph, not the server content
      expect(result.current.editorContent).toBe('<p></p>');
    });

    // =======================================================================
    // S152B WP14 #17 / #18 — Tiptap normalisation drift regression tests
    // =======================================================================
    // These tests cover the bugs surfaced during S152A Phase 4 verification
    // of §8.0.8 (bid regenerate + restore). Diagnosis is in
    // docs/audits/s152a-bid-drafting-production-bugs.md. Both bugs share a
    // root cause: the previous sync guard used strict HTML equality between
    // `editorContent` and `lastServerContentRef.current`, but Tiptap's
    // `onUpdate` fires after `setContent` with a *normalised* HTML string
    // (whitespace, self-closing tags, etc.) that never matches the raw HTML
    // we stored, permanently blocking every subsequent sync.

    it('#17: sync still fires when editorContent has been normalised by Tiptap', async () => {
      // Stateful mock: first response fetch returns the original text, the
      // second returns a regenerated version. Simulates a regen/restore flow
      // where the server content changes after the initial sync.
      let responseCallCount = 0;
      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'PATCH' || method === 'POST') {
          return { ok: true, json: async () => ({}) };
        }
        if (url.match(/\/api\/procurement\/[^\/]+$/)) return mockBidResponse();
        if (url.includes('/questions')) return mockQuestionsResponse();
        if (url.includes('/responses/')) {
          responseCallCount += 1;
          if (responseCallCount === 1) {
            return mockResponseData({ response_text: '<p>Original draft</p>' });
          }
          return mockResponseData({
            response_text: '<p>Regenerated draft</p>',
          });
        }
        if (url.includes('/procurement/')) return mockBidResponse();
        return { ok: false, json: async () => ({}) };
      });

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(
        () => useStreamCoordination(defaultParams()),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      await waitFor(() => {
        expect(result.current.editorContent).toBe('<p>Original draft</p>');
      });

      // Simulate Tiptap's `onUpdate` callback firing after the first
      // `setContent`: Tiptap normalises the HTML (adds whitespace, re-orders
      // attributes, etc.) and writes the normalised form back via onChange.
      // The pre-fix guard blocked every subsequent sync because
      // `editorContent` (normalised) !== `lastServerContentRef.current` (raw).
      act(() => {
        result.current.setEditorContent('<p>Original draft</p>\n');
      });

      // Trigger a response refetch — the stateful mock now returns the
      // regenerated content. The new sync effect must detect the server
      // text change and sync into the editor despite the normalisation
      // drift in editorContent.
      await act(async () => {
        await result.current.fetchResponse();
      });

      await waitFor(() => {
        expect(result.current.editorContent).toBe('<p>Regenerated draft</p>');
      });
    });

    it('#18: editor hydrates from server even when initial empty content has been normalised', async () => {
      // Simulates the page-reload hydration path: the editor mounts with
      // empty content, Tiptap normalises '' to '<p></p>' and fires onUpdate,
      // and only THEN does the response query resolve. The pre-fix guard
      // blocked the sync because `editorContent = '<p></p>'` never matched
      // `lastServerContentRef.current = ''`.
      const { Wrapper } = createQueryWrapper();
      setupDefaultFetch();
      const { result } = renderHook(
        () => useStreamCoordination(defaultParams()),
        { wrapper: Wrapper },
      );

      // Simulate Tiptap's initial onUpdate firing before the response loads:
      // editorContent transitions from '' (initial) to '<p></p>' (Tiptap's
      // normalised empty-doc representation).
      act(() => {
        result.current.setEditorContent('<p></p>');
      });

      // Now wait for the response to load and sync through to the editor.
      // The fix treats '<p></p>' as equivalent to '' via
      // `normaliseForComparison`, so the sync passes.
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      await waitFor(() => {
        expect(result.current.editorContent).toBe(
          '<p>Our approach involves...</p>',
        );
      });
    });

    it('#17: sync still preserves user edits after normalisation drift', async () => {
      // Regression guard: the normalised comparison must still distinguish
      // *real* user edits from Tiptap's cosmetic normalisation.
      let responseCallCount = 0;
      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'PATCH' || method === 'POST') {
          return { ok: true, json: async () => ({}) };
        }
        if (url.match(/\/api\/procurement\/[^\/]+$/)) return mockBidResponse();
        if (url.includes('/questions')) return mockQuestionsResponse();
        if (url.includes('/responses/')) {
          responseCallCount += 1;
          if (responseCallCount === 1) {
            return mockResponseData({ response_text: '<p>Original draft</p>' });
          }
          return mockResponseData({
            response_text: '<p>Server-side update</p>',
          });
        }
        if (url.includes('/procurement/')) return mockBidResponse();
        return { ok: false, json: async () => ({}) };
      });

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(
        () => useStreamCoordination(defaultParams()),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.editorContent).toBe('<p>Original draft</p>');
      });

      // User actually edits the content (genuine edit, not cosmetic normalisation).
      act(() => {
        result.current.setEditorContent(
          '<p>User-authored response with substantive changes</p>',
        );
      });

      // Server-side update arrives — user edits must be preserved.
      await act(async () => {
        await result.current.fetchResponse();
      });

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      // Editor still has user's content — sync correctly skipped.
      expect(result.current.editorContent).toBe(
        '<p>User-authored response with substantive changes</p>',
      );
    });
  });

  // =========================================================================
  // Shared questions cache key — detail-page/session-page shape parity
  // =========================================================================
  //
  // Regression: the ProcurementDetailPage (useFormData in
  // hooks/procurement/use-procurement-actions.ts) and the session page
  // (useProcurementSession) register queries under the SAME key,
  // queryKeys.procurement.questions(id). The detail page caches the route
  // envelope { questions, stats }; the session page previously cached the
  // bare array. Navigating detail -> session within staleTime served the
  // detail page's envelope to the session hook, crashing
  // navigatorQuestions with "questions.map is not a function". One key MUST
  // mean one shape: both sides now share fetchProcurementQuestions from
  // lib/query/procurement-questions.ts, caching the envelope.

  describe('questions cache shared with the detail page (same query key)', () => {
    it('renders session questions from a cache entry left by the detail page', async () => {
      setupDefaultFetch();
      // Production-like cache config: the envelope seeded below stays fresh,
      // exactly as it is when the user clicks "open session" on the detail
      // page within staleTime of the detail page's own questions fetch.
      const { Wrapper, queryClient } = createQueryWrapper({
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
      });
      queryClient.setQueryData(queryKeys.procurement.questions('bid-1'), {
        questions: [
          {
            id: 'q-1',
            question_text: 'What is your approach?',
            section_name: 'Section 1',
            section_sequence: 1,
            question_sequence: 1,
            confidence_posture: 'strong_match',
            status: 'not_started',
            word_limit: 500,
            has_variants: false,
            assigned_to: null,
            created_by: null,
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
            evaluation_weight: null,
            response: { id: 'r-1', review_status: 'draft', word_count: 50 },
          },
          {
            id: 'q-2',
            question_text: 'Describe your team',
            section_name: 'Section 2',
            section_sequence: 1,
            question_sequence: 2,
            confidence_posture: null,
            status: 'not_started',
            word_limit: null,
            has_variants: false,
            assigned_to: null,
            created_by: null,
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
            evaluation_weight: null,
            response: null,
          },
        ],
        stats: {
          total_questions: 2,
          strong_match_count: 1,
          partial_match_count: 0,
          needs_sme_count: 0,
          no_content_count: 1,
          unmatched_count: 0,
          drafted_count: 0,
          complete_count: 0,
        },
      });

      const { result } = renderHook(
        () => useStreamCoordination(defaultParams()),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.questions).toHaveLength(2);
      expect(
        result.current.navigatorQuestions.map((q: { id: string }) => q.id),
      ).toEqual(['q-1', 'q-2']);
    });
  });

  // =========================================================================
  // normaliseForComparison — S152B WP14 unit tests
  // =========================================================================

  describe('normaliseForComparison', () => {
    it('strips tags and returns plain text', () => {
      expect(normaliseForComparison('<p>Hello</p>')).toBe('Hello');
      expect(
        normaliseForComparison('<p>Hello <strong>World</strong></p>'),
      ).toBe('Hello World');
    });

    it('treats empty string and Tiptap empty doc as equivalent', () => {
      expect(normaliseForComparison('')).toBe('');
      expect(normaliseForComparison('<p></p>')).toBe('');
      expect(normaliseForComparison('<p><br></p>')).toBe('');
      expect(normaliseForComparison('<p><br/></p>')).toBe('');
      expect(normaliseForComparison('<p><br /></p>')).toBe('');
    });

    it('preserves word boundaries across block-level closing tags', () => {
      // Without word-boundary-preserving replacement, this would collapse
      // to "HelloWorld" and false-match against "Hello World".
      expect(normaliseForComparison('<p>Hello</p><p>World</p>')).toBe(
        'Hello World',
      );
    });

    it('collapses whitespace between and within tags', () => {
      expect(normaliseForComparison('<p>Hello</p>\n<p>World</p>')).toBe(
        normaliseForComparison('<p>Hello</p> <p>World</p>'),
      );
      expect(normaliseForComparison('<p>Hello   World</p>')).toBe(
        'Hello World',
      );
    });

    it('treats self-closing and non-self-closing br as equivalent', () => {
      expect(normaliseForComparison('<p>Line 1<br/>Line 2</p>')).toBe(
        normaliseForComparison('<p>Line 1<br>Line 2</p>'),
      );
      expect(normaliseForComparison('<p>Line 1<br />Line 2</p>')).toBe(
        normaliseForComparison('<p>Line 1<br>Line 2</p>'),
      );
    });

    it('treats leading and trailing whitespace as equivalent', () => {
      expect(normaliseForComparison('<p>Hello</p>')).toBe(
        normaliseForComparison('<p>Hello</p>\n'),
      );
      expect(normaliseForComparison('<p>Hello</p>')).toBe(
        normaliseForComparison('  <p>Hello</p>  '),
      );
    });

    it('decodes common HTML entities so marked and Tiptap output match', () => {
      expect(normaliseForComparison('<p>Hello&nbsp;World</p>')).toBe(
        'Hello World',
      );
      expect(normaliseForComparison('<p>Tom &amp; Jerry</p>')).toBe(
        'Tom & Jerry',
      );
      expect(normaliseForComparison('<p>&lt;angle&gt;</p>')).toBe('<angle>');
    });

    it('ignores attribute differences because tags are stripped', () => {
      // Tiptap may add style/class attributes that marked.parse does not
      // emit. The pure-text comparison sidesteps this serialisation gap.
      expect(
        normaliseForComparison('<p style="text-align:left">Hello</p>'),
      ).toBe(normaliseForComparison('<p>Hello</p>'));
      expect(normaliseForComparison('<p class="tiptap-p">Hello</p>')).toBe(
        normaliseForComparison('<p>Hello</p>'),
      );
    });

    it('distinguishes genuinely different content', () => {
      expect(normaliseForComparison('<p>Hello</p>')).not.toBe(
        normaliseForComparison('<p>Goodbye</p>'),
      );
    });
  });

  // =========================================================================
  // Return interface completeness
  // =========================================================================

  describe('return interface', () => {
    it('returns exactly 21 properties', async () => {
      const { result } = await renderAndWaitForLoad();

      const keys = Object.keys(result.current);
      expect(keys).toHaveLength(21);
      expect(keys).toEqual(
        expect.arrayContaining([
          'bid',
          'questions',
          'currentIndex',
          'loading',
          'error',
          'response',
          'responseLoading',
          'editorContent',
          'setEditorContent',
          'stream',
          'isStreaming',
          'actionLoading',
          'loadingAction',
          'handleNavigate',
          'handleAction',
          'handleLibraryInsert',
          'handleCitationClick',
          'navigatorQuestions',
          'currentQuestion',
          'fetchProcurementData',
          'fetchResponse',
        ]),
      );
    });
  });
});
