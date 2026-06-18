/**
 * Tests for `lib/integrations/github-dispatch.ts`.
 *
 * P0-TX WP2: verifies the GitHub Actions repository_dispatch helper:
 * - Throws when GITHUB_SYNC_TOKEN is missing
 * - Sends correct headers + body on success (HTTP 204)
 * - Returns structured error for 4xx (no retry)
 * - Retries once on 5xx, succeeds or fails on retry
 * - Retries once on network error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module under test — imported after env setup
// ---------------------------------------------------------------------------

// We need a fresh module import per test group to reset env reads.
// Use dynamic import inside tests where env must differ.

// For most tests, set the token and import statically.
const MOCK_TOKEN = 'ghp_test_token_abc123';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
  originalFetch = globalThis.fetch;
  process.env.GITHUB_SYNC_TOKEN = MOCK_TOKEN;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  delete process.env.GITHUB_SYNC_TOKEN;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dispatchTaxonomySync', () => {
  it('throws when GITHUB_SYNC_TOKEN is not set', async () => {
    delete process.env.GITHUB_SYNC_TOKEN;

    const { dispatchTaxonomySync } =
      await import('@/lib/integrations/github-dispatch');

    await expect(dispatchTaxonomySync()).rejects.toThrow(
      'GITHUB_SYNC_TOKEN not configured',
    );
  });

  it('sends correct headers and body, returns ok on HTTP 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204 });
    globalThis.fetch = fetchMock;

    const { dispatchTaxonomySync } =
      await import('@/lib/integrations/github-dispatch');

    const result = await dispatchTaxonomySync();

    expect(result).toEqual({ ok: true, status: 204 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.github.com/repos/ai-solution-hub/canonical/dispatches',
    );
    expect(opts.method).toBe('POST');
    expect(opts.headers).toMatchObject({
      Authorization: `Bearer ${MOCK_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(opts.body as string)).toEqual({
      event_type: 'taxonomy-sync',
      client_payload: { run_id: '' },
    });
  });

  it('returns error on HTTP 401 without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 401 });
    globalThis.fetch = fetchMock;

    const { dispatchTaxonomySync } =
      await import('@/lib/integrations/github-dispatch');

    const result = await dispatchTaxonomySync();

    expect(result).toEqual({
      ok: false,
      status: 401,
      error: 'GitHub token expired or invalid — rotate GITHUB_SYNC_TOKEN',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns error on HTTP 403 without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 403 });
    globalThis.fetch = fetchMock;

    const { dispatchTaxonomySync } =
      await import('@/lib/integrations/github-dispatch');

    const result = await dispatchTaxonomySync();

    expect(result).toEqual({
      ok: false,
      status: 403,
      error:
        'GitHub token lacks required permissions (needs contents:write + actions:read)',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on HTTP 500 and succeeds on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 204 });
    globalThis.fetch = fetchMock;

    const { dispatchTaxonomySync } =
      await import('@/lib/integrations/github-dispatch');

    const promise = dispatchTaxonomySync();

    // Advance past the 2 s retry delay
    await vi.advanceTimersByTimeAsync(2_000);

    const result = await promise;

    expect(result).toEqual({ ok: true, status: 204 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once on HTTP 500 and fails on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 502 });
    globalThis.fetch = fetchMock;

    const { dispatchTaxonomySync } =
      await import('@/lib/integrations/github-dispatch');

    const promise = dispatchTaxonomySync();

    await vi.advanceTimersByTimeAsync(2_000);

    const result = await promise;

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: 'GitHub API returned 502',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once on network error and succeeds on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ status: 204 });
    globalThis.fetch = fetchMock;

    const { dispatchTaxonomySync } =
      await import('@/lib/integrations/github-dispatch');

    const promise = dispatchTaxonomySync();

    await vi.advanceTimersByTimeAsync(2_000);

    const result = await promise;

    expect(result).toEqual({ ok: true, status: 204 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once on network error and returns structured failure on second error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'));
    globalThis.fetch = fetchMock;

    const { dispatchTaxonomySync } =
      await import('@/lib/integrations/github-dispatch');

    const promise = dispatchTaxonomySync();

    await vi.advanceTimersByTimeAsync(2_000);

    const result = await promise;

    expect(result).toEqual({
      ok: false,
      status: 0,
      error: 'Network error after retry: ETIMEDOUT',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
