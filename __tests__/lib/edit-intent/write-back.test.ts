/**
 * {59.9} — file-first write-back adapter with compensating restore.
 * {59.10} — source-less content_item GUARD (bl-266).
 *
 * These are file-backed integration tests: the file leg writes to a real
 * temp directory (a stand-in for the COCOINDEX_SOURCE_PATH source-binding
 * folder) so the atomicity ordering (INV-2) is proven against actual bytes
 * on disk, not a mock. The DB legs (the storage_path read + the {59.8}
 * content_items/content_history write) are injected so each failure mode can
 * be forced deterministically.
 *
 * The {59.9} testStrategy proofs:
 *   1. file-backed edit  -> same-path rewrite + DB leg applied;
 *   2. force file-write fail -> DB leg NEVER invoked (one failure state);
 *   3. force DB-write fail AFTER file write -> file RESTORED to prior bytes
 *      (compensating-restore proof).
 *
 * The {59.10} testStrategy proof (PC-3 / INV-3):
 *   source_document_id IS NULL -> NO file write, NO source_document created,
 *   NO connector='mcp' mint; `source_less_content_item_edit_back` anomaly log
 *   emitted; the DB leg (content_items + content_history WITH edit_intent)
 *   STILL runs. Source-backed item -> file written normally (guard passes).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

// {59.10}: the source-less guard emits a structured anomaly log via the
// `@/lib/logger` singleton. Mock it (hoisted) so the
// `source_less_content_item_edit_back` event is captured and asserted, and so
// no real Sentry forwarding fires under test.
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

import { writeBackFileFirst } from '@/lib/edit-intent/write-back';

// uuid5(ci:{rel_path}) is the deterministic content_item PK seed. The id is
// opaque to the adapter (it only uses it to resolve the source_document) but
// must be a valid v4-shaped UUID for the route boundary.
const CONTENT_ITEM_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';

/**
 * PostgREST-faithful supabase stub (bl-286 C1 regression shape).
 *
 * Mirrors the REAL staging/prod schema: the content_items -> source_documents
 * FK was deliberately DROPPED in migration 20260602073942 (ID-64.3 BUG-E — the
 * cocoindex autocommit write model cannot satisfy cross-target FKs), so ANY
 * embedded select `source_documents(...)` from content_items fails with
 * PGRST200 ("Could not find a relationship ... in the schema cache") exactly
 * like live PostgREST. The adapter must therefore resolve the file leg with
 * plain per-table reads — that schema reality is encoded here so the unit
 * suite can never again green-light an FK-embed the database cannot serve.
 */
function makeSupabaseStub(db: {
  items?: Record<string, { source_document_id: string | null }>;
  docs?: Record<string, { storage_path: string | null }>;
  itemsError?: unknown;
  docsError?: unknown;
}) {
  const from = vi.fn((table: string) => ({
    select: vi.fn((cols: string) => ({
      eq: vi.fn((_col: string, id: string) => ({
        maybeSingle: vi.fn(async () => {
          if (table === 'content_items') {
            if (/source_documents\s*\(/.test(cols)) {
              // The dropped-FK reality: PostgREST cannot resolve the embed.
              return {
                data: null,
                error: {
                  code: 'PGRST200',
                  message:
                    "Could not find a relationship between 'content_items' " +
                    "and 'source_documents' in the schema cache",
                  details:
                    'Searched for a foreign key relationship between ' +
                    "'content_items' and 'source_documents' in the schema " +
                    "'public', but no matches were found.",
                  hint: null,
                },
              };
            }
            if (db.itemsError) return { data: null, error: db.itemsError };
            return { data: db.items?.[id] ?? null, error: null };
          }
          if (table === 'source_documents') {
            if (db.docsError) return { data: null, error: db.docsError };
            return { data: db.docs?.[id] ?? null, error: null };
          }
          return {
            data: null,
            error: { message: `unexpected table ${table}` },
          };
        }),
      })),
    })),
  }));
  return { client: { from } as never, from };
}

describe('writeBackFileFirst — file-first write-back with compensating restore', () => {
  let sourceRoot: string;
  const REL_PATH = 'corpus/test/answer.md';
  const PRIOR_BYTES = '# Q\n\nprior answer body\n';
  const NEW_BYTES = '# Q\n\nedited answer body\n';

  beforeEach(async () => {
    sourceRoot = await mkdtemp(join(tmpdir(), 'kh-writeback-'));
    process.env.COCOINDEX_SOURCE_PATH = sourceRoot;
    const abs = join(sourceRoot, REL_PATH);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, PRIOR_BYTES, 'utf8');
    loggerMocks.warn.mockClear();
    loggerMocks.info.mockClear();
    loggerMocks.error.mockClear();
  });

  afterEach(async () => {
    delete process.env.COCOINDEX_SOURCE_PATH;
    await rm(sourceRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('PROOF 1 — file-backed edit rewrites the SAME path AND applies the DB leg (bl-286 C1: against the dropped-FK schema, no PGRST200)', async () => {
    const sb = makeSupabaseStub({
      items: { [CONTENT_ITEM_ID]: { source_document_id: SOURCE_DOCUMENT_ID } },
      docs: { [SOURCE_DOCUMENT_ID]: { storage_path: REL_PATH } },
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    const result = await writeBackFileFirst({
      supabase: sb.client,
      contentItemId: CONTENT_ITEM_ID,
      newContent: NEW_BYTES,
      applyDbLeg,
    });

    // The file at the EXACT storage_path now holds the new bytes (same
    // identity — a path change would orphan the uuid5 seed, INV-1 hazard).
    const onDisk = await readFile(join(sourceRoot, REL_PATH), 'utf8');
    expect(onDisk).toBe(NEW_BYTES);
    // DB leg ran exactly once, AFTER the successful file write (file-first).
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

  it('{59.10} GUARD — source-less item (source_document_id IS NULL) writes KH-DB-only, NO file, emits the anomaly log', async () => {
    // PC-3 / INV-3 (bl-266): a content_item with NO linked source_document is
    // an anomaly to GUARD, not a write path. The injected DB leg STILL runs
    // (the {59.8} content_items + content_history WITH edit_intent write), but
    // the adapter writes NO file, auto-creates NO source_document, and mints
    // NO connector='mcp' storage path — and emits the structured anomaly log.
    const sb = makeSupabaseStub({
      items: { [CONTENT_ITEM_ID]: { source_document_id: null } },
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    const result = await writeBackFileFirst({
      supabase: sb.client,
      contentItemId: CONTENT_ITEM_ID,
      newContent: NEW_BYTES,
      applyDbLeg,
      context: 'items.patch.write-back.resolve-storage-path',
    });

    // The DB-only leg applied (the user's save still lands).
    expect(result.applied).toBe(true);
    expect(result.fileBacked).toBe(false);
    expect(applyDbLeg).toHaveBeenCalledTimes(1);

    // NO file was written — the pre-existing on-disk file is untouched and the
    // adapter created nothing on the source-binding folder.
    const onDisk = await readFile(join(sourceRoot, REL_PATH), 'utf8');
    expect(onDisk).toBe(PRIOR_BYTES);

    // NO source_document auto-create + NO connector='mcp' mint: the adapter's
    // ONLY supabase touch is the single read (`from('content_items')` once);
    // it never issues an insert/upsert/update of its own. A mint or auto-create
    // would require a second `from(...)` call — assert there was exactly one.
    expect(sb.from).toHaveBeenCalledTimes(1);
    expect(sb.from).toHaveBeenCalledWith('content_items');

    // The structured anomaly log fired with the bl-266-traceable event, the
    // content-item id, and the caller — so the source-less population is
    // observable.
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'source_less_content_item_edit_back',
        contentItemId: CONTENT_ITEM_ID,
        caller: 'items.patch.write-back.resolve-storage-path',
      }),
      expect.any(String),
    );
  });

  it('skips the file leg for a source-BACKED item in idle mode (no COCOINDEX_SOURCE_PATH) WITHOUT the source-less log', async () => {
    // A linked source_document exists but the source-binding folder is unset
    // (flow idle mode) — there is no on-disk file to rewrite. This is NOT the
    // source-less anomaly: the DB leg applies and NO anomaly log fires.
    delete process.env.COCOINDEX_SOURCE_PATH;
    const sb = makeSupabaseStub({
      items: { [CONTENT_ITEM_ID]: { source_document_id: SOURCE_DOCUMENT_ID } },
      docs: { [SOURCE_DOCUMENT_ID]: { storage_path: REL_PATH } },
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    const result = await writeBackFileFirst({
      supabase: sb.client,
      contentItemId: CONTENT_ITEM_ID,
      newContent: NEW_BYTES,
      applyDbLeg,
    });

    expect(result.fileBacked).toBe(false);
    expect(result.applied).toBe(true);
    // The DB leg (the canonical {59.8} write) still applies.
    expect(applyDbLeg).toHaveBeenCalledTimes(1);
    // Source-BACKED -> the source-less anomaly log must NOT fire.
    expect(loggerMocks.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'source_less_content_item_edit_back' }),
      expect.anything(),
    );
  });

  it('PROOF 2 — file-write failure aborts BEFORE the DB write (DB untouched, one failure state)', async () => {
    // storage_path points at a path whose parent directory does not exist
    // -> writeFile rejects. The DB leg must never be reached so there is a
    // single failure state (file ahead of DB is impossible on this leg).
    const sb = makeSupabaseStub({
      items: { [CONTENT_ITEM_ID]: { source_document_id: SOURCE_DOCUMENT_ID } },
      docs: {
        [SOURCE_DOCUMENT_ID]: {
          storage_path: 'no-such-dir/deeper/missing.md',
        },
      },
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    await expect(
      writeBackFileFirst({
        supabase: sb.client,
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg,
      }),
    ).rejects.toThrow();

    // The DB write was NEVER invoked — the DB is untouched.
    expect(applyDbLeg).not.toHaveBeenCalled();
    // The original file is untouched (it lives at REL_PATH, not the bad path).
    const onDisk = await readFile(join(sourceRoot, REL_PATH), 'utf8');
    expect(onDisk).toBe(PRIOR_BYTES);
  });

  it('PROOF 3 — DB-write failure AFTER a successful file write RESTORES the prior bytes', async () => {
    const sb = makeSupabaseStub({
      items: { [CONTENT_ITEM_ID]: { source_document_id: SOURCE_DOCUMENT_ID } },
      docs: { [SOURCE_DOCUMENT_ID]: { storage_path: REL_PATH } },
    });
    // The DB leg fails AFTER the file has already been rewritten. The
    // compensating restore must read-then-restore the snapshot so neither
    // leg is left applied.
    const dbError = new Error('content_history insert failed (forced)');
    const applyDbLeg = vi.fn().mockRejectedValue(dbError);

    await expect(
      writeBackFileFirst({
        supabase: sb.client,
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg,
      }),
    ).rejects.toThrow();

    // COMPENSATING-RESTORE PROOF: the file is back to its prior bytes — the
    // file leg did not survive a DB-leg failure.
    const onDisk = await readFile(join(sourceRoot, REL_PATH), 'utf8');
    expect(onDisk).toBe(PRIOR_BYTES);
    expect(applyDbLeg).toHaveBeenCalledTimes(1);
  });

  it('a degraded restore still raises the failure (user sees ONE outcome)', async () => {
    const sb = makeSupabaseStub({
      items: { [CONTENT_ITEM_ID]: { source_document_id: SOURCE_DOCUMENT_ID } },
      docs: { [SOURCE_DOCUMENT_ID]: { storage_path: REL_PATH } },
    });

    // Force the restore write itself to degrade: the DB leg deletes the
    // source root before failing, so the restore's writeFile cannot recreate
    // the file. The adapter must still raise the original DB error (one save
    // outcome surfaced to the user) — a best-effort restore that degrades
    // never masks the real failure.
    await expect(
      writeBackFileFirst({
        supabase: sb.client,
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg: async () => {
          await rm(sourceRoot, { recursive: true, force: true });
          throw new Error('db leg failed (forced)');
        },
      }),
    ).rejects.toThrow();
  });

  it('raises when the source_document_id read itself fails (no file or DB write attempted)', async () => {
    const sb = makeSupabaseStub({
      itemsError: { message: 'lookup boom', code: 'NETWORK_ERROR' },
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    await expect(
      writeBackFileFirst({
        supabase: sb.client,
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg,
      }),
    ).rejects.toThrow();

    expect(applyDbLeg).not.toHaveBeenCalled();
    const onDisk = await readFile(join(sourceRoot, REL_PATH), 'utf8');
    expect(onDisk).toBe(PRIOR_BYTES);
  });

  it('raises when the storage_path read fails (no file or DB write attempted)', async () => {
    const sb = makeSupabaseStub({
      items: { [CONTENT_ITEM_ID]: { source_document_id: SOURCE_DOCUMENT_ID } },
      docsError: { message: 'doc lookup boom', code: 'NETWORK_ERROR' },
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    await expect(
      writeBackFileFirst({
        supabase: sb.client,
        contentItemId: CONTENT_ITEM_ID,
        newContent: NEW_BYTES,
        applyDbLeg,
      }),
    ).rejects.toThrow();

    expect(applyDbLeg).not.toHaveBeenCalled();
    const onDisk = await readFile(join(sourceRoot, REL_PATH), 'utf8');
    expect(onDisk).toBe(PRIOR_BYTES);
  });

  it('dangling source_document_id (doc row deleted post-FK-drop) writes KH-DB-only and logs the dangling-reference anomaly', async () => {
    // With the content_items -> source_documents FK dropped (migration
    // 20260602073942), ON DELETE SET NULL no longer auto-fires — a
    // source_documents delete can leave content_items.source_document_id
    // dangling. The save must still land (DB-only, no file leg) and the
    // dangling reference must be observable.
    const sb = makeSupabaseStub({
      items: { [CONTENT_ITEM_ID]: { source_document_id: SOURCE_DOCUMENT_ID } },
      docs: {}, // the referenced source_documents row does not exist
    });
    const applyDbLeg = vi.fn().mockResolvedValue(undefined);

    const result = await writeBackFileFirst({
      supabase: sb.client,
      contentItemId: CONTENT_ITEM_ID,
      newContent: NEW_BYTES,
      applyDbLeg,
    });

    expect(result.applied).toBe(true);
    expect(result.fileBacked).toBe(false);
    expect(applyDbLeg).toHaveBeenCalledTimes(1);
    // No file was written.
    const onDisk = await readFile(join(sourceRoot, REL_PATH), 'utf8');
    expect(onDisk).toBe(PRIOR_BYTES);
    // The dangling reference is observable (distinct from the source-less
    // anomaly — the item DOES carry a source_document_id).
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'dangling_source_document_reference',
        contentItemId: CONTENT_ITEM_ID,
        sourceDocumentId: SOURCE_DOCUMENT_ID,
      }),
      expect.any(String),
    );
  });
});
