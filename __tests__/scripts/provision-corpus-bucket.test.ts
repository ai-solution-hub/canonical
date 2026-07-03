/**
 * Behaviour tests for scripts/provision-corpus-bucket.ts (TECH §3.3 T3, R(a)).
 *
 * Verifies the corpus bucket is provisioned PRIVATE and idempotently, and
 * that the env-isolation guard refuses a cross-project-ref write BEFORE any
 * Storage call — all against a mocked Supabase admin client (no live DB).
 * Mirrors test-philosophy: assert observable behaviour (bucket created vs
 * skipped, which project ref was targeted, that the guard fires first)
 * rather than internals. Mock shape mirrors
 * `__tests__/scripts/reseed-tenant-instance.test.ts` — the shared
 * `createMockSupabaseClient()` helper does not cover `storage.getBucket` /
 * `storage.createBucket`, so this hand-rolls the same minimal shape as that
 * precedent.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  provisionCorpusBucket,
  projectRefFromUrl,
  createServiceRoleClient,
  ProvisionCorpusBucketError,
  CORPUS_BUCKET,
} from '@/scripts/provision-corpus-bucket';

/**
 * Build a mocked service-role client. `bucketExists` controls getBucket;
 * `*Error` injectors drive each failure path.
 */
function mockSupabase(
  opts: {
    bucketExists?: boolean;
    getBucketError?: { message: string };
    createBucketError?: { message: string };
  } = {},
) {
  const getBucket = vi
    .fn()
    .mockResolvedValue(
      opts.bucketExists
        ? { data: { name: CORPUS_BUCKET }, error: null }
        : opts.getBucketError
          ? { data: null, error: opts.getBucketError }
          : { data: null, error: { message: 'Bucket not found' } },
    );
  const createBucket = vi
    .fn()
    .mockResolvedValue(
      opts.createBucketError
        ? { data: null, error: opts.createBucketError }
        : { data: { name: CORPUS_BUCKET }, error: null },
    );

  const client = {
    storage: { getBucket, createBucket },
  } as unknown as SupabaseClient;

  return { client, getBucket, createBucket };
}

describe('provisionCorpusBucket — happy path (fresh project)', () => {
  it('creates a private corpus bucket and reports the targeted project ref', async () => {
    const { client, createBucket } = mockSupabase({ bucketExists: false });
    const result = await provisionCorpusBucket({
      supabase: client,
      supabaseUrl: 'https://examplia-abc123.supabase.co',
      expectedProjectRef: 'examplia-abc123',
      log: () => {},
    });

    expect(result).toEqual({
      projectRef: 'examplia-abc123',
      bucketCreated: true,
    });
    expect(createBucket).toHaveBeenCalledWith(CORPUS_BUCKET, {
      public: false,
    });
  });
});

describe('provisionCorpusBucket — idempotency (already-provisioned project)', () => {
  it('skips bucket creation when the bucket already exists', async () => {
    const { client, createBucket } = mockSupabase({ bucketExists: true });
    const result = await provisionCorpusBucket({
      supabase: client,
      supabaseUrl: 'https://examplia-abc123.supabase.co',
      expectedProjectRef: 'examplia-abc123',
      log: () => {},
    });
    expect(result.bucketCreated).toBe(false);
    expect(createBucket).not.toHaveBeenCalled();
  });
});

describe('provisionCorpusBucket — env-isolation guard (cross-tenant write refusal)', () => {
  it('refuses before any Storage call when the URL resolves to a different project ref', async () => {
    const { client, getBucket, createBucket } = mockSupabase({
      bucketExists: false,
    });
    await expect(
      provisionCorpusBucket({
        supabase: client,
        supabaseUrl: 'https://other-client-xyz.supabase.co',
        expectedProjectRef: 'examplia-abc123',
        log: () => {},
      }),
    ).rejects.toThrow(ProvisionCorpusBucketError);
    // The guard must fire BEFORE touching Storage — a cross-tenant write
    // cannot land even if the mismatched client would have succeeded.
    expect(getBucket).not.toHaveBeenCalled();
    expect(createBucket).not.toHaveBeenCalled();
  });
});

describe('provisionCorpusBucket — fail-loud (never silent)', () => {
  it('throws when getBucket returns a non-not-found error', async () => {
    const { client } = mockSupabase({
      getBucketError: { message: 'service unavailable' },
    });
    await expect(
      provisionCorpusBucket({
        supabase: client,
        supabaseUrl: 'https://examplia-abc123.supabase.co',
        expectedProjectRef: 'examplia-abc123',
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(ProvisionCorpusBucketError);
  });

  it('throws when createBucket errors', async () => {
    const { client } = mockSupabase({
      bucketExists: false,
      createBucketError: { message: 'quota exceeded' },
    });
    await expect(
      provisionCorpusBucket({
        supabase: client,
        supabaseUrl: 'https://examplia-abc123.supabase.co',
        expectedProjectRef: 'examplia-abc123',
        log: () => {},
      }),
    ).rejects.toThrow(/quota exceeded/);
  });
});

describe('projectRefFromUrl', () => {
  it('extracts the first host label as the project ref', () => {
    expect(projectRefFromUrl('https://abcd1234.supabase.co')).toBe('abcd1234');
  });

  it('returns an unparseable-URL marker for a malformed URL', () => {
    expect(projectRefFromUrl('not-a-url')).toBe('(unparseable SUPABASE_URL)');
  });
});

describe('createServiceRoleClient — service-role-only credential posture', () => {
  it('throws when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    const prevUrl = process.env.SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = 'https://examplia-abc123.supabase.co';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(() => createServiceRoleClient()).toThrow(
        ProvisionCorpusBucketError,
      );
    } finally {
      if (prevUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = prevUrl;
      if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    }
  });
});
