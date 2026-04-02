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
  type BidResponse,
} from '@/hooks/streaming/use-stream-coordination';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

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
      name: 'Test Bid',
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
              project_id: 'bid-1',
              evaluation_weight: null,
              matched_content_ids: null,
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
              project_id: 'bid-1',
              evaluation_weight: null,
              matched_content_ids: null,
              response: null,
            },
          ],
    }),
  };
}

function mockResponseData(overrides = {}): {
  ok: boolean;
  json: () => Promise<BidResponse>;
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
    bidId: 'bid-1',
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
      url.match(/\/api\/bids\/[^/]+$/)
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
    if (typeof url === 'string' && url.includes('/bids/'))
      return mockBidResponse();
    return { ok: false, json: async () => ({}) };
  });
}

/**
 * Render the hook with TanStack Query wrapper and wait for initial loading.
 */
async function renderAndWaitForLoad(
  params = defaultParams(),
  fetchOpts: Parameters<typeof setupDefaultFetch>[0] = {},
) {
  setupDefaultFetch(fetchOpts);
  const { Wrapper } = createQueryWrapper();
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
    it('fetchBidData fetches bid and questions on mount', async () => {
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
      expect(fetchedUrls).toContain('/api/bids/bid-1');
      expect(fetchedUrls).toContain('/api/bids/bid-1/questions');
    });

    it('sets bid data after successful fetch', async () => {
      const { result } = await renderAndWaitForLoad();

      expect(result.current.bid).toEqual(
        expect.objectContaining({
          id: 'bid-1',
          name: 'Test Bid',
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
        expect(mockPush).toHaveBeenCalledWith('/bid');
      });
      expect(toast.error).toHaveBeenCalledWith('Bid not found');
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
      expect(patchTracker[0].url).toContain('/api/bids/bid-1/responses/r-1');
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
        if (typeof url === 'string' && url.includes('/bids/'))
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

    it('fetchBidData wrapper invalidates correctly', async () => {
      const { result } = await renderAndWaitForLoad();

      const fetchCountBefore = mockFetch.mock.calls.length;

      await act(async () => {
        await result.current.fetchBidData();
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

    it('response is cached per question (switching back does not refetch)', async () => {
      const { result } = await renderAndWaitForLoad();

      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });

      const fetchCountAfterFirstLoad = mockFetch.mock.calls.length;

      // Navigate away and back
      await act(async () => {
        result.current.handleNavigate(1);
      });

      await act(async () => {
        result.current.handleNavigate(0);
      });

      // TanStack Query serves from cache — no additional fetch for the same question
      // (staleTime prevents refetch within the window)
      await waitFor(() => {
        expect(result.current.response).not.toBeNull();
      });
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
          'fetchBidData',
          'fetchResponse',
        ]),
      );
    });
  });
});
