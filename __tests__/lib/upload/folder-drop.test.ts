// __tests__/lib/upload/folder-drop.test.ts
/**
 * Unit tests for the folder-drop upload admission client ({56.12} origin,
 * ID-138 {138.13} T2 RE-POINT).
 *
 * DR-020 retires the `/stage` + `/walk` HTTP transport (confirmed broken
 * from Vercel). `stageAndWalk` now does ONE fenced flow: gate-pass ->
 * Storage PUT into the `corpus` bucket at `object_key = destPath` -> an
 * admission-minted `source_documents` row via the M2
 * `resolve_or_mint_source_identity` resolver (content_hash-first, R(id)).
 *
 * Covers the load-bearing contracts (TECH §4 testStrategy):
 *  - destPath is corpus-relative + consumed verbatim (INV-1); absolute / `..`
 *    escape rejected BEFORE any Storage/DB call.
 *  - a gate-passed upload PUTs bytes to `corpus` AND inserts/resolves a
 *    `source_documents` row with retention_class='keep_and_watch'.
 *  - re-upload of the SAME bytes is idempotent (resolver returns the SAME id,
 *    `wasMinted: false`).
 *  - the whole PUT+identity critical section is fenced (`withWriterFence`).
 *  - no silent failure: every leg that fails throws a typed `FolderDropError`
 *    carrying the failing stage; a missing corpus bucket FAILS LOUDLY (no
 *    graceful DB-only fallback — contrast write-back.ts).
 *  - NO /stage or /walk network transport remains (mocked global `fetch` is
 *    never called for the admission itself).
 *
 * Mock discipline: `createMockSupabaseClient()` from the shared helper
 * (`__tests__/helpers/mock-supabase.ts`) — the Storage leg + the writer-fence
 * RPC + the identity RPC are all mocked. No real filesystem or network I/O.
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

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

// {138.13}: `stageAndWalk` creates an internal service-role client when the
// caller omits `supabase` (the lib/mcp/tools/content.ts back-compat path,
// out-of-boundary per the module header). Mock `createServiceClient` to hand
// back a mutable ref so a dedicated test can point it at a mock client
// WITHOUT any real network/env dependency.
const serviceClientRef = vi.hoisted<{ current: unknown }>(() => ({
  current: undefined,
}));
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => serviceClientRef.current,
}));

import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import {
  assertCorpusRelativeDestPath,
  FolderDropError,
  stageAndWalk,
} from '@/lib/upload/folder-drop';
import { CORPUS_BUCKET } from '@/lib/edit-intent/write-back';

const SOURCE_DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';

/** The shape `createMockSupabaseClient()` wires `storage.from()` to resolve to. */
function bucket(client: MockSupabaseClient) {
  const from = client.storage.from as unknown as (name: string) => {
    upload: ReturnType<typeof vi.fn>;
    download: ReturnType<typeof vi.fn>;
  };
  return from(CORPUS_BUCKET);
}

describe('assertCorpusRelativeDestPath', () => {
  it('returns a valid relative path verbatim (INV-1, no re-normalisation)', () => {
    expect(assertCorpusRelativeDestPath('uploads/My File.pdf')).toBe(
      'uploads/My File.pdf',
    );
    expect(assertCorpusRelativeDestPath('a/./b.md')).toBe('a/./b.md');
  });

  it('rejects an absolute destPath with a destPath-stage error', () => {
    expect(() => assertCorpusRelativeDestPath('/etc/passwd')).toThrow(
      FolderDropError,
    );
    try {
      assertCorpusRelativeDestPath('/abs.pdf');
    } catch (e) {
      expect((e as FolderDropError).stage).toBe('destPath');
    }
  });

  it('rejects a `..`-escaping destPath', () => {
    expect(() => assertCorpusRelativeDestPath('../../secret.pdf')).toThrow(
      /escape the corpus root/,
    );
  });

  it('rejects an empty destPath', () => {
    expect(() => assertCorpusRelativeDestPath('')).toThrow(FolderDropError);
  });
});

describe('stageAndWalk', () => {
  let mockSupabase: MockSupabaseClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  const input = {
    bytes: new Uint8Array([1, 2, 3]),
    filename: 'report.pdf',
    destPath: 'uploads/report.pdf',
    titlePrefix: 'Q3',
    contentType: 'application/pdf',
  };

  beforeEach(() => {
    serviceClientRef.current = undefined;
    mockSupabase = createMockSupabaseClient();
    // Fence acquire/release both resolve true by default.
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === 'resolve_or_mint_source_identity') {
        return Promise.resolve({
          data: [{ source_document_id: SOURCE_DOCUMENT_ID, was_minted: true }],
          error: null,
        });
      }
      // corpus_writer_fence_lease_acquire / _release
      return Promise.resolve({ data: true, error: null });
    });
    bucket(mockSupabase).upload.mockResolvedValue({
      data: { path: input.destPath },
      error: null,
    });

    // No /stage or /walk transport remains — fail loudly if anything calls
    // out to the network, so a regression that resurrects the old worker
    // hop is caught immediately.
    fetchMock = vi
      .fn()
      .mockRejectedValue(new Error('fetch must not be called'));
    vi.stubGlobal('fetch', fetchMock);

    loggerMocks.warn.mockClear();
    loggerMocks.info.mockClear();
    loggerMocks.error.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function asClient(): Parameters<typeof stageAndWalk>[0]['supabase'] {
    return mockSupabase as unknown as Parameters<
      typeof stageAndWalk
    >[0]['supabase'];
  }

  it('PUTs bytes to corpus at object_key = destPath and mints a source_documents row (keep_and_watch)', async () => {
    const result = await stageAndWalk({ ...input, supabase: asClient() });

    expect(mockSupabase.storage.from).toHaveBeenCalledWith(CORPUS_BUCKET);
    expect(bucket(mockSupabase).upload).toHaveBeenCalledWith(
      input.destPath,
      expect.anything(),
      expect.objectContaining({ upsert: true, contentType: 'application/pdf' }),
    );
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'resolve_or_mint_source_identity',
      expect.objectContaining({
        p_rel_path: input.destPath,
        p_filename: input.filename,
        p_retention_class: 'keep_and_watch',
      }),
    );
    expect(result.sourceDocumentId).toBe(SOURCE_DOCUMENT_ID);
    expect(result.destPath).toBe(input.destPath);
    expect(result.sourceFile).toBe('report.pdf');
    expect(result.wasMinted).toBe(true);
    // No /stage or /walk network hop for the admission itself.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('computes the content_hash as sha256 of the exact bytes (SEED-CONTRACT match with flow.py)', async () => {
    await stageAndWalk({ ...input, supabase: asClient() });
    const expectedHash = createHash('sha256').update(input.bytes).digest('hex');
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'resolve_or_mint_source_identity',
      expect.objectContaining({ p_content_hash: expectedHash }),
    );
  });

  // ID-131.24 (G-UPLOAD-GATE, DR-025): the binding-admission gate assigns a
  // caller-supplied retention_class instead of always hard-coding
  // keep_and_watch — the app-side upload path (rebound onto this leg) lets
  // an editor pick keep_and_watch vs ingest_once at admission time.
  it('passes a caller-supplied retentionClass through to the identity resolver', async () => {
    await stageAndWalk({
      ...input,
      retentionClass: 'ingest_once',
      supabase: asClient(),
    });
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'resolve_or_mint_source_identity',
      expect.objectContaining({ p_retention_class: 'ingest_once' }),
    );
  });

  it('defaults retentionClass to keep_and_watch when the caller omits it', async () => {
    await stageAndWalk({ ...input, supabase: asClient() });
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'resolve_or_mint_source_identity',
      expect.objectContaining({ p_retention_class: 'keep_and_watch' }),
    );
  });

  it('acquires and releases the writer fence around the PUT+identity critical section', async () => {
    await stageAndWalk({ ...input, supabase: asClient() });
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'corpus_writer_fence_lease_acquire',
      expect.objectContaining({ p_holder: 'upload' }),
    );
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'corpus_writer_fence_lease_release',
      expect.objectContaining({ p_holder: 'upload' }),
    );
  });

  it('is idempotent: re-upload of the same bytes resolves to the SAME id with wasMinted:false', async () => {
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === 'resolve_or_mint_source_identity') {
        return Promise.resolve({
          data: [{ source_document_id: SOURCE_DOCUMENT_ID, was_minted: false }],
          error: null,
        });
      }
      return Promise.resolve({ data: true, error: null });
    });

    const result = await stageAndWalk({ ...input, supabase: asClient() });
    expect(result.sourceDocumentId).toBe(SOURCE_DOCUMENT_ID);
    expect(result.wasMinted).toBe(false);
  });

  it('throws a put-stage error when the Storage PUT fails, and NEVER calls the identity RPC', async () => {
    bucket(mockSupabase).upload.mockResolvedValueOnce({
      data: null,
      error: { message: 'network error' },
    });

    let err: FolderDropError | undefined;
    try {
      await stageAndWalk({ ...input, supabase: asClient() });
    } catch (e) {
      err = e as FolderDropError;
    }
    expect(err?.stage).toBe('put');
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
      'resolve_or_mint_source_identity',
      expect.anything(),
    );
  });

  it('FAILS LOUDLY (no DB-only fallback) when the corpus bucket is not provisioned', async () => {
    bucket(mockSupabase).upload.mockResolvedValueOnce({
      data: null,
      error: { message: 'Bucket not found' },
    });

    let err: FolderDropError | undefined;
    try {
      await stageAndWalk({ ...input, supabase: asClient() });
    } catch (e) {
      err = e as FolderDropError;
    }
    expect(err).toBeInstanceOf(FolderDropError);
    expect(err?.stage).toBe('put');
    expect(err?.message).toMatch(/not provisioned/);
    // No source_documents mint was attempted once the bucket write failed.
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
      'resolve_or_mint_source_identity',
      expect.anything(),
    );
  });

  it('throws an identity-stage error when the resolver RPC fails after a successful PUT', async () => {
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === 'resolve_or_mint_source_identity') {
        return Promise.resolve({
          data: null,
          error: { message: 'db error', code: '500' },
        });
      }
      return Promise.resolve({ data: true, error: null });
    });

    let err: FolderDropError | undefined;
    try {
      await stageAndWalk({ ...input, supabase: asClient() });
    } catch (e) {
      err = e as FolderDropError;
    }
    expect(err?.stage).toBe('identity');
    // The bytes DID land — this leg documents the residual orphan-object
    // risk (matches write-back.ts's own accepted residual-risk framing).
    expect(bucket(mockSupabase).upload).toHaveBeenCalled();
  });

  it('throws a fence-stage error when the writer fence is busy', async () => {
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === 'corpus_writer_fence_lease_acquire') {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });

    let err: FolderDropError | undefined;
    try {
      await stageAndWalk({ ...input, supabase: asClient() });
    } catch (e) {
      err = e as FolderDropError;
    }
    expect(err?.stage).toBe('fence');
    expect(bucket(mockSupabase).upload).not.toHaveBeenCalled();
  });

  it('rejects an absolute destPath before any Storage/DB call', async () => {
    await expect(
      stageAndWalk({ ...input, destPath: '/abs.pdf', supabase: asClient() }),
    ).rejects.toMatchObject({ stage: 'destPath' });
    expect(bucket(mockSupabase).upload).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('falls back to an internal service-role client when supabase is omitted (back-compat, e.g. lib/mcp/tools/content.ts)', async () => {
    // No `supabase` field on the input — this is exactly the
    // lib/mcp/tools/content.ts call shape (out-of-boundary per the module
    // header). `createServiceClient` is mocked to hand back the SAME mock
    // client so the omitted-client path is provably wired, with no real
    // env/network dependency.
    serviceClientRef.current = mockSupabase;

    const result = await stageAndWalk({
      ...input,
      destPath: 'agent-create/no-client.md',
    });

    expect(result.sourceDocumentId).toBe(SOURCE_DOCUMENT_ID);
    expect(bucket(mockSupabase).upload).toHaveBeenCalledWith(
      'agent-create/no-client.md',
      expect.anything(),
      expect.anything(),
    );
  });

  describe('re-walk nudge (mirrors write-back.ts nudgeCorpusRewalk; ID-127.18 — legacy CRON_SECRET fallback retired per PLAN §6 step 6 / S457)', () => {
    afterEach(() => {
      delete process.env.COCOINDEX_WORKER_URL;
      delete process.env.PIPELINE_TRIGGER_SECRET;
      delete process.env.CRON_SECRET;
    });

    it('fires a POST to {COCOINDEX_WORKER_URL}/walk on the happy path when configured', async () => {
      process.env.COCOINDEX_WORKER_URL = 'https://worker.example.test';
      process.env.PIPELINE_TRIGGER_SECRET = 'test-pipeline-trigger-secret';
      fetchMock.mockResolvedValueOnce({ ok: true, status: 202 } as Response);

      await stageAndWalk({ ...input, supabase: asClient() });

      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://worker.example.test/walk',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer test-pipeline-trigger-secret' },
        }),
      );
    });

    it('ID-127.18 RETIRED FALLBACK: ignores the legacy CRON_SECRET even when it is also set', async () => {
      process.env.COCOINDEX_WORKER_URL = 'https://worker.example.test';
      process.env.PIPELINE_TRIGGER_SECRET = 'new-pipeline-trigger-secret';
      process.env.CRON_SECRET = 'legacy-shared-secret';
      fetchMock.mockResolvedValueOnce({ ok: true, status: 202 } as Response);

      await stageAndWalk({ ...input, supabase: asClient() });

      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://worker.example.test/walk',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer new-pipeline-trigger-secret' },
        }),
      );
    });

    it('ID-127.18 RETIRED FALLBACK: skips the nudge when only the legacy CRON_SECRET is set (PIPELINE_TRIGGER_SECRET unset)', async () => {
      process.env.COCOINDEX_WORKER_URL = 'https://worker.example.test';
      delete process.env.PIPELINE_TRIGGER_SECRET;
      process.env.CRON_SECRET = 'legacy-shared-secret';

      await stageAndWalk({ ...input, supabase: asClient() });

      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ objectKey: input.destPath }),
        expect.stringContaining('PIPELINE_TRIGGER_SECRET unset'),
      );
    });

    it('ID-127.18: skips the nudge with a structured log when PIPELINE_TRIGGER_SECRET is unset', async () => {
      process.env.COCOINDEX_WORKER_URL = 'https://worker.example.test';
      delete process.env.PIPELINE_TRIGGER_SECRET;
      delete process.env.CRON_SECRET;

      await stageAndWalk({ ...input, supabase: asClient() });

      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ objectKey: input.destPath }),
        expect.stringContaining('PIPELINE_TRIGGER_SECRET unset'),
      );
    });

    it('skips gracefully (no throw) when COCOINDEX_WORKER_URL is unset', async () => {
      delete process.env.COCOINDEX_WORKER_URL;

      const result = await stageAndWalk({ ...input, supabase: asClient() });

      expect(result.sourceDocumentId).toBe(SOURCE_DOCUMENT_ID);
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ objectKey: input.destPath }),
        expect.stringContaining('COCOINDEX_WORKER_URL unset'),
      );
    });
  });
});
