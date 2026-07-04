/**
 * {59.9} — file-first write-back adapter with compensating restore.
 * {59.10} — source-less content_item GUARD (bl-266).
 * {138.12} T1 — RE-POINT: the file leg now PUTs bytes into the `corpus`
 * Supabase Storage bucket at `object_key = storage_path` (TECH §3.3 T1, §2.1
 * R(a)) instead of rewriting a `COCOINDEX_SOURCE_PATH`-joined file on disk.
 *
 * Mock discipline: `createMockSupabaseClient()` from the shared helper
 * (`__tests__/helpers/mock-supabase.ts`) — the Storage leg + the writer-fence
 * RPC are both mocked (behaviour-first; the fence's own RPCs are authored but
 * not yet applied to staging, per {138.9}/{138.12} brief). No real filesystem
 * or network I/O.
 *
 * The {59.9}/{138.12} testStrategy proofs:
 *   1. file-backed edit -> Storage PUT at the SAME object key (NOT the VPS
 *      volume) + DB leg applied + the re-walk nudge fires;
 *   2. force the PUT to fail -> DB leg NEVER invoked (one failure state);
 *   3. force DB-write fail AFTER a successful PUT -> the object is RESTORED
 *      to its prior bytes (compensating-restore proof), fenced;
 *   4. the corpus bucket not provisioned in this project (Storage-leg
 *      idle-mode equivalent) -> DB-only, `fileBacked: false`, no PUT attempted;
 *   5. the writer-fence busy -> aborts before the DB leg (a second failure
 *      mode with the same one-failure-state guarantee);
 *   6. the re-walk nudge does NOT fire on the DB-failure/restore path.
 *
 * The {59.10} testStrategy proof (PC-3 / INV-3):
 *   source_document_id IS NULL -> NO Storage PUT, NO source_document created,
 *   NO connector='mcp' mint; `source_less_content_item_edit_back` anomaly log
 *   emitted; the DB leg (content_items + content_history WITH edit_intent)
 *   STILL runs. Source-backed item -> object written normally (guard passes).
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import {
  CorpusBucketUnavailableError,
  writeBackFileFirst,
  writeNewCorpusObject,
  CORPUS_BUCKET,
} from '@/lib/edit-intent/write-back';
import { WriterFenceBusyError } from '@/lib/corpus/writer-fence';

// uuid5(ci:{rel_path}) is the deterministic content_item PK seed. The id is
// opaque to the adapter (it only uses it to resolve the source_document) but
// must be a valid v4-shaped UUID for the route boundary.
const CONTENT_ITEM_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const REL_PATH = 'corpus/test/answer.md';
const PRIOR_BYTES = '# Q\n\nprior answer body\n';
const NEW_BYTES = '# Q\n\nedited answer body\n';

/**
 * Configure the two plain-column reads `writeBackFileFirst` issues, in
 * sequence: content_items.source_document_id, then
 * source_documents.storage_path (never a PostgREST FK embed — the FK was
 * dropped in migration 20260602073942, bl-286 C1).
 */
function configureResolution(
  client: MockSupabaseClient,
  opts: {
    sourceDocumentId?: string | null;
    itemsError?: unknown;
    storagePath?: string | null;
    docsError?: unknown;
    docRowMissing?: boolean;
  },
) {
  if (opts.itemsError) {
    client._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: opts.itemsError,
    });
    return;
  }
  client._chain.maybeSingle.mockResolvedValueOnce({
    data: { source_document_id: opts.sourceDocumentId ?? null },
    error: null,
  });
  if (opts.sourceDocumentId === null || opts.sourceDocumentId === undefined) {
    return; // source-less guard — no second read issued.
  }
  if (opts.docsError) {
    client._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: opts.docsError,
    });
    return;
  }
  if (opts.docRowMissing) {
    client._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    return;
  }
  client._chain.maybeSingle.mockResolvedValueOnce({
    data: { storage_path: opts.storagePath ?? null },
    error: null,
  });
}

/**
 * The shape of the storage bucket double `createMockSupabaseClient()` wires
 * `storage.from()` to resolve to. Declared locally (not imported from the
 * shared helper) because `MockSupabaseClient['storage']['from']`'s
 * `ReturnType<typeof vi.fn>` type is a bare, un-parameterised Mock — calling
 * it directly does not typecheck (TS2348); the cast below is the minimal
 * local fix, confined to this test file.
 */
interface MockStorageBucket {
  upload: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
}

/** The corpus-bucket storage double `mockSupabase.storage.from(CORPUS_BUCKET)` resolves to. */
function bucket(client: MockSupabaseClient): MockStorageBucket {
  const from = client.storage.from as unknown as (
    bucketName: string,
  ) => MockStorageBucket;
  return from(CORPUS_BUCKET);
}

describe('writeBackFileFirst — file-first write-back with compensating restore (Storage-backed)', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
    // The writer-fence RPC (acquire + release) succeeds by default; tests
    // that want fence-busy override with a scoped mockResolvedValueOnce.
    mockSupabase.rpc.mockResolvedValue({ data: true, error: null });
    // Default download: an existing object holding PRIOR_BYTES (the common
    // write-back-to-an-existing-object case).
    bucket(mockSupabase).download.mockResolvedValue({
      data: new Blob([PRIOR_BYTES]),
      error: null,
    });
    bucket(mockSupabase).upload.mockResolvedValue({
      data: { path: REL_PATH },
      error: null,
    });
    loggerMocks.warn.mockClear();
    loggerMocks.info.mockClear();
    loggerMocks.error.mockClear();
    // Never let the fire-and-forget re-walk nudge attempt a real network
    // call in tests that don't explicitly configure it.
    delete process.env.COCOINDEX_WORKER_URL;
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    delete process.env.COCOINDEX_WORKER_URL;
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  function client(): Parameters<typeof writeBackFileFirst>[0]['supabase'] {
    return mockSupabase as unknown as Parameters<
      typeof writeBackFileFirst
    >[0]['supabase'];
  }

  it('PROOF 1 — file-backed edit PUTs the SAME object key (NOT the VPS volume) AND applies the DB leg', async () => {
    configureResolution(mockSupabase, {
      sourceDocumentId: SOURCE_DOCUMENT_ID,
      storagePath: REL_PATH,
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    const result = await writeBackFileFirst({
      supabase: client(),
      contentItemId: CONTENT_ITEM_ID,
      newContent: NEW_BYTES,
      applyDbLeg,
    });

    // The Storage leg PUT the new bytes at the EXACT storage_path (same
    // identity — a different key would orphan the uuid5 seed, INV-1 hazard).
    expect(mockSupabase.storage.from).toHaveBeenCalledWith(CORPUS_BUCKET);
    expect(bucket(mockSupabase).upload).toHaveBeenCalledWith(
      REL_PATH,
      NEW_BYTES,
      expect.objectContaining({ upsert: true, contentType: 'text/markdown' }),
    );
    // DB leg ran exactly once, AFTER the successful PUT (file-first).
    expect(applyDbLeg).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(true);
    expect(result.fileBacked).toBe(true);
    expect(result.warnings).toEqual([]);
    // GUARD: a source-BACKED item is NOT the anomaly — the source-less log
    // never fires for it ({59.10}).
    expect(loggerMocks.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'source_less_content_item_edit_back' }),
      expect.anything(),
    );
  });

  it('{59.10} GUARD — source-less item (source_document_id IS NULL) writes KH-DB-only, NO Storage PUT, emits the anomaly log', async () => {
    configureResolution(mockSupabase, { sourceDocumentId: null });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    const result = await writeBackFileFirst({
      supabase: client(),
      contentItemId: CONTENT_ITEM_ID,
      newContent: NEW_BYTES,
      applyDbLeg,
      context: 'items.patch.write-back.resolve-storage-path',
    });

    expect(result.applied).toBe(true);
    expect(result.fileBacked).toBe(false);
    expect(applyDbLeg).toHaveBeenCalledTimes(1);
    expect(bucket(mockSupabase).upload).not.toHaveBeenCalled();
    expect(bucket(mockSupabase).download).not.toHaveBeenCalled();

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'source_less_content_item_edit_back',
        contentItemId: CONTENT_ITEM_ID,
        caller: 'items.patch.write-back.resolve-storage-path',
      }),
      expect.any(String),
    );
  });

  it('{138.12} Storage-leg idle-mode equivalent — corpus bucket not provisioned in this project -> DB-only, NO PUT attempted', async () => {
    configureResolution(mockSupabase, {
      sourceDocumentId: SOURCE_DOCUMENT_ID,
      storagePath: REL_PATH,
    });
    bucket(mockSupabase).download.mockResolvedValueOnce({
      data: null,
      error: { message: 'Bucket not found' },
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    const result = await writeBackFileFirst({
      supabase: client(),
      contentItemId: CONTENT_ITEM_ID,
      newContent: NEW_BYTES,
      applyDbLeg,
    });

    expect(result.applied).toBe(true);
    expect(result.fileBacked).toBe(false);
    expect(applyDbLeg).toHaveBeenCalledTimes(1);
    // The bucket-not-found short-circuits BEFORE any PUT attempt.
    expect(bucket(mockSupabase).upload).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'corpus_bucket_unconfigured',
        contentItemId: CONTENT_ITEM_ID,
      }),
      expect.any(String),
    );
    // Source-BACKED (not the source-less anomaly) — that log must not fire.
    expect(loggerMocks.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'source_less_content_item_edit_back' }),
      expect.anything(),
    );
  });

  it('PROOF 2 — Storage PUT failure aborts BEFORE the DB write (DB untouched, one failure state)', async () => {
    configureResolution(mockSupabase, {
      sourceDocumentId: SOURCE_DOCUMENT_ID,
      storagePath: REL_PATH,
    });
    bucket(mockSupabase).upload.mockResolvedValueOnce({
      data: null,
      error: { message: 'network error, PUT failed' },
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    await expect(
      writeBackFileFirst({
        supabase: client(),
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg,
      }),
    ).rejects.toThrow();

    // The DB write was NEVER invoked — the DB is untouched.
    expect(applyDbLeg).not.toHaveBeenCalled();
  });

  it('a busy writer-fence aborts BEFORE the DB write (second failure mode, same one-failure-state guarantee)', async () => {
    configureResolution(mockSupabase, {
      sourceDocumentId: SOURCE_DOCUMENT_ID,
      storagePath: REL_PATH,
    });
    // Acquire fails (another writer holds the lease) — try-semantics, false
    // not thrown.
    mockSupabase.rpc.mockResolvedValueOnce({ data: false, error: null });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    await expect(
      writeBackFileFirst({
        supabase: client(),
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg,
      }),
    ).rejects.toThrow(WriterFenceBusyError);

    expect(applyDbLeg).not.toHaveBeenCalled();
    expect(bucket(mockSupabase).upload).not.toHaveBeenCalled();
  });

  it('PROOF 3 — DB-write failure AFTER a successful PUT RESTORES the prior bytes (fenced)', async () => {
    configureResolution(mockSupabase, {
      sourceDocumentId: SOURCE_DOCUMENT_ID,
      storagePath: REL_PATH,
    });
    const dbError = new Error('content_history insert failed (forced)');
    const applyDbLeg = vi.fn().mockRejectedValue(dbError);

    await expect(
      writeBackFileFirst({
        supabase: client(),
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg,
      }),
    ).rejects.toThrow();

    // COMPENSATING-RESTORE PROOF: upload called TWICE — the edit, then the
    // restore with the PRIOR bytes (captured from the download snapshot).
    expect(bucket(mockSupabase).upload).toHaveBeenCalledTimes(2);
    const [restoreKey, restoreBytes] = bucket(mockSupabase).upload.mock
      .calls[1] as [string, string, unknown];
    expect(restoreKey).toBe(REL_PATH);
    expect(restoreBytes).toBe(PRIOR_BYTES);
    expect(applyDbLeg).toHaveBeenCalledTimes(1);
    // The fence RPC was acquired/released twice (main PUT + restore PUT).
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(4); // acquire+release x2
  });

  it('a degraded restore still raises the original failure (user sees ONE outcome)', async () => {
    configureResolution(mockSupabase, {
      sourceDocumentId: SOURCE_DOCUMENT_ID,
      storagePath: REL_PATH,
    });
    // The restore PUT itself fails.
    bucket(mockSupabase)
      .upload.mockResolvedValueOnce({ data: { path: REL_PATH }, error: null }) // main PUT ok
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'restore boom' },
      }); // restore fails

    await expect(
      writeBackFileFirst({
        supabase: client(),
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg: async () => {
          throw new Error('db leg failed (forced)');
        },
      }),
    ).rejects.toThrow('db leg failed (forced)');
  });

  it('raises when the source_document_id read itself fails (no Storage or DB write attempted)', async () => {
    configureResolution(mockSupabase, {
      itemsError: { message: 'lookup boom', code: 'NETWORK_ERROR' },
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    await expect(
      writeBackFileFirst({
        supabase: client(),
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg,
      }),
    ).rejects.toThrow();

    expect(applyDbLeg).not.toHaveBeenCalled();
    expect(bucket(mockSupabase).upload).not.toHaveBeenCalled();
  });

  it('raises when the storage_path read fails (no Storage or DB write attempted)', async () => {
    configureResolution(mockSupabase, {
      sourceDocumentId: SOURCE_DOCUMENT_ID,
      docsError: { message: 'doc lookup boom', code: 'NETWORK_ERROR' },
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    await expect(
      writeBackFileFirst({
        supabase: client(),
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg,
      }),
    ).rejects.toThrow();

    expect(applyDbLeg).not.toHaveBeenCalled();
    expect(bucket(mockSupabase).upload).not.toHaveBeenCalled();
  });

  it('dangling source_document_id (doc row deleted post-FK-drop) writes KH-DB-only and logs the dangling-reference anomaly', async () => {
    configureResolution(mockSupabase, {
      sourceDocumentId: SOURCE_DOCUMENT_ID,
      docRowMissing: true,
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    const result = await writeBackFileFirst({
      supabase: client(),
      contentItemId: CONTENT_ITEM_ID,
      newContent: NEW_BYTES,
      applyDbLeg,
    });

    expect(result.applied).toBe(true);
    expect(result.fileBacked).toBe(false);
    expect(applyDbLeg).toHaveBeenCalledTimes(1);
    expect(bucket(mockSupabase).upload).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'dangling_source_document_reference',
        contentItemId: CONTENT_ITEM_ID,
        sourceDocumentId: SOURCE_DOCUMENT_ID,
      }),
      expect.any(String),
    );
  });

  describe('re-walk nudge (TECH §3.3 T1 — "then nudge a re-walk")', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('fires a POST to {COCOINDEX_WORKER_URL}/walk on the happy path when configured', async () => {
      process.env.COCOINDEX_WORKER_URL = 'https://worker.example.test';
      process.env.CRON_SECRET = 'test-cron-secret';
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 202 } as Response);
      global.fetch = fetchMock as unknown as typeof fetch;

      configureResolution(mockSupabase, {
        sourceDocumentId: SOURCE_DOCUMENT_ID,
        storagePath: REL_PATH,
      });
      const applyDbLeg = vi.fn().mockResolvedValue(undefined);

      await writeBackFileFirst({
        supabase: client(),
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg,
      });

      // Fire-and-forget — flush the microtask queue before asserting.
      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://worker.example.test/walk',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' },
        }),
      );
    });

    it('does NOT nudge on the DB-failure/restore path (a reverted edit must not trigger a walk)', async () => {
      process.env.COCOINDEX_WORKER_URL = 'https://worker.example.test';
      process.env.CRON_SECRET = 'test-cron-secret';
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
      global.fetch = fetchMock as unknown as typeof fetch;

      configureResolution(mockSupabase, {
        sourceDocumentId: SOURCE_DOCUMENT_ID,
        storagePath: REL_PATH,
      });

      await expect(
        writeBackFileFirst({
          supabase: client(),
          contentItemId: CONTENT_ITEM_ID,
          newContent: NEW_BYTES,
          applyDbLeg: async () => {
            throw new Error('db leg failed (forced)');
          },
        }),
      ).rejects.toThrow();

      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips gracefully (no throw) when COCOINDEX_WORKER_URL is unset', async () => {
      configureResolution(mockSupabase, {
        sourceDocumentId: SOURCE_DOCUMENT_ID,
        storagePath: REL_PATH,
      });
      const applyDbLeg = vi.fn().mockResolvedValue(undefined);

      const result = await writeBackFileFirst({
        supabase: client(),
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg,
      });

      expect(result.fileBacked).toBe(true);
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ objectKey: REL_PATH }),
        expect.stringContaining('COCOINDEX_WORKER_URL unset'),
      );
    });
  });
});

describe('writeNewCorpusObject — {138.12} T4 no-prior-object mint (q_a-pairs MATERIALISE branch)', () => {
  let mockSupabase: MockSupabaseClient;
  const OBJECT_KEY = '__qa__/some-pair-id.md';
  const CONTENT = '# Question\n\nAnswer body\n';

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
    mockSupabase.rpc.mockResolvedValue({ data: true, error: null });
    bucket(mockSupabase).upload.mockResolvedValue({
      data: { path: OBJECT_KEY },
      error: null,
    });
    delete process.env.COCOINDEX_WORKER_URL;
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    delete process.env.COCOINDEX_WORKER_URL;
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  function client() {
    return mockSupabase as unknown as Parameters<
      typeof writeNewCorpusObject
    >[0]['supabase'];
  }

  it('mints the object with upsert:true (tolerant of a stray orphan, mirrors the original writeFile semantics)', async () => {
    await writeNewCorpusObject({
      supabase: client(),
      objectKey: OBJECT_KEY,
      newContent: CONTENT,
    });

    expect(bucket(mockSupabase).upload).toHaveBeenCalledWith(
      OBJECT_KEY,
      CONTENT,
      expect.objectContaining({ upsert: true, contentType: 'text/markdown' }),
    );
  });

  it('throws CorpusBucketUnavailableError when the corpus bucket is not provisioned', async () => {
    bucket(mockSupabase).upload.mockResolvedValueOnce({
      data: null,
      error: { message: 'Bucket not found' },
    });

    await expect(
      writeNewCorpusObject({
        supabase: client(),
        objectKey: OBJECT_KEY,
        newContent: CONTENT,
      }),
    ).rejects.toThrow(CorpusBucketUnavailableError);
  });

  it('a genuine upload error (not bucket-not-found) throws as-is', async () => {
    bucket(mockSupabase).upload.mockResolvedValueOnce({
      data: null,
      error: { message: 'quota exceeded' },
    });

    await expect(
      writeNewCorpusObject({
        supabase: client(),
        objectKey: OBJECT_KEY,
        newContent: CONTENT,
      }),
    ).rejects.not.toThrow(CorpusBucketUnavailableError);
  });
});
