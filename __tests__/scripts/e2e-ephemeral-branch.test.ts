/**
 * Behaviour tests for scripts/e2e-ephemeral-branch.ts (ID-128.10).
 *
 * Verifies the ephemeral-branch lifecycle helpers (sweep / create / wait-ready /
 * keys / delete) against a mocked Supabase Management API `fetch` — no live
 * Supabase account is touched. Mirrors the fakeFetch-queue style established by
 * `__tests__/scripts/set-data-api-exposure.test.ts`.
 *
 * Per test-philosophy.md: assert observable behaviour (which branches get
 * deleted vs kept, what the poll loop retries on, what teardown treats as
 * already-clean) rather than internals.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  branchNameFor,
  branchUrlFor,
  normaliseBranchRecord,
  normaliseApiKeys,
  listBranches,
  sweepStaleBranches,
  createEphemeralBranch,
  deleteBranch,
  fetchBranchApiKeys,
  waitForBranchReady,
  EphemeralBranchError,
} from '@/scripts/e2e-ephemeral-branch';

interface FakeResponse {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}

/** A queue entry that throws (network error) instead of resolving a Response. */
interface FakeThrow {
  throws: unknown;
}

/** Returns a fetch double that yields the queued responses in order, recording calls. */
function fakeFetch(queue: FakeResponse[]): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = queue[i++] ?? queue[queue.length - 1];
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json,
      text: async () => r.text ?? (r.json ? JSON.stringify(r.json) : ''),
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** Like fakeFetch, but queue entries may also be a `{ throws }` network-error double. */
function fakeFetchWithThrows(queue: Array<FakeResponse | FakeThrow>): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = queue[i++] ?? queue[queue.length - 1];
    if ('throws' in r) {
      throw r.throws;
    }
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json,
      text: async () => r.text ?? (r.json ? JSON.stringify(r.json) : ''),
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const silent = () => {};

describe('branchNameFor', () => {
  it('produces a stable, sanitised, prefixed name from a run id + timestamp', () => {
    const name = branchNameFor('12345/weird chars!', 1_800_000_000_000);
    expect(name.startsWith('e2e-nightly-')).toBe(true);
    expect(name).toMatch(/^[a-z0-9-]+$/i);
    expect(name).not.toMatch(/[/!\s]/);
  });

  it('is deterministic for the same inputs', () => {
    expect(branchNameFor('abc', 1_000)).toBe(branchNameFor('abc', 1_000));
  });
});

describe('branchUrlFor', () => {
  it('derives the branch REST URL from its project ref', () => {
    expect(branchUrlFor('abcd1234')).toBe('https://abcd1234.supabase.co');
  });
});

describe('normaliseBranchRecord', () => {
  it('extracts id/ref/name/createdAt/status from a well-shaped record', () => {
    const b = normaliseBranchRecord({
      id: 'branch-uuid-1',
      project_ref: 'branchref123',
      name: 'e2e-nightly-run1-20260710',
      created_at: '2026-07-10T04:00:00.000Z',
      status: 'ACTIVE_HEALTHY',
    });
    expect(b).toEqual({
      id: 'branch-uuid-1',
      ref: 'branchref123',
      name: 'e2e-nightly-run1-20260710',
      createdAt: '2026-07-10T04:00:00.000Z',
      status: 'ACTIVE_HEALTHY',
    });
  });

  it('falls back across plausible alias field names', () => {
    const b = normaliseBranchRecord({
      branch_id: 'id2',
      ref: 'ref2',
      branch_name: 'e2e-nightly-run2',
    });
    expect(b.id).toBe('id2');
    expect(b.ref).toBe('ref2');
    expect(b.name).toBe('e2e-nightly-run2');
    expect(b.createdAt).toBeNull();
  });

  it('throws with the actual key list when id/ref cannot be found (fail loud, not silent-wrong)', () => {
    expect(() => normaliseBranchRecord({ foo: 'bar' })).toThrow(
      EphemeralBranchError,
    );
    expect(() => normaliseBranchRecord({ foo: 'bar' })).toThrow(/foo/);
  });

  it('throws on a non-object record', () => {
    expect(() => normaliseBranchRecord(null)).toThrow(EphemeralBranchError);
  });
});

describe('listBranches', () => {
  it('GETs the platform project branches endpoint and normalises every row', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        ok: true,
        json: [
          { id: 'a', project_ref: 'refa', name: 'e2e-nightly-x' },
          { id: 'b', project_ref: 'refb', name: 'staging' },
        ],
      },
    ]);
    const branches = await listBranches('platformref', {
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(branches).toHaveLength(2);
    expect(calls[0].url).toBe(
      'https://api.supabase.com/v1/projects/platformref/branches',
    );
    expect(
      (calls[0].init?.headers as Record<string, string>).Authorization,
    ).toBe('Bearer t');
  });

  it('throws when the response is not an array', async () => {
    const { fetchImpl } = fakeFetch([{ ok: true, json: { not: 'an array' } }]);
    await expect(
      listBranches('platformref', { token: 't', fetchImpl, log: silent }),
    ).rejects.toBeInstanceOf(EphemeralBranchError);
  });
});

describe('sweepStaleBranches — orphan-teardown guard', () => {
  it('deletes only prefix-matching branches older than maxAgeHours, leaves the rest', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z').getTime();
    const { fetchImpl, calls } = fakeFetch([
      {
        ok: true,
        json: [
          // 8h old, matches prefix -> stale, deleted
          {
            id: 'stale-1',
            project_ref: 'refstale1',
            name: 'e2e-nightly-oldrun-x',
            created_at: '2026-07-10T04:00:00.000Z',
          },
          // 1h old, matches prefix -> fresh, kept
          {
            id: 'fresh-1',
            project_ref: 'reffresh1',
            name: 'e2e-nightly-newrun-y',
            created_at: '2026-07-10T11:00:00.000Z',
          },
          // 100h old, does NOT match prefix -> never touched
          {
            id: 'other-1',
            project_ref: 'refother1',
            name: 'staging',
            created_at: '2026-07-01T00:00:00.000Z',
          },
        ],
      },
      { ok: true, status: 200, text: '' }, // DELETE stale-1's branch
    ]);
    const result = await sweepStaleBranches({
      platformProjectRef: 'platformref',
      maxAgeHours: 6,
      nowMs: now,
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(result.deleted.map((b) => b.name)).toEqual(['e2e-nightly-oldrun-x']);
    expect(result.kept.map((b) => b.name)).toEqual(['e2e-nightly-newrun-y']);
    // list + exactly one delete call (the non-matching "staging" branch is
    // never even considered, let alone deleted).
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe('https://api.supabase.com/v1/branches/refstale1');
    expect(calls[1].init?.method).toBe('DELETE');
  });

  it('dry-run reports what WOULD be deleted without calling DELETE', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z').getTime();
    const { fetchImpl, calls } = fakeFetch([
      {
        ok: true,
        json: [
          {
            id: 'stale-1',
            project_ref: 'refstale1',
            name: 'e2e-nightly-oldrun-x',
            created_at: '2026-07-10T04:00:00.000Z',
          },
        ],
      },
    ]);
    const result = await sweepStaleBranches({
      platformProjectRef: 'platformref',
      maxAgeHours: 6,
      nowMs: now,
      dryRun: true,
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(result.deleted).toHaveLength(1);
    expect(calls).toHaveLength(1); // GET only, no DELETE
  });

  it('treats a branch with no created_at as infinitely old (always swept)', async () => {
    const { fetchImpl } = fakeFetch([
      {
        ok: true,
        json: [{ id: 'x', project_ref: 'refx', name: 'e2e-nightly-noage' }],
      },
      { ok: true, status: 200, text: '' },
    ]);
    const result = await sweepStaleBranches({
      platformProjectRef: 'platformref',
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(result.deleted).toHaveLength(1);
  });

  it('fails TOWARD deletion when created_at is present but unparseable, not away from it', async () => {
    // A present-but-garbage created_at must NOT silently keep the branch —
    // that would be the opposite of this guard's fail-safe direction, and
    // the exact field format is unconfirmed (see file-header epistemic
    // caveat), so a real live response could plausibly send something this
    // script doesn't expect.
    const { fetchImpl } = fakeFetch([
      {
        ok: true,
        json: [
          {
            id: 'garbage-ts',
            project_ref: 'refgarbage',
            name: 'e2e-nightly-garbage-timestamp',
            created_at: 'not-a-real-timestamp',
          },
        ],
      },
      { ok: true, status: 200, text: '' }, // DELETE
    ]);
    const result = await sweepStaleBranches({
      platformProjectRef: 'platformref',
      maxAgeHours: 6,
      nowMs: new Date('2026-07-10T12:00:00.000Z').getTime(),
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(result.deleted.map((b) => b.name)).toEqual([
      'e2e-nightly-garbage-timestamp',
    ]);
    expect(result.kept).toHaveLength(0);
  });
});

describe('createEphemeralBranch', () => {
  it('POSTs branch_name and normalises the created branch', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        ok: true,
        json: { id: 'newid', project_ref: 'newref', name: 'e2e-nightly-r1' },
      },
    ]);
    const branch = await createEphemeralBranch({
      platformProjectRef: 'platformref',
      branchName: 'e2e-nightly-r1',
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(branch.id).toBe('newid');
    expect(branch.ref).toBe('newref');
    expect(calls[0].url).toBe(
      'https://api.supabase.com/v1/projects/platformref/branches',
    );
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      branch_name: 'e2e-nightly-r1',
    });
  });
});

describe('deleteBranch — idempotent teardown', () => {
  it('succeeds on 200', async () => {
    const { fetchImpl, calls } = fakeFetch([{ ok: true, status: 200 }]);
    await expect(
      deleteBranch('someref', { token: 't', fetchImpl, log: silent }),
    ).resolves.toBeUndefined();
    expect(calls[0].url).toBe('https://api.supabase.com/v1/branches/someref');
    expect(calls[0].init?.method).toBe('DELETE');
  });

  it('treats 404 (already gone) as success, not failure — and does not retry', async () => {
    const { fetchImpl, calls } = fakeFetch([{ ok: false, status: 404 }]);
    await expect(
      deleteBranch('gone-already', { token: 't', fetchImpl, log: silent }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(1); // 404 is not retryable — single attempt
  });

  it('throws after exhausting retries on a persistent server error', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { ok: false, status: 500, text: 'boom' },
    ]);
    await expect(
      deleteBranch('someref', {
        token: 't',
        fetchImpl,
        log: silent,
        sleepFn: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toBeInstanceOf(EphemeralBranchError);
    expect(calls).toHaveLength(3); // default 3 attempts, all exhausted
  });

  it('retries a transient 503 during always()-teardown and then succeeds', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const { fetchImpl, calls } = fakeFetchWithThrows([
      { ok: false, status: 503, text: 'unavailable' },
      { ok: true, status: 200 },
    ]);
    await expect(
      deleteBranch('flaky-ref', {
        token: 't',
        fetchImpl,
        log: silent,
        sleepFn,
      }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it('retries a network error (not just HTTP statuses) and then succeeds', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const { fetchImpl, calls } = fakeFetchWithThrows([
      { throws: new TypeError('fetch failed: connection reset') },
      { ok: true, status: 200 },
    ]);
    await expect(
      deleteBranch('flaky-ref', {
        token: 't',
        fetchImpl,
        log: silent,
        sleepFn,
      }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it('throws after exhausting retries on a persistent network error', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const { fetchImpl, calls } = fakeFetchWithThrows([
      { throws: new TypeError('fetch failed: connection reset') },
    ]);
    await expect(
      deleteBranch('flaky-ref', {
        token: 't',
        fetchImpl,
        log: silent,
        sleepFn,
      }),
    ).rejects.toThrow(/connection reset/);
    expect(calls).toHaveLength(3);
  });

  it('does NOT retry a non-retryable 4xx (e.g. 401) — single attempt', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { ok: false, status: 401, text: 'unauthorized' },
    ]);
    await expect(
      deleteBranch('someref', {
        token: 'bad',
        fetchImpl,
        log: silent,
        sleepFn: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toBeInstanceOf(EphemeralBranchError);
    expect(calls).toHaveLength(1);
  });
});

describe('mgmtFetch retry behaviour (exercised via listBranches / createEphemeralBranch)', () => {
  it('retries a transient 500 then succeeds', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const { fetchImpl, calls } = fakeFetch([
      { ok: false, status: 500, text: 'boom' },
      { ok: true, json: [{ id: 'a', project_ref: 'refa', name: 'staging' }] },
    ]);
    const branches = await listBranches('platformref', {
      token: 't',
      fetchImpl,
      log: silent,
      sleepFn,
    });
    expect(branches).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 rate-limit response then succeeds', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const { fetchImpl, calls } = fakeFetch([
      { ok: false, status: 429, text: 'rate limited' },
      { ok: true, json: { id: 'newid', project_ref: 'newref', name: 'r1' } },
    ]);
    const branch = await createEphemeralBranch({
      platformProjectRef: 'platformref',
      branchName: 'r1',
      token: 't',
      fetchImpl,
      log: silent,
      sleepFn,
    });
    expect(branch.id).toBe('newid');
    expect(calls).toHaveLength(2);
  });

  it('throws after exhausting retries on a persistent 5xx', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const { fetchImpl, calls } = fakeFetch([
      { ok: false, status: 503, text: 'unavailable' },
    ]);
    await expect(
      listBranches('platformref', {
        token: 't',
        fetchImpl,
        log: silent,
        sleepFn,
      }),
    ).rejects.toBeInstanceOf(EphemeralBranchError);
    expect(calls).toHaveLength(3);
  });

  it('does NOT retry a non-retryable 401 — fails on the first attempt', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { ok: false, status: 401, text: 'unauthorized' },
    ]);
    await expect(
      listBranches('platformref', {
        token: 'bad',
        fetchImpl,
        log: silent,
        sleepFn: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toBeInstanceOf(EphemeralBranchError);
    expect(calls).toHaveLength(1);
  });
});

describe('normaliseApiKeys', () => {
  it('prefers the publishable/secret pair when present', () => {
    const keys = normaliseApiKeys([
      { type: 'publishable', api_key: 'pub-1' },
      { type: 'secret', api_key: 'sec-1' },
    ]);
    expect(keys).toEqual({ publishableKey: 'pub-1', serviceRoleKey: 'sec-1' });
  });

  it('falls back to legacy anon/service_role', () => {
    const keys = normaliseApiKeys([
      { name: 'anon', api_key: 'anon-1' },
      { name: 'service_role', api_key: 'svc-1' },
    ]);
    expect(keys).toEqual({ publishableKey: 'anon-1', serviceRoleKey: 'svc-1' });
  });

  it('throws with a diagnostic dump when neither pair is found', () => {
    expect(() => normaliseApiKeys([{ type: 'something-else' }])).toThrow(
      EphemeralBranchError,
    );
  });

  it('throws when the response is not an array', () => {
    expect(() => normaliseApiKeys({ not: 'an array' })).toThrow(
      EphemeralBranchError,
    );
  });
});

describe('fetchBranchApiKeys', () => {
  it('GETs the branch project api-keys endpoint with reveal=true', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        ok: true,
        json: [
          { type: 'publishable', api_key: 'pub-1' },
          { type: 'secret', api_key: 'sec-1' },
        ],
      },
    ]);
    const keys = await fetchBranchApiKeys({
      branchProjectRef: 'branchref',
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(keys.publishableKey).toBe('pub-1');
    expect(keys.serviceRoleKey).toBe('sec-1');
    expect(calls[0].url).toBe(
      'https://api.supabase.com/v1/projects/branchref/api-keys?reveal=true',
    );
  });
});

describe('waitForBranchReady', () => {
  it('resolves as soon as the readiness probe returns rows', async () => {
    const { fetchImpl } = fakeFetch([{ ok: true, json: [{ id: 'x' }] }]);
    await expect(
      waitForBranchReady({
        branchUrl: 'https://branchref.supabase.co',
        serviceRoleKey: 'svc',
        fetchImpl,
        log: silent,
        sleepFn: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBeUndefined();
  });

  it('retries through not-ready responses (404 / empty) before succeeding', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { ok: false, status: 404, text: 'relation does not exist' },
      { ok: true, json: [] }, // table exists, seed.sql not yet applied
      { ok: true, json: [{ id: 'x' }] },
    ]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await waitForBranchReady({
      branchUrl: 'https://branchref.supabase.co',
      serviceRoleKey: 'svc',
      fetchImpl,
      log: silent,
      sleepFn,
    });
    expect(calls).toHaveLength(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it('times out with a diagnostic error if the branch never becomes ready', async () => {
    const { fetchImpl } = fakeFetch([
      { ok: false, status: 503, text: 'unavailable' },
    ]);
    let now = 0;
    await expect(
      waitForBranchReady({
        branchUrl: 'https://branchref.supabase.co',
        serviceRoleKey: 'svc',
        fetchImpl,
        log: silent,
        timeoutMs: 100,
        intervalMs: 10,
        nowFn: () => {
          now += 40;
          return now;
        },
        sleepFn: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow(/did not become ready/);
  });
});
