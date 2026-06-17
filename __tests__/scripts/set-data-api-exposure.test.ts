import { describe, it, expect } from 'vitest';
import {
  setDataApiExposure,
  DataApiExposureError,
  type PostgrestConfig,
} from '@/scripts/set-data-api-exposure';

interface FakeResponse {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
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
      text: async () => r.text ?? '',
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const cfg = (
  db_schema: string,
  search = 'public,extensions',
): PostgrestConfig => ({
  db_schema,
  db_extra_search_path: search,
  max_rows: 1000,
});

const silent = () => {};

describe('setDataApiExposure', () => {
  it('dry-run reports the planned flip without PATCHing', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { ok: true, json: cfg('public,graphql_public,api') },
    ]);
    const res = await setDataApiExposure({
      ref: 'proj1',
      token: 't',
      apply: false,
      fetchImpl,
      log: silent,
    });
    expect(res).toEqual({
      changed: false,
      before: 'public,graphql_public,api',
      after: 'api',
    });
    // GET only — no PATCH in dry-run.
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method ?? 'GET').toBe('GET');
  });

  it('--apply sends the correct PATCH and confirms the new schema', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { ok: true, json: cfg('public,graphql_public,api') },
      { ok: true, json: cfg('api') },
    ]);
    const res = await setDataApiExposure({
      ref: 'proj1',
      token: 'secret-token',
      apply: true,
      fetchImpl,
      log: silent,
    });
    expect(res.changed).toBe(true);
    expect(res.after).toBe('api');
    expect(calls).toHaveLength(2);
    const patch = calls[1];
    expect(patch.url).toBe(
      'https://api.supabase.com/v1/projects/proj1/postgrest',
    );
    expect(patch.init?.method).toBe('PATCH');
    expect((patch.init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret-token',
    );
    expect(JSON.parse(patch.init?.body as string)).toEqual({
      db_schema: 'api',
      db_extra_search_path: 'public,extensions',
    });
  });

  it('is idempotent — already-isolated project is never PATCHed even with --apply', async () => {
    const { fetchImpl, calls } = fakeFetch([{ ok: true, json: cfg('api') }]);
    const res = await setDataApiExposure({
      ref: 'proj1',
      token: 't',
      apply: true,
      fetchImpl,
      log: silent,
    });
    expect(res.changed).toBe(false);
    expect(calls).toHaveLength(1); // GET only, no PATCH
  });

  it('preserves a non-default extra_search_path that still includes public', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { ok: true, json: cfg('public,api', 'public,extensions,graphql') },
      { ok: true, json: cfg('api', 'public,extensions,graphql') },
    ]);
    await setDataApiExposure({
      ref: 'proj1',
      token: 't',
      apply: true,
      fetchImpl,
      log: silent,
    });
    expect(JSON.parse(calls[1].init?.body as string).db_extra_search_path).toBe(
      'public,extensions,graphql',
    );
  });

  it('fails loud when the GET errors', async () => {
    const { fetchImpl } = fakeFetch([
      { ok: false, status: 401, text: 'unauthorized' },
    ]);
    await expect(
      setDataApiExposure({
        ref: 'proj1',
        token: 'bad',
        apply: false,
        fetchImpl,
        log: silent,
      }),
    ).rejects.toBeInstanceOf(DataApiExposureError);
  });

  it('fails loud when the PATCH errors', async () => {
    const { fetchImpl } = fakeFetch([
      { ok: true, json: cfg('public,graphql_public,api') },
      { ok: false, status: 500, text: 'boom' },
    ]);
    await expect(
      setDataApiExposure({
        ref: 'proj1',
        token: 't',
        apply: true,
        fetchImpl,
        log: silent,
      }),
    ).rejects.toBeInstanceOf(DataApiExposureError);
  });

  it('fails loud when the PATCH succeeds but does not land "api"', async () => {
    const { fetchImpl } = fakeFetch([
      { ok: true, json: cfg('public,graphql_public,api') },
      { ok: true, json: cfg('public,api') }, // server did not narrow as expected
    ]);
    await expect(
      setDataApiExposure({
        ref: 'proj1',
        token: 't',
        apply: true,
        fetchImpl,
        log: silent,
      }),
    ).rejects.toBeInstanceOf(DataApiExposureError);
  });
});
