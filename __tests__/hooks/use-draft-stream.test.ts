import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createQueryWrapper } from '../helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Helpers for building SSE byte streams
// ---------------------------------------------------------------------------

/**
 * Encode an SSE event into the wire format: "event: <type>\ndata: <json>\n\n"
 */
function sseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Build a ReadableStream<Uint8Array> from an array of SSE event strings.
 * Each string is encoded and enqueued as a separate chunk, simulating
 * real network delivery where chunks arrive progressively.
 */
function buildSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });
}

/**
 * Build a ReadableStream that delivers chunks with a microtask delay
 * between each, more accurately simulating network arrival.
 */
function buildDelayedSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= events.length) {
        controller.close();
        return;
      }
      // Allow a microtask between chunks
      await Promise.resolve();
      controller.enqueue(encoder.encode(events[index]));
      index++;
    },
  });
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Import under test — after global mocks are in place
// ---------------------------------------------------------------------------

import { useDraftStream, type StreamPhase } from '@/hooks/streaming/use-draft-stream';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let queryClient: ReturnType<typeof createQueryWrapper>['queryClient'];
let Wrapper: ReturnType<typeof createQueryWrapper>['Wrapper'];

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  const wrapper = createQueryWrapper();
  queryClient = wrapper.queryClient;
  Wrapper = wrapper.Wrapper;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDraftStream', () => {
  // =========================================================================
  // Initial state
  // =========================================================================

  describe('initial state', () => {
    it('returns idle phase with empty data', () => {
      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      expect(result.current.phase).toBe('idle');
      expect(result.current.text).toBe('');
      expect(result.current.citations).toEqual([]);
      expect(result.current.qualityScore).toBeNull();
      expect(result.current.responseId).toBeNull();
      expect(result.current.totalCost).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('provides startDraft and cancel functions', () => {
      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      expect(typeof result.current.startDraft).toBe('function');
      expect(typeof result.current.cancel).toBe('function');
    });
  });

  // =========================================================================
  // Starting a draft stream
  // =========================================================================

  describe('starting a draft stream', () => {
    it('sets phase to analysing immediately on startDraft', async () => {
      // Provide a stream that never finishes so we can observe the analysing phase
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      // After the stream finishes (empty body), state stays at analysing
      // because no done event was sent
      expect(result.current.error).toBeNull();
    });

    it('calls fetch with correct URL, method, and body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([sseEvent('done', { response_id: 'r-1', total_cost: 0.01 })]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/bids/bid-1/responses/draft-stream');
      expect(opts.method).toBe('POST');
      expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(opts.body);
      expect(body.question_id).toBe('q-1');
      expect(body.model_tier).toBe('drafting');
    });

    it('sends custom model_tier when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([sseEvent('done', { response_id: 'r-1' })]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1', 'analysis');
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model_tier).toBe('analysis');
    });

    it('defaults model_tier to drafting', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([sseEvent('done', { response_id: 'r-1' })]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model_tier).toBe('drafting');
    });

    it('resets state when starting a new draft', async () => {
      // First draft: complete with some state
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'Hello' }),
          sseEvent('done', { response_id: 'r-1', total_cost: 0.05 }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.text).toBe('Hello');
      expect(result.current.phase).toBe('done');

      // Second draft: state should reset
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'World' }),
          sseEvent('done', { response_id: 'r-2' }),
        ]),
      });

      await act(async () => {
        await result.current.startDraft('q-2');
      });

      // Text should be 'World', not 'HelloWorld'
      expect(result.current.text).toBe('World');
      expect(result.current.responseId).toBe('r-2');
    });

    it('passes AbortController signal to fetch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([sseEvent('done', { response_id: 'r-1' })]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      const opts = mockFetch.mock.calls[0][1];
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // =========================================================================
  // SSE event parsing — full 3-pass pipeline
  // =========================================================================

  describe('SSE event parsing', () => {
    it('processes pass1_complete event — transitions to drafting phase', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', { analysis: 'some analysis' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('drafting');
    });

    it('processes token events — accumulates text progressively', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'Our ' }),
          sseEvent('token', { text: 'approach ' }),
          sseEvent('token', { text: 'involves...' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.text).toBe('Our approach involves...');
      // Phase should still be drafting (no pass2_complete yet)
      expect(result.current.phase).toBe('drafting');
    });

    it('processes pass2_complete event — transitions to quality phase with citations', async () => {
      const mockCitations = [
        {
          cited_text: 'We have ISO 27001 certification',
          source_index: 0,
          source_id: 'content-1',
          source_title: 'Security Policy',
          source_url: '/item/content-1',
          start_block_index: 0,
          end_block_index: 1,
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'Draft text' }),
          sseEvent('pass2_complete', { citations: mockCitations }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('quality');
      expect(result.current.citations).toEqual(mockCitations);
      expect(result.current.text).toBe('Draft text');
    });

    it('handles pass2_complete with no citations gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'Draft' }),
          sseEvent('pass2_complete', {}),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('quality');
      expect(result.current.citations).toEqual([]);
    });

    it('processes pass3_complete event — transitions to saving phase with quality score', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'Response text' }),
          sseEvent('pass2_complete', { citations: [] }),
          sseEvent('pass3_complete', {
            quality: {
              overall_score: 0.85,
              word_count: 150,
              word_limit_compliance: true,
              citation_count: 2,
              unsupported_claims: [],
              suggestions: ['Consider adding more detail'],
              issues: [],
            },
          }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('saving');
      expect(result.current.qualityScore).toBe(0.85);
    });

    it('handles pass3_complete with null quality gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'Text' }),
          sseEvent('pass2_complete', { citations: [] }),
          sseEvent('pass3_complete', { quality: null }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('saving');
      expect(result.current.qualityScore).toBeNull();
    });

    it('processes done event — transitions to done phase with response metadata', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'Final response' }),
          sseEvent('pass2_complete', { citations: [] }),
          sseEvent('pass3_complete', { quality: { overall_score: 0.9 } }),
          sseEvent('done', { response_id: 'resp-123', total_cost: 0.0234 }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('done');
      expect(result.current.responseId).toBe('resp-123');
      expect(result.current.totalCost).toBe(0.0234);
      expect(result.current.text).toBe('Final response');
      expect(result.current.qualityScore).toBe(0.9);
    });

    it('handles done event with missing optional fields', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('done', {}),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('done');
      expect(result.current.responseId).toBeNull();
      expect(result.current.totalCost).toBeNull();
    });

    it('processes error event from server — transitions to error phase', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'Partial' }),
          sseEvent('error', { error: 'Claude API rate limited' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('error');
      expect(result.current.error).toBe('Claude API rate limited');
      // Partial text should be preserved
      expect(result.current.text).toBe('Partial');
    });

    it('handles error event with missing error message', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('error', {}),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('error');
      expect(result.current.error).toBe('Unknown error');
    });
  });

  // =========================================================================
  // Full 3-pass pipeline end-to-end
  // =========================================================================

  describe('full pipeline end-to-end', () => {
    it('processes all phases in correct order', async () => {
      const citations = [
        {
          cited_text: 'ISO 27001',
          source_index: 0,
          source_id: 'c-1',
          source_title: 'Cert',
          source_url: '/item/c-1',
          start_block_index: 0,
          end_block_index: 1,
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        body: buildDelayedSSEStream([
          sseEvent('pass1_complete', { analysis: 'Relevant content found' }),
          sseEvent('token', { text: 'We ' }),
          sseEvent('token', { text: 'deliver ' }),
          sseEvent('token', { text: 'excellence.' }),
          sseEvent('pass2_complete', { citations }),
          sseEvent('pass3_complete', { quality: { overall_score: 0.92 } }),
          sseEvent('done', { response_id: 'r-final', total_cost: 0.0312 }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      // Verify final state has accumulated all data
      expect(result.current.phase).toBe('done');
      expect(result.current.text).toBe('We deliver excellence.');
      expect(result.current.citations).toEqual(citations);
      expect(result.current.qualityScore).toBe(0.92);
      expect(result.current.responseId).toBe('r-final');
      expect(result.current.totalCost).toBe(0.0312);
      expect(result.current.error).toBeNull();
    });
  });

  // =========================================================================
  // Progressive state updates during streaming
  // =========================================================================

  describe('progressive state updates', () => {
    it('text accumulates across multiple token events', async () => {
      const tokens = ['The ', 'quick ', 'brown ', 'fox ', 'jumps.'];

      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          ...tokens.map((t) => sseEvent('token', { text: t })),
          sseEvent('done', { response_id: 'r-1' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.text).toBe('The quick brown fox jumps.');
    });

    it('handles many tokens without losing any', async () => {
      const tokenCount = 100;
      const tokens = Array.from({ length: tokenCount }, (_, i) => `word${i} `);

      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          ...tokens.map((t) => sseEvent('token', { text: t })),
          sseEvent('done', { response_id: 'r-1' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.text).toBe(tokens.join(''));
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('error handling', () => {
    it('handles non-ok HTTP response with JSON error body', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Bid not found' }),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('error');
      expect(result.current.error).toBe('Bid not found');
    });

    it('handles non-ok HTTP response with non-JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('error');
      expect(result.current.error).toBe('Request failed');
    });

    it('handles missing response body (null body)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: null,
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('error');
      expect(result.current.error).toBe('No response body');
    });

    it('handles network error (fetch rejects)', async () => {
      mockFetch.mockRejectedValue(new Error('Failed to fetch'));

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('error');
      expect(result.current.error).toBe('Failed to fetch');
    });

    it('handles mid-stream reader failure', async () => {
      // Create a stream that delivers some chunks successfully then errors
      // on a subsequent read — simulating a connection reset
      let pullCount = 0;
      const encoder = new TextEncoder();
      const chunks = [
        encoder.encode(sseEvent('pass1_complete', {})),
        encoder.encode(sseEvent('token', { text: 'Partial text' })),
      ];

      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pullCount < chunks.length) {
            controller.enqueue(chunks[pullCount]);
            pullCount++;
          } else {
            controller.error(new Error('Connection reset'));
          }
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        body: stream,
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('error');
      expect(result.current.error).toBe('Connection reset');
      // Partial text should still be there — it was processed before the error
      expect(result.current.text).toBe('Partial text');
    });

    it('handles server-sent error event mid-stream (preserves accumulated state)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'We provide ' }),
          sseEvent('token', { text: 'excellent ' }),
          sseEvent('error', { error: 'Token limit exceeded' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('error');
      expect(result.current.error).toBe('Token limit exceeded');
      expect(result.current.text).toBe('We provide excellent ');
    });

    it('does not set error state on AbortError', async () => {
      // Simulate an abort by having fetch throw AbortError
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValue(abortError);

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      // Phase should be analysing (it was set before the fetch call)
      // but NOT error — AbortError is intentionally suppressed
      expect(result.current.phase).not.toBe('error');
      expect(result.current.error).toBeNull();
    });
  });

  // =========================================================================
  // Abort / cancel behaviour
  // =========================================================================

  describe('abort and cancel behaviour', () => {
    it('cancel resets state to initial', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'Partial text' }),
          sseEvent('done', { response_id: 'r-1', total_cost: 0.01 }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      // Start and complete a draft first
      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('done');
      expect(result.current.text).toBe('Partial text');

      // Now cancel — should reset everything
      act(() => {
        result.current.cancel();
      });

      expect(result.current.phase).toBe('idle');
      expect(result.current.text).toBe('');
      expect(result.current.citations).toEqual([]);
      expect(result.current.qualityScore).toBeNull();
      expect(result.current.responseId).toBeNull();
      expect(result.current.totalCost).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('starting a new draft aborts the previous one', async () => {
      let firstAbortSignal: AbortSignal | undefined;

      mockFetch.mockImplementation(async (_url: string, opts: RequestInit) => {
        if (!firstAbortSignal) {
          firstAbortSignal = opts.signal as AbortSignal;
        }
        return {
          ok: true,
          body: buildSSEStream([
            sseEvent('done', { response_id: 'r-new' }),
          ]),
        };
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      // Start first draft
      await act(async () => {
        await result.current.startDraft('q-1');
      });

      // Start second draft — should abort first
      await act(async () => {
        await result.current.startDraft('q-2');
      });

      expect(firstAbortSignal?.aborted).toBe(true);
    });

    it('cancel can be called when idle (no-op)', () => {
      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      // Should not throw
      act(() => {
        result.current.cancel();
      });

      expect(result.current.phase).toBe('idle');
    });
  });

  // =========================================================================
  // Edge cases — SSE parsing
  // =========================================================================

  describe('edge cases', () => {
    it('handles empty stream body (no events)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      // Phase stays at analysing because no events changed it
      expect(result.current.phase).toBe('analysing');
      expect(result.current.text).toBe('');
      expect(result.current.error).toBeNull();
    });

    it('skips malformed JSON in SSE data', async () => {
      // Build a stream with a malformed event followed by valid events
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // Valid event
          controller.enqueue(encoder.encode(sseEvent('pass1_complete', {})));
          // Malformed JSON event
          controller.enqueue(
            encoder.encode('event: token\ndata: {broken json\n\n')
          );
          // Valid event after malformed one
          controller.enqueue(
            encoder.encode(sseEvent('token', { text: 'Valid token' }))
          );
          controller.enqueue(
            encoder.encode(sseEvent('done', { response_id: 'r-1' }))
          );
          controller.close();
        },
      });

      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      // Should skip the malformed event and process the rest
      expect(result.current.phase).toBe('done');
      expect(result.current.text).toBe('Valid token');
      expect(result.current.responseId).toBe('r-1');
    });

    it('handles unknown event types gracefully (ignores them)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('unknown_event', { foo: 'bar' }),
          sseEvent('token', { text: 'Hello' }),
          sseEvent('done', { response_id: 'r-1' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('done');
      expect(result.current.text).toBe('Hello');
    });

    it('handles events split across multiple chunks', async () => {
      // Simulate an event that arrives split across two network chunks
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // First chunk: complete pass1_complete event + partial token event
          controller.enqueue(
            encoder.encode(
              'event: pass1_complete\ndata: {}\n\nevent: tok'
            )
          );
          // Second chunk: rest of token event
          controller.enqueue(
            encoder.encode(
              'en\ndata: {"text":"split text"}\n\n'
            )
          );
          // Third chunk: done event
          controller.enqueue(
            encoder.encode(sseEvent('done', { response_id: 'r-1' }))
          );
          controller.close();
        },
      });

      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('done');
      expect(result.current.text).toBe('split text');
    });

    it('handles token events with empty text', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: '' }),
          sseEvent('token', { text: 'Real text' }),
          sseEvent('done', { response_id: 'r-1' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.text).toBe('Real text');
    });

    it('handles token events with special characters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'Line 1\nLine 2' }),
          sseEvent('token', { text: ' — "quoted" & <html>' }),
          sseEvent('done', { response_id: 'r-1' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.text).toBe('Line 1\nLine 2 — "quoted" & <html>');
    });

    it('handles SSE lines without the expected prefix (ignored)', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // A comment line (starts with :) — should be ignored
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
          // Normal event
          controller.enqueue(encoder.encode(sseEvent('pass1_complete', {})));
          // Random line with no prefix — ignored
          controller.enqueue(encoder.encode('random garbage\n\n'));
          controller.enqueue(
            encoder.encode(sseEvent('done', { response_id: 'r-1' }))
          );
          controller.close();
        },
      });

      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('done');
      expect(result.current.responseId).toBe('r-1');
    });

    it('uses different bidId for different hook instances', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('done', { response_id: 'r-1' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-42'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/bids/bid-42/responses/draft-stream');
    });

    it('handles rapid successive startDraft calls', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          body: buildSSEStream([
            sseEvent('done', { response_id: `r-${callCount}` }),
          ]),
        };
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      // Fire three drafts rapidly
      await act(async () => {
        // Don't await the first two — they get aborted
        void result.current.startDraft('q-1');
        void result.current.startDraft('q-2');
        await result.current.startDraft('q-3');
      });

      // The final state should reflect the last call
      expect(result.current.phase).toBe('done');
    });
  });

  // =========================================================================
  // Phase transitions — verifying valid transitions
  // =========================================================================

  describe('phase transitions', () => {
    it.each<{ events: string[]; expectedPhase: StreamPhase }>([
      {
        events: [],
        expectedPhase: 'analysing',
      },
      {
        events: [sseEvent('pass1_complete', {})],
        expectedPhase: 'drafting',
      },
      {
        events: [
          sseEvent('pass1_complete', {}),
          sseEvent('pass2_complete', { citations: [] }),
        ],
        expectedPhase: 'quality',
      },
      {
        events: [
          sseEvent('pass1_complete', {}),
          sseEvent('pass2_complete', { citations: [] }),
          sseEvent('pass3_complete', { quality: { overall_score: 0.8 } }),
        ],
        expectedPhase: 'saving',
      },
      {
        events: [
          sseEvent('pass1_complete', {}),
          sseEvent('pass2_complete', { citations: [] }),
          sseEvent('pass3_complete', { quality: { overall_score: 0.8 } }),
          sseEvent('done', { response_id: 'r-1' }),
        ],
        expectedPhase: 'done',
      },
    ])(
      'reaches $expectedPhase phase with the right events',
      async ({ events, expectedPhase }) => {
        mockFetch.mockResolvedValue({
          ok: true,
          body: buildSSEStream(events),
        });

        const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

        await act(async () => {
          await result.current.startDraft('q-1');
        });

        expect(result.current.phase).toBe(expectedPhase);
      }
    );
  });

  // =========================================================================
  // Hook identity stability
  // =========================================================================

  describe('callback stability', () => {
    it('startDraft is stable across re-renders with same bidId', () => {
      const { result, rerender } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      const firstStartDraft = result.current.startDraft;
      const firstCancel = result.current.cancel;

      rerender();

      expect(result.current.startDraft).toBe(firstStartDraft);
      expect(result.current.cancel).toBe(firstCancel);
    });

    it('startDraft changes when bidId changes', () => {
      let bidId = 'bid-1';
      const { result, rerender } = renderHook(() => useDraftStream(bidId), { wrapper: Wrapper });

      const firstStartDraft = result.current.startDraft;

      bidId = 'bid-2';
      rerender();

      expect(result.current.startDraft).not.toBe(firstStartDraft);
    });
  });

  // =========================================================================
  // Cache invalidation on stream completion
  // =========================================================================

  describe('TanStack Query cache invalidation', () => {
    it('invalidates bids.questions and bids.detail when phase transitions to done', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'Response' }),
          sseEvent('done', { response_id: 'r-1', total_cost: 0.01 }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('done');

      // The useEffect fires on the next tick after phase changes to 'done'
      await act(async () => {
        await Promise.resolve();
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['bids', 'questions', 'bid-1'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['bids', 'detail', 'bid-1'],
      });
    });

    it('does NOT invalidate caches for non-done phases', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('pass1_complete', {}),
          sseEvent('token', { text: 'Partial' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      // Phase should be 'drafting', not 'done'
      expect(result.current.phase).toBe('drafting');
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('does NOT invalidate caches on error phase', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('error', { error: 'Something went wrong' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-1'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      expect(result.current.phase).toBe('error');
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('invalidates with correct bidId when bidId differs', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream([
          sseEvent('done', { response_id: 'r-1' }),
        ]),
      });

      const { result } = renderHook(() => useDraftStream('bid-42'), { wrapper: Wrapper });

      await act(async () => {
        await result.current.startDraft('q-1');
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['bids', 'questions', 'bid-42'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['bids', 'detail', 'bid-42'],
      });
    });
  });
});
