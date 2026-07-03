/**
 * Unit tests for lib/corpus/writer-fence.ts — ID-138 {138.9}.
 *
 * Spec: TECH.md §2.6 R(ops), §3.4 O (writer fencing); PLAN.md §2.
 *
 * Verifies OBSERVABLE BEHAVIOUR against the mocked `.rpc()` calls: the
 * correct RPC name + `p_holder` param is sent, a `false` acquire/release
 * result is returned (never thrown — try-semantics, "busy" is normal), an
 * RPC error is surfaced as a thrown error, and `withWriterFence` acquires,
 * runs the guarded callback, and always attempts release without letting a
 * release failure mask the callback's own error.
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

describe('writer-fence (ID-138 {138.9})', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
    vi.clearAllMocks();
  });

  function client(): SupabaseClient<Database> {
    return mockClient as unknown as SupabaseClient<Database>;
  }

  describe('acquireWriterFence', () => {
    it('forwards the holder label to corpus_writer_fence_try_acquire and returns true on acquisition', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: true, error: null });

      const acquired = await acquireWriterFence(client(), 'pull_sync');

      expect(acquired).toBe(true);
      expect(mockClient.rpc).toHaveBeenCalledTimes(1);
      expect(mockClient.rpc).toHaveBeenCalledWith(
        'corpus_writer_fence_try_acquire',
        { p_holder: 'pull_sync' },
      );
    });

    it('returns false (never throws) when the fence is already held — busy is a normal outcome', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: false, error: null });

      const acquired = await acquireWriterFence(client());

      expect(acquired).toBe(false);
    });

    it('passes null for an omitted holder', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: true, error: null });

      await acquireWriterFence(client());

      expect(mockClient.rpc).toHaveBeenCalledWith(
        'corpus_writer_fence_try_acquire',
        { p_holder: null },
      );
    });

    it('throws on an RPC failure (distinct from a normal busy/false result)', async () => {
      mockClient.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'connection reset', code: 'NETWORK_ERROR' },
      });

      await expect(acquireWriterFence(client())).rejects.toThrow();
    });
  });

  describe('releaseWriterFence', () => {
    it('forwards the holder label to corpus_writer_fence_release and returns true on release', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: true, error: null });

      const released = await releaseWriterFence(client(), 'upload');

      expect(released).toBe(true);
      expect(mockClient.rpc).toHaveBeenCalledWith(
        'corpus_writer_fence_release',
        { p_holder: 'upload' },
      );
    });

    it('returns false (never throws) when this session did not hold the fence', async () => {
      mockClient.rpc.mockResolvedValueOnce({ data: false, error: null });

      const released = await releaseWriterFence(client());

      expect(released).toBe(false);
    });

    it('throws on an RPC failure', async () => {
      mockClient.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'db unreachable', code: 'NETWORK_ERROR' },
      });

      await expect(releaseWriterFence(client())).rejects.toThrow();
    });
  });

  describe('withWriterFence', () => {
    it('acquires, runs the callback, and releases on success', async () => {
      mockClient.rpc
        .mockResolvedValueOnce({ data: true, error: null }) // acquire
        .mockResolvedValueOnce({ data: true, error: null }); // release

      const fn = vi.fn().mockResolvedValue('done');
      const result = await withWriterFence(client(), fn, 'write_back');

      expect(result).toBe('done');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockClient.rpc).toHaveBeenNthCalledWith(
        1,
        'corpus_writer_fence_try_acquire',
        { p_holder: 'write_back' },
      );
      expect(mockClient.rpc).toHaveBeenNthCalledWith(
        2,
        'corpus_writer_fence_release',
        { p_holder: 'write_back' },
      );
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
        'corpus_writer_fence_release',
        { p_holder: 'upload' },
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
  });
});
