/**
 * Unit tests for lib/corpus/writer-fence.ts — ID-138 {138.9} REDESIGN (S445).
 *
 * Spec: TECH.md §2.6 R(ops), §3.4 O (writer fencing); PLAN.md §2.
 *
 * Verifies OBSERVABLE BEHAVIOUR against the mocked `.rpc()` calls: the
 * correct lease RPC name + `p_holder_token`/`p_holder` params are sent, a
 * `false` acquire/release result is returned (never thrown — try-semantics,
 * "busy" is normal), an RPC error is surfaced as a thrown error, and
 * `withWriterFence` mints a fresh holder token, acquires, runs the guarded
 * callback, and always attempts release with the SAME token without letting
 * a release failure mask the callback's own error.
 *
 * Mock discipline: createMockSupabaseClient() from the shared helper — never
 * hand-roll Supabase mocks (per __tests__/CLAUDE.md + test-philosophy).
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMocks,
  getRequestContext: () => undefined,
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T) => fn(),
  updateRequestContext: vi.fn(),
  withRequestContext: <T>(handler: T) => handler,
  withRequestContextBare: <T>(handler: T) => handler,
  applyRequestContextToSentry: vi.fn(),
}));

import {
  acquireWriterFence,
  releaseWriterFence,
  withWriterFence,
  WriterFenceBusyError,
} from '@/lib/corpus/writer-fence';

// Matches crypto.randomUUID() output — used to assert a holder token was
// generated + forwarded, without pinning the exact (random) value.
const UUID_MATCHER = expect.stringMatching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
);

describe('writer-fence (ID-138 {138.9} REDESIGN — lease mechanism)', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
    vi.clearAllMocks();
  });

  function client(): SupabaseClient<Database> {
    return mockClient as unknown as SupabaseClient<Database>;
  }

  describe('acquireWriterFence', () => {
    it('forwards the token + holder label to corpus_writer_fence_lease_acquire and returns true on acquisition', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: true, error: null });

      const acquired = await acquireWriterFence(
        client(),
        'token-a',
        'pull_sync',
      );

      expect(acquired).toBe(true);
      expect(mockClient.rpc).toHaveBeenCalledTimes(1);
      expect(mockClient.rpc).toHaveBeenCalledWith(
        'corpus_writer_fence_lease_acquire',
        { p_holder_token: 'token-a', p_holder: 'pull_sync' },
      );
    });

    it('returns false (never throws) when the lease is already held and unexpired — busy is a normal outcome', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: false, error: null });

      const acquired = await acquireWriterFence(client(), 'token-b');

      expect(acquired).toBe(false);
    });

    it('passes null for an omitted holder label', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: true, error: null });

      await acquireWriterFence(client(), 'token-c');

      expect(mockClient.rpc).toHaveBeenCalledWith(
        'corpus_writer_fence_lease_acquire',
        { p_holder_token: 'token-c', p_holder: null },
      );
    });

    it('forwards an explicit ttlSeconds override as p_ttl_seconds', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: true, error: null });

      await acquireWriterFence(client(), 'token-d', 'upload', 300);

      expect(mockClient.rpc).toHaveBeenCalledWith(
        'corpus_writer_fence_lease_acquire',
        { p_holder_token: 'token-d', p_holder: 'upload', p_ttl_seconds: 300 },
      );
    });

    it('omits p_ttl_seconds entirely when not provided (server DEFAULT applies)', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: true, error: null });

      await acquireWriterFence(client(), 'token-e');

      const [, params] = mockClient.rpc.mock.calls[0];
      expect(params).not.toHaveProperty('p_ttl_seconds');
    });

    it('throws on an RPC failure (distinct from a normal busy/false result)', async () => {
      mockClient.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'connection reset', code: 'NETWORK_ERROR' },
      });

      await expect(acquireWriterFence(client(), 'token-f')).rejects.toThrow();
    });
  });

  describe('releaseWriterFence', () => {
    it('forwards the token + holder label to corpus_writer_fence_lease_release and returns true on release', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: true, error: null });

      const released = await releaseWriterFence(client(), 'token-a', 'upload');

      expect(released).toBe(true);
      expect(mockClient.rpc).toHaveBeenCalledWith(
        'corpus_writer_fence_lease_release',
        { p_holder_token: 'token-a', p_holder: 'upload' },
      );
    });

    it('returns false (never throws) when the token does not match the current holder', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: false, error: null });

      const released = await releaseWriterFence(client(), 'stale-token');

      expect(released).toBe(false);
    });

    it('throws on an RPC failure', async () => {
      mockClient.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'db unreachable', code: 'NETWORK_ERROR' },
      });

      await expect(releaseWriterFence(client(), 'token-g')).rejects.toThrow();
    });
  });

  describe('withWriterFence', () => {
    it('mints a holder token, acquires, runs the callback, and releases with the SAME token on success', async () => {
      mockClient.rpc
        .mockResolvedValueOnce({ data: true, error: null }) // acquire
        .mockResolvedValueOnce({ data: true, error: null }); // release

      const fn = vi.fn().mockResolvedValue('done');
      const result = await withWriterFence(client(), fn, 'write_back');

      expect(result).toBe('done');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockClient.rpc).toHaveBeenNthCalledWith(
        1,
        'corpus_writer_fence_lease_acquire',
        { p_holder_token: UUID_MATCHER, p_holder: 'write_back' },
      );
      expect(mockClient.rpc).toHaveBeenNthCalledWith(
        2,
        'corpus_writer_fence_lease_release',
        { p_holder_token: UUID_MATCHER, p_holder: 'write_back' },
      );

      // The SAME token threaded through both calls.
      const acquireToken = mockClient.rpc.mock.calls[0][1].p_holder_token;
      const releaseToken = mockClient.rpc.mock.calls[1][1].p_holder_token;
      expect(releaseToken).toBe(acquireToken);
    });

    it('throws WriterFenceBusyError and never runs the callback when the fence is busy', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: false, error: null }); // acquire refused

      const fn = vi.fn().mockResolvedValue('should not run');

      await expect(withWriterFence(client(), fn, 'upload')).rejects.toThrow(
        WriterFenceBusyError,
      );
      expect(fn).not.toHaveBeenCalled();
      // Never acquired -> never attempts a release call.
      expect(mockClient.rpc).toHaveBeenCalledTimes(1);
    });

    it('still releases when the callback throws, and propagates the callback error unmasked', async () => {
      mockClient.rpc
        .mockResolvedValueOnce({ data: true, error: null }) // acquire
        .mockResolvedValueOnce({ data: true, error: null }); // release

      const fn = vi
        .fn()
        .mockRejectedValue(new Error('critical section blew up'));

      await expect(withWriterFence(client(), fn, 'upload')).rejects.toThrow(
        'critical section blew up',
      );
      expect(mockClient.rpc).toHaveBeenNthCalledWith(
        2,
        'corpus_writer_fence_lease_release',
        { p_holder_token: UUID_MATCHER, p_holder: 'upload' },
      );
    });

    it('logs (never throws/masks) when release itself fails after a successful callback', async () => {
      mockClient.rpc
        .mockResolvedValueOnce({ data: true, error: null }) // acquire
        .mockResolvedValueOnce({
          data: null,
          error: {
            message: 'release RPC network failure',
            code: 'NETWORK_ERROR',
          },
        }); // release fails

      const fn = vi.fn().mockResolvedValue('done');

      const result = await withWriterFence(client(), fn, 'pull_sync');

      expect(result).toBe('done');
      expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    });

    it('logs the release failure but still surfaces the ORIGINAL callback error, not the release error', async () => {
      mockClient.rpc
        .mockResolvedValueOnce({ data: true, error: null }) // acquire
        .mockResolvedValueOnce({
          data: null,
          error: {
            message: 'release RPC network failure',
            code: 'NETWORK_ERROR',
          },
        }); // release also fails

      const fn = vi
        .fn()
        .mockRejectedValue(new Error('original callback failure'));

      await expect(withWriterFence(client(), fn, 'pull_sync')).rejects.toThrow(
        'original callback failure',
      );
      expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    });

    it('mints a DIFFERENT token on each call (no token reuse across acquisitions)', async () => {
      mockClient.rpc
        .mockResolvedValueOnce({ data: true, error: null }) // acquire #1
        .mockResolvedValueOnce({ data: true, error: null }) // release #1
        .mockResolvedValueOnce({ data: true, error: null }) // acquire #2
        .mockResolvedValueOnce({ data: true, error: null }); // release #2

      await withWriterFence(client(), async () => 'first', 'write_back');
      await withWriterFence(client(), async () => 'second', 'write_back');

      const firstToken = mockClient.rpc.mock.calls[0][1].p_holder_token;
      const secondToken = mockClient.rpc.mock.calls[2][1].p_holder_token;
      expect(secondToken).not.toBe(firstToken);
    });
  });
});
