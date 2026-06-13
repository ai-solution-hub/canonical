/**
 * Behaviour tests for scripts/reseed-tenant-instance.ts (TECH §T-C, PI-20).
 *
 * Verifies the re-seed manifest upserts signup_policy + tenant_config, ensures
 * the private `branding` bucket, uploads each asset, and is idempotent on a
 * re-run — all against a mocked Supabase admin client (no live DB). Mirrors
 * test-philosophy: assert observable behaviour (which upserts ran, bucket
 * created vs skipped, asset count) rather than internals.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reseedTenantInstance,
  ReseedTenantInstanceError,
  type ReseedManifest,
} from '@/scripts/reseed-tenant-instance';

function manifest(overrides: Partial<ReseedManifest> = {}): ReseedManifest {
  return {
    clientId: 'examplia',
    allowedDomain: 'examplia.test',
    config: { clientId: 'examplia', productName: 'Examplia' },
    assets: [
      { name: 'logo.webp', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'favicon.png', bytes: new Uint8Array([4, 5]) },
    ],
    ...overrides,
  };
}

/**
 * Build a mocked service-role client. `bucketExists` controls getBucket;
 * `*Error` injectors drive each failure path.
 */
function mockSupabase(
  opts: {
    bucketExists?: boolean;
    signupError?: { message: string };
    configError?: { message: string };
    uploadError?: { message: string };
    getBucketError?: { message: string };
    createBucketError?: { message: string };
  } = {},
) {
  const fromCalls: { table: string; rows: unknown; options: unknown }[] = [];
  const upload = vi
    .fn()
    .mockResolvedValue(
      opts.uploadError
        ? { data: null, error: opts.uploadError }
        : { data: { path: 'p' }, error: null },
    );

  const from = vi.fn((table: string) => ({
    upsert: vi.fn((rows: unknown, options: unknown) => {
      fromCalls.push({ table, rows, options });
      const error =
        table === 'signup_policy'
          ? (opts.signupError ?? null)
          : table === 'tenant_config'
            ? (opts.configError ?? null)
            : null;
      return Promise.resolve({ data: null, error });
    }),
  }));

  const getBucket = vi
    .fn()
    .mockResolvedValue(
      opts.bucketExists
        ? { data: { name: 'branding' }, error: null }
        : opts.getBucketError
          ? { data: null, error: opts.getBucketError }
          : { data: null, error: { message: 'Bucket not found' } },
    );
  const createBucket = vi
    .fn()
    .mockResolvedValue(
      opts.createBucketError
        ? { data: null, error: opts.createBucketError }
        : { data: { name: 'branding' }, error: null },
    );

  const client = {
    from,
    storage: {
      getBucket,
      createBucket,
      from: vi.fn().mockReturnValue({ upload }),
    },
  } as unknown as SupabaseClient;

  return { client, fromCalls, getBucket, createBucket, upload };
}

describe('reseedTenantInstance — happy path (fresh project)', () => {
  it('upserts both config rows, creates the bucket, and uploads every asset', async () => {
    const { client, fromCalls, createBucket, upload } = mockSupabase({
      bucketExists: false,
    });
    const result = await reseedTenantInstance({
      supabase: client,
      manifest: manifest(),
      log: () => {},
    });

    expect(result).toEqual({
      signupPolicyUpserted: true,
      tenantConfigUpserted: true,
      bucketCreated: true,
      assetsUploaded: 2,
    });
    // signup_policy upsert keyed on id with the allowed domain.
    const signup = fromCalls.find((c) => c.table === 'signup_policy');
    expect(signup?.rows).toMatchObject({
      id: true,
      allowed_domain: 'examplia.test',
    });
    expect(signup?.options).toMatchObject({ onConflict: 'id' });
    // tenant_config upsert carries the config document + a bumped updated_at.
    const config = fromCalls.find((c) => c.table === 'tenant_config');
    expect(config?.rows).toMatchObject({
      id: true,
      config: { clientId: 'examplia' },
    });
    expect((config?.rows as { updated_at?: string }).updated_at).toBeTypeOf(
      'string',
    );
    expect(createBucket).toHaveBeenCalledWith('branding', { public: false });
    expect(upload).toHaveBeenCalledTimes(2);
  });
});

describe('reseedTenantInstance — idempotency (already-seeded project)', () => {
  it('skips bucket creation when the bucket already exists but still upserts', async () => {
    const { client, createBucket, upload } = mockSupabase({
      bucketExists: true,
    });
    const result = await reseedTenantInstance({
      supabase: client,
      manifest: manifest(),
      log: () => {},
    });
    expect(result.bucketCreated).toBe(false);
    expect(result.assetsUploaded).toBe(2);
    expect(createBucket).not.toHaveBeenCalled();
    // upserts (not inserts) + upsert-true uploads → re-run is clean.
    expect(upload).toHaveBeenCalledTimes(2);
  });
});

describe('reseedTenantInstance — fail-loud (never silent)', () => {
  it('throws when the signup_policy upsert errors', async () => {
    const { client } = mockSupabase({
      signupError: { message: 'permission denied' },
    });
    await expect(
      reseedTenantInstance({
        supabase: client,
        manifest: manifest(),
        log: () => {},
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it('throws when the tenant_config upsert errors', async () => {
    const { client } = mockSupabase({
      configError: { message: 'check violation' },
    });
    await expect(
      reseedTenantInstance({
        supabase: client,
        manifest: manifest(),
        log: () => {},
      }),
    ).rejects.toThrow(/check violation/);
  });

  it('throws when an asset upload errors', async () => {
    const { client } = mockSupabase({
      bucketExists: true,
      uploadError: { message: 'quota exceeded' },
    });
    await expect(
      reseedTenantInstance({
        supabase: client,
        manifest: manifest(),
        log: () => {},
      }),
    ).rejects.toThrow(/quota exceeded/);
  });

  it('throws when getBucket returns a non-not-found error', async () => {
    const { client } = mockSupabase({
      getBucketError: { message: 'service unavailable' },
    });
    await expect(
      reseedTenantInstance({
        supabase: client,
        manifest: manifest(),
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(ReseedTenantInstanceError);
  });
});
