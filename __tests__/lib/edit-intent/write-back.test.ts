/**
 * {59.9} — file-first write-back adapter with compensating restore.
 *
 * These are file-backed integration tests: the file leg writes to a real
 * temp directory (a stand-in for the COCOINDEX_SOURCE_PATH source-binding
 * folder) so the atomicity ordering (INV-2) is proven against actual bytes
 * on disk, not a mock. The DB legs (the storage_path read + the {59.8}
 * content_items/content_history write) are injected so each failure mode can
 * be forced deterministically.
 *
 * The three testStrategy proofs:
 *   1. file-backed edit  -> same-path rewrite + DB leg applied;
 *   2. force file-write fail -> DB leg NEVER invoked (one failure state);
 *   3. force DB-write fail AFTER file write -> file RESTORED to prior bytes
 *      (compensating-restore proof).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { writeBackFileFirst } from '@/lib/edit-intent/write-back';

// uuid5(ci:{rel_path}) is the deterministic content_item PK seed. The id is
// opaque to the adapter (it only uses it to resolve the source_document) but
// must be a valid v4-shaped UUID for the route boundary.
const CONTENT_ITEM_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Minimal supabase stub: only `from('content_items').select(...).eq(...)
 * .maybeSingle()` is exercised by the adapter's storage_path read. The
 * resolution is injected per test so the "not file-backed" and "lookup
 * fails" branches are reachable.
 */
function makeSupabaseStub(resolution: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(resolution);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, from, select, eq, maybeSingle };
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
  });

  afterEach(async () => {
    delete process.env.COCOINDEX_SOURCE_PATH;
    await rm(sourceRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('PROOF 1 — file-backed edit rewrites the SAME path AND applies the DB leg', async () => {
    const sb = makeSupabaseStub({
      data: { source_document_id: SOURCE_DOCUMENT_ID, storage_path: REL_PATH },
      error: null,
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
  });

  it('skips the file leg for items that are NOT file-backed (DB leg still runs)', async () => {
    const sb = makeSupabaseStub({
      data: { source_document_id: null, storage_path: null },
      error: null,
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
    // No file leg, but the DB leg (the canonical {59.8} write) still applies.
    expect(applyDbLeg).toHaveBeenCalledTimes(1);
  });

  it('PROOF 2 — file-write failure aborts BEFORE the DB write (DB untouched, one failure state)', async () => {
    // storage_path points at a path whose parent directory does not exist
    // -> writeFile rejects. The DB leg must never be reached so there is a
    // single failure state (file ahead of DB is impossible on this leg).
    const sb = makeSupabaseStub({
      data: {
        source_document_id: SOURCE_DOCUMENT_ID,
        storage_path: 'no-such-dir/deeper/missing.md',
      },
      error: null,
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
      data: { source_document_id: SOURCE_DOCUMENT_ID, storage_path: REL_PATH },
      error: null,
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
      data: { source_document_id: SOURCE_DOCUMENT_ID, storage_path: REL_PATH },
      error: null,
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

  it('raises when the storage_path read itself fails (no file or DB write attempted)', async () => {
    const sb = makeSupabaseStub({
      data: null,
      error: { message: 'lookup boom', code: 'NETWORK_ERROR' },
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
});
