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
 *   - SEED-CONTRACT parity: the SAME string passed as this fn's p_rel_path and
 *     as the live `reference_ingest` fn's p_source_url mints the IDENTICAL id —
 *     both fns compute uuid_generate_v5(fbfaf1ff-1ee4-583c-9757-1674465b2ec1,
 *     'sd:' || value), so this is a real, executable proof that the new fn's
 *     formula matches the already-proven SQL precedent (and, by that
 *     precedent's own header comment, the Python pipeline's uuid.uuid5).
 *   - the mandatory `REVOKE EXECUTE ... FROM anon` is enforced.
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

// Seeded-row registry for teardown (reference_items before source_documents —
// reference_items.source_document_id is NOT NULL REFERENCES ... ON DELETE RESTRICT).
const mintedReferenceItemIds: string[] = [];
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
  if (mintedReferenceItemIds.length) {
    await db.from('reference_items').delete().in('id', mintedReferenceItemIds);
  }
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

  it('SEED-CONTRACT parity: matches the SAME uuid5(namespace, "sd:"+value) formula the live reference_ingest fn already uses', async () => {
    if (skip) return;
    // reference_ingest computes v_sd_id := uuid_generate_v5(NAMESPACE, 'sd:' || p_source_url)
    // (20260619130100_id112_reference_ingest_derive_method.sql:28-29) — the SAME
    // namespace + "sd:" prefix formula this fn's header comment claims to match.
    // Passing the SAME string as p_rel_path here and p_source_url there MUST
    // therefore mint the IDENTICAL id if the formulas truly agree — a real,
    // executable proof (no JS uuid5 reimplementation needed).
    const sharedPathValue = `markdown/${TEST_TAG}-seed-contract-parity.md`;

    const { data: minted, error: mintErr } = await db.rpc(
      'resolve_or_mint_source_identity',
      {
        p_content_hash: `${TEST_TAG}-hash-seed-contract`,
        p_rel_path: sharedPathValue,
        p_filename: 'seed-contract.md',
        p_mime_type: 'text/markdown',
        p_file_size: 42,
      },
    );
    expect(mintErr).toBeNull();
    const mintedRow = firstRow<MintResult>(minted);
    mintedSourceDocumentIds.push(mintedRow.source_document_id);

    const { data: refIngest, error: refErr } = await db.rpc(
      'reference_ingest',
      {
        p_source_url: sharedPathValue,
        p_title: `[${TEST_TAG}] seed-contract parity`,
        p_body: 'disposable parity-check body',
        p_summary: null,
        p_primary_domain: null,
        p_primary_subtopic: null,
        p_embedding: null,
        p_published_at: null,
        p_filename: 'seed-contract.md',
        p_mime_type: 'text/markdown',
        p_file_size: 42,
        p_content_hash: `${TEST_TAG}-hash-seed-contract-refingest`,
      },
    );
    expect(refErr).toBeNull();
    const refRow = firstRow<{
      reference_id: string;
      source_document_id: string;
    }>(refIngest);
    mintedReferenceItemIds.push(refRow.reference_id);
    mintedSourceDocumentIds.push(refRow.source_document_id);

    expect(refRow.source_document_id).toBe(mintedRow.source_document_id);
  });

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
