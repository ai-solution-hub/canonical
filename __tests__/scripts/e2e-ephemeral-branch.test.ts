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
  fetchBranchDbCreds,
  fetchBranchPoolerConnection,
  waitForBranchComputeHealthy,
  applyMigrationsAndSeed,
  waitForBranchReady,
  writeEnvVar,
  maskAndWriteEnvVar,
  emitBranchServiceRoleKeyToEnv,
  mirrorBranchPostgrestConfig,
  EphemeralBranchError,
} from '@/scripts/e2e-ephemeral-branch';

// Only the (real) default psql executor shells out to `execFileSync` — every
// other test in this file injects its own `psqlExec` double. Mocking the
// module lets one test assert the ACTUAL CLI args a real invocation would
// use (e.g. `--single-transaction`) without ever spawning a real `psql`.
const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    execFileSync: execFileSyncMock,
    default: {
      ...(actual.default as Record<string, unknown> | undefined),
      execFileSync: execFileSyncMock,
    },
  };
});

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

  it('extracts previewProjectStatus (compute health) distinct from status (migration-replay outcome)', () => {
    const b = normaliseBranchRecord({
      id: 'branch-uuid-2',
      project_ref: 'ref2',
      name: 'e2e-nightly-r2',
      status: 'MIGRATIONS_FAILED',
      preview_project_status: 'ACTIVE_HEALTHY',
    });
    expect(b.status).toBe('MIGRATIONS_FAILED');
    expect(b.previewProjectStatus).toBe('ACTIVE_HEALTHY');
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

describe('waitForBranchComputeHealthy — compute-readiness gate (distinct from migration-replay status)', () => {
  it('resolves as soon as THIS branch reaches previewProjectStatus ACTIVE_HEALTHY', async () => {
    const { fetchImpl } = fakeFetch([
      {
        ok: true,
        json: [
          {
            id: 'a',
            project_ref: 'branchref',
            name: 'e2e-nightly-r1',
            status: 'CREATING_PROJECT',
            preview_project_status: 'ACTIVE_HEALTHY',
          },
        ],
      },
    ]);
    await expect(
      waitForBranchComputeHealthy({
        platformProjectRef: 'parentref',
        branchRef: 'branchref',
        token: 't',
        fetchImpl,
        log: silent,
        sleepFn: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBeUndefined();
  });

  it('retries while the branch is absent or not yet ACTIVE_HEALTHY, even if status shows MIGRATIONS_FAILED', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { ok: true, json: [] }, // branch not listed yet
      {
        ok: true,
        json: [
          {
            id: 'a',
            project_ref: 'branchref',
            name: 'e2e-nightly-r1',
            status: 'MIGRATIONS_FAILED', // informational only — never gated on
            preview_project_status: 'COMING_UP',
          },
        ],
      },
      {
        ok: true,
        json: [
          {
            id: 'a',
            project_ref: 'branchref',
            name: 'e2e-nightly-r1',
            status: 'MIGRATIONS_FAILED',
            preview_project_status: 'ACTIVE_HEALTHY',
          },
        ],
      },
    ]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    await waitForBranchComputeHealthy({
      platformProjectRef: 'parentref',
      branchRef: 'branchref',
      token: 't',
      fetchImpl,
      log: silent,
      sleepFn,
    });
    expect(calls).toHaveLength(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it('times out with a diagnostic error if compute never becomes healthy', async () => {
    const { fetchImpl } = fakeFetch([
      {
        ok: true,
        json: [
          {
            id: 'a',
            project_ref: 'branchref',
            name: 'e2e-nightly-r1',
            preview_project_status: 'COMING_UP',
          },
        ],
      },
    ]);
    let now = 0;
    await expect(
      waitForBranchComputeHealthy({
        platformProjectRef: 'parentref',
        branchRef: 'branchref',
        token: 't',
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
    ).rejects.toThrow(/did not become healthy/);
  });
});

describe('fetchBranchDbCreds', () => {
  it('extracts host/port/user/password from the single-branch endpoint', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        ok: true,
        json: {
          ref: 'branchref',
          db_host: 'db.branchref.supabase.co',
          db_port: 5432,
          db_user: 'postgres',
          db_pass: 'super-secret-password',
        },
      },
    ]);
    const creds = await fetchBranchDbCreds('branch-id-1', {
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(creds).toEqual({
      host: 'db.branchref.supabase.co',
      port: 5432,
      user: 'postgres',
      password: 'super-secret-password',
    });
    expect(calls[0].url).toBe(
      'https://api.supabase.com/v1/branches/branch-id-1',
    );
  });

  it('defaults user to postgres and port to 5432 when absent', async () => {
    const { fetchImpl } = fakeFetch([
      { ok: true, json: { db_host: 'host', db_pass: 'pw' } },
    ]);
    const creds = await fetchBranchDbCreds('id', {
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(creds).toEqual({
      host: 'host',
      port: 5432,
      user: 'postgres',
      password: 'pw',
    });
  });

  it('throws WITHOUT echoing the response body on a non-2xx (may contain credentials)', async () => {
    const { fetchImpl } = fakeFetch([
      { ok: false, status: 500, text: 'db_pass: leaked-secret-value' },
    ]);
    await expect(
      fetchBranchDbCreds('id', {
        token: 't',
        fetchImpl,
        log: silent,
        sleepFn: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(EphemeralBranchError);
      expect((err as Error).message).not.toMatch(/leaked-secret-value/);
      return true;
    });
  });

  it('throws with only the key names (not values) when db_host/db_pass are missing', async () => {
    const { fetchImpl } = fakeFetch([
      { ok: true, json: { some_other_field: 'super-secret-should-not-leak' } },
    ]);
    await expect(
      fetchBranchDbCreds('id', { token: 't', fetchImpl, log: silent }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(EphemeralBranchError);
      const message = (err as Error).message;
      expect(message).toMatch(/some_other_field/);
      expect(message).not.toMatch(/super-secret-should-not-leak/);
      return true;
    });
  });
});

describe('fetchBranchPoolerConnection — Supavisor session-mode pooler (IPv4, unlike the direct host)', () => {
  it('GETs the config/database/pooler endpoint and extracts the PRIMARY session-mode host/port/user', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        ok: true,
        json: [
          {
            identifier: 'txn',
            database_type: 'PRIMARY',
            pool_mode: 'transaction',
            db_host: 'aws-0-us-east-1.pooler.supabase.com',
            db_port: 6543,
            db_user: 'postgres.branchref123',
            db_name: 'postgres',
          },
          {
            identifier: 'session',
            database_type: 'PRIMARY',
            pool_mode: 'session',
            db_host: 'aws-0-us-east-1.pooler.supabase.com',
            db_port: 5432,
            db_user: 'postgres.branchref123',
            db_name: 'postgres',
          },
        ],
      },
    ]);
    const pooler = await fetchBranchPoolerConnection('branchref123', {
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(pooler).toEqual({
      host: 'aws-0-us-east-1.pooler.supabase.com',
      port: 5432,
      user: 'postgres.branchref123',
    });
    expect(calls[0].url).toBe(
      'https://api.supabase.com/v1/projects/branchref123/config/database/pooler',
    );
  });

  it('falls back to the PRIMARY/transaction entry, verbatim from the API, when ephemeral branches expose no session entry', async () => {
    // Ephemeral BRANCH projects have been observed (live, run 29148230316)
    // to expose ONLY the PRIMARY/transaction pooler entry — no session-mode
    // entry at all. This must no longer throw; it must fall back and use
    // the transaction entry's host/port/user exactly as the API returned
    // them (no hand-built pooler host).
    const { fetchImpl } = fakeFetch([
      {
        ok: true,
        json: [
          {
            identifier: 'txn',
            database_type: 'PRIMARY',
            pool_mode: 'transaction',
            db_host: 'aws-0-us-east-1.pooler.supabase.com',
            db_port: 6543,
            db_user: 'postgres.branchref123',
          },
        ],
      },
    ]);
    const pooler = await fetchBranchPoolerConnection('branchref123', {
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(pooler).toEqual({
      host: 'aws-0-us-east-1.pooler.supabase.com',
      port: 6543,
      user: 'postgres.branchref123',
    });
  });

  it('prefers the session entry over the transaction entry when both are present', async () => {
    const { fetchImpl } = fakeFetch([
      {
        ok: true,
        json: [
          {
            identifier: 'txn',
            database_type: 'PRIMARY',
            pool_mode: 'transaction',
            db_host: 'txn-host.pooler.supabase.com',
            db_port: 6543,
            db_user: 'postgres.txnuser',
          },
          {
            identifier: 'session',
            database_type: 'PRIMARY',
            pool_mode: 'session',
            db_host: 'session-host.pooler.supabase.com',
            db_port: 5432,
            db_user: 'postgres.sessionuser',
          },
        ],
      },
    ]);
    const pooler = await fetchBranchPoolerConnection('branchref123', {
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(pooler).toEqual({
      host: 'session-host.pooler.supabase.com',
      port: 5432,
      user: 'postgres.sessionuser',
    });
  });

  it('throws loud, listing the actual entries, when neither a PRIMARY/session nor PRIMARY/transaction entry exists', async () => {
    const { fetchImpl } = fakeFetch([
      {
        ok: true,
        json: [
          {
            identifier: 'replica',
            database_type: 'READ_REPLICA',
            pool_mode: 'session',
            db_host: 'replica-host.pooler.supabase.com',
          },
        ],
      },
    ]);
    await expect(
      fetchBranchPoolerConnection('branchref123', {
        token: 't',
        fetchImpl,
        log: silent,
      }),
    ).rejects.toThrow(/READ_REPLICA/);
  });

  it('throws when the response is not an array', async () => {
    const { fetchImpl } = fakeFetch([{ ok: true, json: { not: 'an array' } }]);
    await expect(
      fetchBranchPoolerConnection('branchref123', {
        token: 't',
        fetchImpl,
        log: silent,
      }),
    ).rejects.toBeInstanceOf(EphemeralBranchError);
  });

  it('throws with a diagnostic key dump when the session entry is missing db_host/db_user/db_port', async () => {
    const { fetchImpl } = fakeFetch([
      {
        ok: true,
        json: [
          {
            database_type: 'PRIMARY',
            pool_mode: 'session',
            some_other_field: 'x',
          },
        ],
      },
    ]);
    await expect(
      fetchBranchPoolerConnection('branchref123', {
        token: 't',
        fetchImpl,
        log: silent,
      }),
    ).rejects.toThrow(/some_other_field/);
  });
});

describe('applyMigrationsAndSeed — explicit migrate+seed via psql (bypasses Supabase auto-replay)', () => {
  const dbCreds = { host: 'h', port: 5432, user: 'postgres', password: 'pw' };

  it('applies every migration file in sorted order, then seed.sql, and passes the DB creds as env', async () => {
    const calls: Array<{ file: string; env: NodeJS.ProcessEnv }> = [];
    const psqlExec = vi.fn((file: string, env: NodeJS.ProcessEnv) => {
      calls.push({ file, env });
      return { ok: true, stderr: '' };
    });
    const result = await applyMigrationsAndSeed({
      dbCreds,
      log: silent,
      psqlExec,
      listMigrationFiles: () => [
        'supabase/migrations/20260101_a.sql',
        'supabase/migrations/20260102_b.sql',
      ],
      seedFile: 'supabase/seed.sql',
    });
    expect(result.migrationsApplied).toBe(2);
    expect(calls.map((c) => c.file)).toEqual([
      'supabase/migrations/20260101_a.sql',
      'supabase/migrations/20260102_b.sql',
      'supabase/seed.sql',
    ]);
    expect(calls[0].env.PGHOST).toBe('h');
    expect(calls[0].env.PGPORT).toBe('5432');
    expect(calls[0].env.PGUSER).toBe('postgres');
    expect(calls[0].env.PGPASSWORD).toBe('pw');
    expect(calls[0].env.PGSSLMODE).toBe('require');
  });

  it('fails loud naming the exact file on a broken migration, and does not run later files or seed', async () => {
    const psqlExec = vi
      .fn()
      .mockReturnValueOnce({ ok: true, stderr: '' })
      .mockReturnValueOnce({
        ok: false,
        stderr: 'relation "public.change_reports" does not exist',
      });
    await expect(
      applyMigrationsAndSeed({
        dbCreds,
        log: silent,
        psqlExec,
        listMigrationFiles: () => [
          'supabase/migrations/20260617130000_squash_baseline.sql',
          'supabase/migrations/20260619120000_rls_initplan_wrap_qa.sql',
        ],
      }),
    ).rejects.toThrow(
      /20260619120000_rls_initplan_wrap_qa\.sql.*change_reports/,
    );
    expect(psqlExec).toHaveBeenCalledTimes(2); // stopped — never reached seed.sql
  });

  it('fails loud when seed.sql itself is broken', async () => {
    const psqlExec = vi
      .fn()
      .mockReturnValueOnce({ ok: true, stderr: '' })
      .mockReturnValueOnce({ ok: false, stderr: 'syntax error' });
    await expect(
      applyMigrationsAndSeed({
        dbCreds,
        log: silent,
        psqlExec,
        listMigrationFiles: () => ['supabase/migrations/20260101_a.sql'],
      }),
    ).rejects.toThrow(/seed\.sql.*syntax error/);
  });
});

describe('applyMigrationsAndSeed — real psql invocation is transaction-pooler-safe', () => {
  const dbCreds = { host: 'h', port: 6543, user: 'postgres', password: 'pw' };

  it('invokes the real psql executor with --single-transaction on every migration + seed.sql call, so replay is one transaction on one pinned backend connection', async () => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockReturnValue(Buffer.from(''));
    await applyMigrationsAndSeed({
      dbCreds,
      log: silent,
      listMigrationFiles: () => [
        'supabase/migrations/20260101_a.sql',
        'supabase/migrations/20260102_b.sql',
      ],
      seedFile: 'supabase/seed.sql',
    });
    expect(execFileSyncMock).toHaveBeenCalledTimes(3); // 2 migrations + seed.sql
    for (const call of execFileSyncMock.mock.calls) {
      const [bin, args] = call as [string, string[]];
      expect(bin).toBe('psql');
      expect(args).toContain('--single-transaction');
    }
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

describe('writeEnvVar / maskAndWriteEnvVar — $GITHUB_ENV emission ({128.10} ITERATION-5 FIX)', () => {
  // GITHUB_ENV is read directly from process.env inside writeEnvVar (mirrors
  // writeOutput's own GITHUB_OUTPUT read) — save/restore around each test so
  // this file's mutation never leaks into other tests/files.
  const withGithubEnv = (value: string | undefined, run: () => void) => {
    const prev = process.env.GITHUB_ENV;
    if (value === undefined) delete process.env.GITHUB_ENV;
    else process.env.GITHUB_ENV = value;
    try {
      run();
    } finally {
      if (prev === undefined) delete process.env.GITHUB_ENV;
      else process.env.GITHUB_ENV = prev;
    }
  };

  it('appends a delimited NAME=VALUE block to the file at $GITHUB_ENV', () => {
    const appendCalls: Array<{ path: string; content: string }> = [];
    withGithubEnv('/fake/github-env-path', () => {
      writeEnvVar('SOME_VAR', 'some-value', {
        appendToFile: (path, content) => appendCalls.push({ path, content }),
        log: silent,
      });
    });
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0].path).toBe('/fake/github-env-path');
    expect(appendCalls[0].content).toMatch(/^SOME_VAR<</);
    expect(appendCalls[0].content).toContain('some-value');
  });

  it('falls back to logging when $GITHUB_ENV is unset, rather than throwing (local-run safety net)', () => {
    const logs: string[] = [];
    withGithubEnv(undefined, () => {
      writeEnvVar('SOME_VAR', 'some-value', { log: (m) => logs.push(m) });
    });
    expect(logs).toEqual([
      '[e2e-ephemeral-branch] (no GITHUB_ENV set) SOME_VAR=some-value',
    ]);
  });

  it('prints the ::add-mask:: directive BEFORE the value is appended to the env file — never the reverse', () => {
    const order: string[] = [];
    withGithubEnv('/fake/github-env-path', () => {
      maskAndWriteEnvVar('SECRET_VAR', 'top-secret', {
        log: (m) => order.push(`log:${m}`),
        appendToFile: () => order.push('append'),
      });
    });
    expect(order).toEqual(['log:::add-mask::top-secret', 'append']);
  });
});

describe('emitBranchServiceRoleKeyToEnv — {128.10} ITERATION-5 FIX: consuming jobs fetch their own copy instead of a dropped job output', () => {
  it("fetches this branch's keys and emits ONLY the masked service-role key to $GITHUB_ENV, mask-before-value", async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        ok: true,
        json: [
          { type: 'publishable', api_key: 'pub-1' },
          { type: 'secret', api_key: 'sec-1' },
        ],
      },
    ]);
    const order: string[] = [];
    let result: { publishableKey: string; serviceRoleKey: string } | undefined;
    const prevEnv = process.env.GITHUB_ENV;
    process.env.GITHUB_ENV = '/fake/github-env-path';
    try {
      result = await emitBranchServiceRoleKeyToEnv({
        branchProjectRef: 'branchref',
        token: 't',
        fetchImpl,
        log: (m) => order.push(`log:${m}`),
        appendToFile: (_path, content) => order.push(`append:${content}`),
      });
    } finally {
      if (prevEnv === undefined) delete process.env.GITHUB_ENV;
      else process.env.GITHUB_ENV = prevEnv;
    }
    expect(result).toEqual({
      publishableKey: 'pub-1',
      serviceRoleKey: 'sec-1',
    });
    expect(calls[0].url).toBe(
      'https://api.supabase.com/v1/projects/branchref/api-keys?reveal=true',
    );
    const maskIndex = order.indexOf('log:::add-mask::sec-1');
    const appendIndex = order.findIndex((l) => l.startsWith('append:'));
    expect(maskIndex).toBeGreaterThanOrEqual(0);
    expect(appendIndex).toBeGreaterThan(maskIndex);
    expect(order[appendIndex]).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(order[appendIndex]).toContain('sec-1');
    // The publishable key is NOT emitted to env — it still flows via the
    // unaffected, unmasked `publishable-key` job output (see file header).
    expect(order.some((l) => l.includes('pub-1'))).toBe(false);
  });

  it('fails loud when branchProjectRef is missing — mirrors the CLI --branch-ref requirement', async () => {
    await expect(
      emitBranchServiceRoleKeyToEnv({
        branchProjectRef: undefined,
        token: 't',
      }),
    ).rejects.toBeInstanceOf(EphemeralBranchError);
    await expect(
      emitBranchServiceRoleKeyToEnv({
        branchProjectRef: undefined,
        token: 't',
      }),
    ).rejects.toThrow(/--branch-ref/);
  });
});

describe("mirrorBranchPostgrestConfig — {128.10} ITERATION-6 FIX: branches are born with default exposed-schemas, not the parent's", () => {
  const defaultConfig = {
    db_schema: 'public,graphql_public',
    db_extra_search_path: 'public, extensions',
    max_rows: 1000,
  };
  const mirroredConfig = {
    db_schema: 'api',
    db_extra_search_path: 'public, extensions',
    max_rows: 1000,
  };

  it('PATCHes the branch /postgrest to api-only when born with the Supabase default, keeping public in the search path, and verifies read-back', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { ok: true, json: defaultConfig }, // GET current
      { ok: true, json: mirroredConfig }, // PATCH response (read-back verify)
    ]);
    const result = await mirrorBranchPostgrestConfig({
      branchProjectRef: 'branchref',
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(result).toEqual({
      changed: true,
      before: 'public,graphql_public',
      after: 'api',
    });
    expect(calls[0].url).toBe(
      'https://api.supabase.com/v1/projects/branchref/postgrest',
    );
    expect(calls[0].init?.method).toBeUndefined(); // plain GET
    expect(calls[1].url).toBe(
      'https://api.supabase.com/v1/projects/branchref/postgrest',
    );
    expect(calls[1].init?.method).toBe('PATCH');
    const body = JSON.parse(calls[1].init?.body as string);
    expect(body.db_schema).toBe('api');
    // `public` must stay in the search path — security_invoker api.* views
    // resolve their `FROM public.<t>` base tables through it (config.toml
    // [api] extra_search_path).
    expect(body.db_extra_search_path).toContain('public');
  });

  it('is idempotent — a branch already isolated to api is a clean no-op (no PATCH issued)', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { ok: true, json: mirroredConfig },
    ]);
    const result = await mirrorBranchPostgrestConfig({
      branchProjectRef: 'branchref',
      token: 't',
      fetchImpl,
      log: silent,
    });
    expect(result.changed).toBe(false);
    expect(result.after).toBe('api');
    expect(calls).toHaveLength(1); // GET only — never PATCHed
  });

  it('routes HTTP through fetchWithRetry — a transient 503 is retried, not fatal', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { ok: false, status: 503, text: 'transient' },
      { ok: true, json: defaultConfig },
      { ok: true, json: mirroredConfig },
    ]);
    const result = await mirrorBranchPostgrestConfig({
      branchProjectRef: 'branchref',
      token: 't',
      fetchImpl,
      log: silent,
      sleepFn: vi.fn().mockResolvedValue(undefined),
    });
    expect(result.after).toBe('api');
    expect(calls).toHaveLength(3); // 503 → retried GET → PATCH
  });

  it('fails loud when the PATCH read-back does not show api (delegate verification)', async () => {
    const { fetchImpl } = fakeFetch([
      { ok: true, json: defaultConfig },
      { ok: true, json: defaultConfig }, // PATCH "succeeded" but db_schema unchanged
    ]);
    await expect(
      mirrorBranchPostgrestConfig({
        branchProjectRef: 'branchref',
        token: 't',
        fetchImpl,
        log: silent,
      }),
    ).rejects.toThrow(/expected "api"/);
  });

  it('fails loud when branchProjectRef is missing — mirrors the CLI --branch-ref requirement', async () => {
    await expect(
      mirrorBranchPostgrestConfig({ branchProjectRef: undefined, token: 't' }),
    ).rejects.toBeInstanceOf(EphemeralBranchError);
    await expect(
      mirrorBranchPostgrestConfig({ branchProjectRef: undefined, token: 't' }),
    ).rejects.toThrow(/--branch-ref/);
  });
});
