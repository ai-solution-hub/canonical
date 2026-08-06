/**
 * ID-138 {138.6} M2 — resolve_or_mint_source_identity integration test.
 *
 * RED UNTIL GO: migration 20260703160100_id138_admission_identity_fn.sql is
 * AUTHORED but NOT YET APPLIED (owner-gated coordinated GO; id138 serial
 * {138.5}->{138.6}->{138.7}->{138.9}). Until the GO, `resolve_or_mint_source_
 * identity` does not exist on the target DB and every `.rpc()` call below fails
 * with a PostgREST "function not found" error — that IS the expected pre-GO
 * state, not a test bug. This suite documents the acceptance criteria and will
 * go green the moment the migration lands.
 *
 * Verifies TECH.md §2.2 R(id) (admission-minted identity, rename-tolerant,
 * DR-024 clause i STANDS) + §2.1 R(a) (SEED-CONTRACT):
 *   - a genuinely new content_hash mints a NEW id (was_minted=true) and seeds
 *     storage_path/logical_path to the admission-time rel_path.
 *   - the SAME content_hash at a NEW rel_path (a simulated rename) resolves to
 *     the SAME id (was_minted=false), updates ONLY the mutable logical_path,
 *     and leaves storage_path (the frozen SEED-CONTRACT key) untouched.
 *   - a distinct content_hash mints a distinct id.
 *   - the mandatory `REVOKE EXECUTE ... FROM anon` is enforced.
 *
 * (The former SEED-CONTRACT parity leg — proving the formula against
 * reference_ingest's sd mint — retired with id-417 / DR-124: reference_ingest
 * no longer mints a source_documents shell, so there is no second sd-minting
 * fn to prove parity against. The formula itself is unchanged.)
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
  isNetworkIsolationError,
} from './helpers/supabase-client';

const TEST_TAG = `id138-admission-identity-${Date.now()}`;

let skip = false;
let db: Awaited<ReturnType<typeof createLiveServiceClient>>;

// Seeded-row registry for teardown.
const mintedSourceDocumentIds: string[] = [];

type MintResult = { source_document_id: string; was_minted: boolean };

function firstRow<T>(data: T | T[] | null): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('expected at least one row from the RPC call');
  return row;
}

beforeAll(async () => {
  if (!hasRealLiveDbCredentials()) {
    skip = true;
    return;
  }
  db = await createLiveServiceClient();

  const probe = await db.from('source_documents').select('id').limit(1);
  if (isNetworkIsolationError(probe.error)) {
    skip = true;
    return;
  }
  if (probe.error) {
    throw new Error(`pre-flight read failed: ${probe.error.message}`);
  }
}, 30_000);

afterAll(async () => {
  if (skip || !db) return;
  if (mintedSourceDocumentIds.length) {
    await db
      .from('source_documents')
      .delete()
      .in('id', mintedSourceDocumentIds);
  }
}, 30_000);

describe('ID-138 {138.6} resolve_or_mint_source_identity — TECH.md §2.2 R(id)', () => {
  it('mints a NEW id for a genuinely new content_hash (was_minted=true), seeding storage_path=logical_path=rel_path', async () => {
    if (skip) return;
    const contentHash = `${TEST_TAG}-hash-A`;
    const relPath = `markdown/${TEST_TAG}-a.md`;

    const { data, error } = await db.rpc('resolve_or_mint_source_identity', {
      p_content_hash: contentHash,
      p_rel_path: relPath,
      p_filename: 'a.md',
      p_mime_type: 'text/markdown',
      p_file_size: 100,
    });
    expect(error).toBeNull();
    const row = firstRow<MintResult>(data);
    expect(row.was_minted).toBe(true);
    expect(row.source_document_id).toBeTruthy();
    mintedSourceDocumentIds.push(row.source_document_id);

    const { data: sdRow, error: sdErr } = await db
      .from('source_documents')
      .select('storage_path, logical_path, content_hash')
      .eq('id', row.source_document_id)
      .single();
    expect(sdErr).toBeNull();
    expect(sdRow?.storage_path).toBe(relPath);
    expect(sdRow?.logical_path).toBe(relPath);
    expect(sdRow?.content_hash).toBe(contentHash);
  });

  it('rename tolerance: same content_hash at a NEW rel_path resolves to the SAME id, updates logical_path only', async () => {
    if (skip) return;
    const contentHash = `${TEST_TAG}-hash-B`;
    const originalPath = `markdown/${TEST_TAG}-b-original.md`;
    const renamedPath = `markdown/${TEST_TAG}-b-renamed.md`;

    const { data: first, error: firstErr } = await db.rpc(
      'resolve_or_mint_source_identity',
      {
        p_content_hash: contentHash,
        p_rel_path: originalPath,
        p_filename: 'b.md',
        p_mime_type: 'text/markdown',
        p_file_size: 200,
      },
    );
    expect(firstErr).toBeNull();
    const firstMint = firstRow<MintResult>(first);
    expect(firstMint.was_minted).toBe(true);
    mintedSourceDocumentIds.push(firstMint.source_document_id);

    const { data: second, error: secondErr } = await db.rpc(
      'resolve_or_mint_source_identity',
      {
        p_content_hash: contentHash, // SAME bytes
        p_rel_path: renamedPath, // NEW path — simulated rename
        p_filename: 'b.md',
        p_mime_type: 'text/markdown',
        p_file_size: 200,
      },
    );
    expect(secondErr).toBeNull();
    const secondResolve = firstRow<MintResult>(second);

    // Same bytes -> the STORED id, never re-derived from path.
    expect(secondResolve.source_document_id).toBe(firstMint.source_document_id);
    expect(secondResolve.was_minted).toBe(false);

    // logical_path (mutable) moves to the new path; storage_path (the frozen
    // SEED-CONTRACT key, §2.1 R(a)) stays at the ORIGINAL admission-time path.
    const { data: sdRow, error: sdErr } = await db
      .from('source_documents')
      .select('storage_path, logical_path')
      .eq('id', firstMint.source_document_id)
      .single();
    expect(sdErr).toBeNull();
    expect(sdRow?.storage_path).toBe(originalPath);
    expect(sdRow?.logical_path).toBe(renamedPath);
  });

  it('a distinct content_hash mints a DISTINCT id', async () => {
    if (skip) return;
    const { data: a, error: aErr } = await db.rpc(
      'resolve_or_mint_source_identity',
      {
        p_content_hash: `${TEST_TAG}-hash-C-A`,
        p_rel_path: `markdown/${TEST_TAG}-c-a.md`,
        p_filename: 'c-a.md',
        p_mime_type: 'text/markdown',
        p_file_size: 10,
      },
    );
    expect(aErr).toBeNull();
    const rowA = firstRow<MintResult>(a);
    mintedSourceDocumentIds.push(rowA.source_document_id);

    const { data: b, error: bErr } = await db.rpc(
      'resolve_or_mint_source_identity',
      {
        p_content_hash: `${TEST_TAG}-hash-C-B`,
        p_rel_path: `markdown/${TEST_TAG}-c-b.md`,
        p_filename: 'c-b.md',
        p_mime_type: 'text/markdown',
        p_file_size: 10,
      },
    );
    expect(bErr).toBeNull();
    const rowB = firstRow<MintResult>(b);
    mintedSourceDocumentIds.push(rowB.source_document_id);

    expect(rowA.source_document_id).not.toBe(rowB.source_document_id);
  });

  // (SEED-CONTRACT parity leg retired — id-417 / DR-124; see header.)

  it('anon REVOKE is enforced — an anon-key client cannot call the function', async () => {
    if (skip) return;
    const anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!anonUrl || !anonKey) return;

    const { createClient } = await import('@supabase/supabase-js');
    const anonClient = createClient(anonUrl, anonKey);

    const { error } = await anonClient.rpc('resolve_or_mint_source_identity', {
      p_content_hash: `${TEST_TAG}-hash-anon-denied`,
      p_rel_path: `markdown/${TEST_TAG}-anon-denied.md`,
      p_filename: 'anon-denied.md',
      p_mime_type: 'text/markdown',
      p_file_size: 1,
    });

    // A REVOKEd EXECUTE surfaces as 42501 (insufficient_privilege) via
    // PostgREST; either way the anon client must NOT be able to mint a row.
    expect(error).not.toBeNull();
  });
});
