/**
 * keepAliveAfterResponse — the serverless keep-alive seam for fire-and-forget
 * work (id-127 {127.20} S555).
 *
 * WHY THIS EXISTS: the app→pipeline walk nudges are deliberately
 * fire-and-forget so a slow pipeline can never block a user-facing response —
 * but on Vercel the function instance freezes the moment the response is
 * returned, killing the in-flight fetch before it leaves the building
 * (proven live: a folder-drop admit logged at 23:10:29Z produced ZERO events
 * in the Cloudflare Access edge log). `after()` is Next's contract for work
 * that must outlive the response; this helper is the one place that contract
 * is invoked, with a swallow-and-continue fallback for non-request contexts
 * (unit tests, long-lived processes) where there is no freeze to outlive.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const afterMock = vi.hoisted(() => vi.fn());

vi.mock('next/server', () => ({
  after: afterMock,
}));

import { keepAliveAfterResponse } from '@/lib/runtime/keep-alive';

describe('keepAliveAfterResponse', () => {
  beforeEach(() => {
    afterMock.mockReset();
  });

  it('registers the promise with next/server after()', () => {
    const p = Promise.resolve('done');

    keepAliveAfterResponse(p);

    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(afterMock).toHaveBeenCalledWith(p);
  });

  it('swallows after() throwing outside a request scope — the caller must never fail', () => {
    afterMock.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope');
    });

    expect(() => keepAliveAfterResponse(Promise.resolve())).not.toThrow();
  });
});
