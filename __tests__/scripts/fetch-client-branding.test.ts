/**
 * Behaviour tests for scripts/fetch-client-branding.ts (TECH §T-B, PI-11).
 *
 * Verifies the two fail-closed branches and the happy path of the build-time
 * branding fetch, exercising the injectable `runClientBrandingFetch` core with
 * a mocked Supabase client (no live DB, no disk). Mirrors test-philosophy:
 * assert observable behaviour (no-op vs throw vs files written), not internals.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  runClientBrandingFetch,
  FetchClientBrandingError,
  type BrandingWriters,
  type FetchClientBrandingDeps,
} from '@/scripts/fetch-client-branding';

/** A BrandingConfigSchema-valid document (mirrors lib/branding/clients/default.json). */
function validBrandingConfig(clientId = 'examplia') {
  return {
    clientId,
    productName: 'Examplia Knowledge Hub',
    productShortName: 'Examplia',
    organisationName: 'Examplia Limited',
    tagline: 'Knowledge base platform for bid management',
    supportEmail: 'support@knowledgehub.dev',
    brandPrimaryColour: 'oklch(0.65 0.16 55)',
    logoUrl: '/favicon.svg',
    logoAlt: 'Examplia logo',
    faviconSvgUrl: '/favicon.svg',
    faviconPngUrl: '/favicon.png',
  };
}

/** Recording fake writers — assert what would land on disk without touching it. */
function recordingWriters(): BrandingWriters & {
  json: { clientId: string; json: string }[];
  assets: { clientId: string; assetName: string; size: number }[];
} {
  const json: { clientId: string; json: string }[] = [];
  const assets: { clientId: string; assetName: string; size: number }[] = [];
  return {
    json,
    assets,
    async writeBrandingJson(clientId, body) {
      json.push({ clientId, json: body });
    },
    async writeAsset(clientId, assetName, bytes) {
      assets.push({ clientId, assetName, size: bytes.byteLength });
    },
  };
}

/**
 * Build a mocked service-role client. `config` drives the tenant_config row
 * (undefined → no row); `objects` drives the branding bucket listing.
 */
function mockSupabase(opts: {
  config?: unknown;
  rowError?: { message: string };
  objects?: { name: string }[];
  listError?: { message: string };
  downloadError?: { message: string };
}): SupabaseClient {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue(
      opts.rowError
        ? { data: null, error: opts.rowError }
        : opts.config === undefined
          ? { data: null, error: null }
          : { data: { config: opts.config }, error: null },
    );
  const chain = {
    select: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle,
  };
  const bucket = {
    list: vi
      .fn()
      .mockResolvedValue(
        opts.listError
          ? { data: null, error: opts.listError }
          : { data: opts.objects ?? [], error: null },
      ),
    download: vi
      .fn()
      .mockResolvedValue(
        opts.downloadError
          ? { data: null, error: opts.downloadError }
          : { data: new Blob([new Uint8Array([1, 2, 3, 4])]), error: null },
      ),
  };
  return {
    from: vi.fn().mockReturnValue(chain),
    storage: { from: vi.fn().mockReturnValue(bucket) },
  } as unknown as SupabaseClient;
}

function baseDeps(
  env: Partial<FetchClientBrandingDeps['env']>,
  supabase: SupabaseClient,
  writers: BrandingWriters,
): FetchClientBrandingDeps {
  return {
    env: {
      clientId: undefined,
      supabaseUrl: undefined,
      serviceRoleKey: undefined,
      ...env,
    },
    createSupabaseClient: () => supabase,
    writers,
    log: () => {},
  };
}

describe('runClientBrandingFetch — CASE 1 (control build, no-op)', () => {
  it('no-ops on the default client and writes nothing', async () => {
    const writers = recordingWriters();
    const supabase = mockSupabase({});
    const result = await runClientBrandingFetch(
      baseDeps(
        {
          clientId: 'default',
          supabaseUrl: 'https://x.supabase.co',
          serviceRoleKey: 'k',
        },
        supabase,
        writers,
      ),
    );
    expect(result).toEqual({ status: 'noop', reason: 'default-client' });
    expect(writers.json).toHaveLength(0);
    expect(writers.assets).toHaveLength(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('no-ops (does NOT throw) for a real client when credentials are absent', async () => {
    const writers = recordingWriters();
    const supabase = mockSupabase({});
    const result = await runClientBrandingFetch(
      baseDeps(
        {
          clientId: 'examplia',
          supabaseUrl: undefined,
          serviceRoleKey: undefined,
        },
        supabase,
        writers,
      ),
    );
    expect(result).toEqual({ status: 'noop', reason: 'missing-credentials' });
    expect(writers.json).toHaveLength(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe('runClientBrandingFetch — CASE 2 fail-closed (client build, must throw)', () => {
  const clientEnv = {
    clientId: 'examplia',
    supabaseUrl: 'https://x.supabase.co',
    serviceRoleKey: 'service-role-key',
  };

  it('throws when there is no tenant_config row', async () => {
    const writers = recordingWriters();
    const supabase = mockSupabase({ config: undefined });
    await expect(
      runClientBrandingFetch(baseDeps(clientEnv, supabase, writers)),
    ).rejects.toBeInstanceOf(FetchClientBrandingError);
    expect(writers.json).toHaveLength(0);
  });

  it('throws when the tenant_config read errors', async () => {
    const writers = recordingWriters();
    const supabase = mockSupabase({
      rowError: { message: 'permission denied' },
    });
    await expect(
      runClientBrandingFetch(baseDeps(clientEnv, supabase, writers)),
    ).rejects.toThrow(/permission denied/);
    expect(writers.json).toHaveLength(0);
  });

  it('throws when the config document fails schema validation', async () => {
    const writers = recordingWriters();
    const supabase = mockSupabase({ config: { clientId: 'examplia' } }); // missing required fields
    await expect(
      runClientBrandingFetch(baseDeps(clientEnv, supabase, writers)),
    ).rejects.toBeInstanceOf(FetchClientBrandingError);
    expect(writers.json).toHaveLength(0);
  });

  it('throws when an asset download errors (no silent skip)', async () => {
    const writers = recordingWriters();
    const supabase = mockSupabase({
      config: validBrandingConfig(),
      objects: [{ name: 'logo.webp' }],
      downloadError: { message: 'object not found' },
    });
    await expect(
      runClientBrandingFetch(baseDeps(clientEnv, supabase, writers)),
    ).rejects.toThrow(/object not found/);
  });
});

describe('runClientBrandingFetch — happy path (client build, writes files)', () => {
  it('writes the validated config JSON and downloads each bucket asset', async () => {
    const writers = recordingWriters();
    const supabase = mockSupabase({
      config: validBrandingConfig(),
      objects: [{ name: 'logo.webp' }, { name: 'favicon.png' }],
    });
    const result = await runClientBrandingFetch(
      baseDeps(
        {
          clientId: 'examplia',
          supabaseUrl: 'https://x.supabase.co',
          serviceRoleKey: 'service-role-key',
        },
        supabase,
        writers,
      ),
    );
    expect(result).toEqual({
      status: 'written',
      clientId: 'examplia',
      assetCount: 2,
    });
    expect(writers.json).toHaveLength(1);
    expect(writers.json[0].clientId).toBe('examplia');
    // Document is written verbatim-validated: re-parse round-trips.
    expect(JSON.parse(writers.json[0].json).productShortName).toBe('Examplia');
    expect(writers.assets.map((a) => a.assetName).sort()).toEqual([
      'favicon.png',
      'logo.webp',
    ]);
    expect(writers.assets.every((a) => a.size === 4)).toBe(true);
  });
});
