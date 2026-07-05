/**
 * Integration test — ID-75 TECH §5 landing set (the {62.10} URL proof).
 *
 * Subtask ID-62.10 (S319 — URL-mode verify driver companion).
 *
 * THE single row-assertion surface for the URL landing set (ID-62 Inv-22 —
 * the URL-mode verify driver at deploy/onprem/verify/verify_driver.py does
 * NOT re-implement row assertions; it seeds the ledger row, POSTs /walk,
 * exit-codes the landing round-trip, and re-walks for the idempotency
 * leg). This file asserts the EVIDENCE PAIR the walk must land — explicitly
 * NOT a content_items landing (the pre-O4 framing is superseded):
 *
 *   1. source_documents row at id = uuid5(NS, 'sd:' + normalisedUrl) with
 *      source_url = storage_path = normalisedUrl, populated filename /
 *      mime_type / file_size, and extraction_method in
 *      {'trafilatura', 'docling'} (ID-112.7 in-process extraction).
 *   2. reference_items row at id = uuid5(NS, 'ri:' + normalisedUrl) with a
 *      non-empty extracted body, embedding NOT NULL,
 *      source_document_id = the sd id, ingestion_source = 'rss_feed', and
 *      published_at round-tripping the seeded ledger value.
 *   3. ZERO content_items rows at uuid5(NS, 'ci:' + normalisedUrl) OR with
 *      source_url = the URL.
 *   4. feed_articles backlink: reference_item_id = the ri id AND
 *      content_item_id IS NULL. TWO-WALK TIMING ({75.17}): the in-component
 *      backlink write races the engine's post-return ri_target flush, so
 *      walk 1 defers it (structured cocoindex.url_backlink_deferred log)
 *      and the backlink CONVERGES on walk 2 — this assertion is valid only
 *      after the driver's second-walk leg (never run the driver with
 *      --skip-second-walk before asserting 4).
 *   5. Idempotency (post-second-walk): row counts unchanged (exactly one
 *      sd, exactly one ri, zero ci) and PKs unchanged (the deterministic
 *      uuid5 ids ARE the PK-stability proof).
 *
 * Env-gate (live assertions): real Supabase service-role credentials
 * (Inv-27 — reachable from anywhere) AND COCOINDEX_URL_VERIFY_URL set to
 * the proof URL the driver seeded. The explicit URL gate keeps this file
 * skip-clean off-host AND in the CI integration job (which has live staging
 * creds but no driver run to assert against). The uuid5-derivation suite at
 * the top is pure and runs everywhere (typed-shape coverage off-host).
 *
 * Operator sequence (B1 host):
 *   1. python3 -m deploy.onprem.verify.verify_driver   (exit 0 required)
 *   2. COCOINDEX_URL_VERIFY_URL=<same URL> bun x vitest run \
 *        --config vitest.integration.config.ts \
 *        __tests__/integration/cocoindex/url-landing-set.integration.test.ts
 *
 * References:
 *   - the ID-75 URL-cocoindex spec, TECH.md §5 (landing-set contract).
 *   - docs/specs/id-62-fixture-staging-infra/TECH.md Inv-21/22/23/27.
 *   - scripts/cocoindex_pipeline/flow.py (_KH_PIPELINE_DOC_NS + uuid5 mint).
 *   - docs/reference/test-philosophy.md (behaviour-not-implementation).
 */

import { createHash } from 'node:crypto';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../helpers/supabase-client';

// content-extractor routes telemetry through @/lib/logger and constructs a
// global rate limiter at import time — mock both so the import stays light
// (same pattern as __tests__/validation/url-normalisation-parity.test.ts).
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  },
}));
vi.mock('@/lib/intelligence/rate-limiter', () => ({
  getGlobalRateLimiter: () => ({}),
  RateLimitError: class RateLimitError extends Error {},
}));

import { normaliseUrl } from '@/lib/extraction/url-normalise';

// ---------------------------------------------------------------------------
// Deterministic id derivation (mirror of flow.py's uuid5 mint)
// ---------------------------------------------------------------------------

/**
 * Mirror of `flow.py::_KH_PIPELINE_DOC_NS` — the pinned namespace for the
 * pipeline's deterministic per-document uuid5 PKs.
 */
const KH_PIPELINE_DOC_NS = 'fbfaf1ff-1ee4-583c-9757-1674465b2ec1';

/** RFC 4122 v5 (SHA-1) uuid — no external dependency. */
function uuid5(namespace: string, name: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const digest = createHash('sha1')
    .update(nsBytes)
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

const sdIdFor = (normalisedUrl: string) =>
  uuid5(KH_PIPELINE_DOC_NS, `sd:${normalisedUrl}`);
const riIdFor = (normalisedUrl: string) =>
  uuid5(KH_PIPELINE_DOC_NS, `ri:${normalisedUrl}`);
const ciIdFor = (normalisedUrl: string) =>
  uuid5(KH_PIPELINE_DOC_NS, `ci:${normalisedUrl}`);

// ---------------------------------------------------------------------------
// Pure derivation suite — runs everywhere (no env gate)
// ---------------------------------------------------------------------------

describe('uuid5 id derivation parity (flow.py mint mirror)', () => {
  // Pinned against python: uuid.uuid5(UUID('fbfaf1ff-…'), 'sd:…') etc. —
  // drift in the TS uuid5 port breaks loudly without a live DB.
  const NORMALISED = 'https://example.com/';

  it('derives the sd: id', () => {
    expect(sdIdFor(NORMALISED)).toBe('bd2e928c-86ab-5777-862b-7107e7dbc21d');
  });

  it('derives the ri: id', () => {
    expect(riIdFor(NORMALISED)).toBe('bd5595b0-90be-50ee-9d4b-3793fb6353ba');
  });

  it('derives the ci: id', () => {
    expect(ciIdFor(NORMALISED)).toBe('ba78bd26-c2f8-50bd-a3ad-c4caa1b48ac7');
  });

  it('normalises the default proof URL to itself', () => {
    expect(normaliseUrl('https://example.com/')).toBe(NORMALISED);
    expect(normaliseUrl('https://example.com')).toBe(NORMALISED);
  });
});

// ---------------------------------------------------------------------------
// Live landing-set suite — gated on live creds + the explicit proof URL
// ---------------------------------------------------------------------------

const PROOF_URL = process.env.COCOINDEX_URL_VERIFY_URL ?? '';
const HAS_LIVE_DB = hasRealLiveDbCredentials();
const ENABLED = HAS_LIVE_DB && Boolean(PROOF_URL);

describe.skipIf(!ENABLED)('URL landing set (ID-75 TECH §5)', () => {
  const normalised = PROOF_URL ? normaliseUrl(PROOF_URL) : '';
  const sdId = normalised ? sdIdFor(normalised) : '';
  const riId = normalised ? riIdFor(normalised) : '';

  let client: Awaited<ReturnType<typeof createLiveServiceClient>>;

  beforeAll(async () => {
    client = await createLiveServiceClient();
  });

  it('lands the source_documents half of the evidence pair (§5.1)', async () => {
    const { data, error } = await client
      .from('source_documents')
      .select(
        'id, source_url, storage_path, filename, mime_type, file_size, extraction_method',
      )
      .eq('id', sdId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const sd = data![0]!;
    expect(sd.source_url).toBe(normalised);
    expect(sd.storage_path).toBe(normalised);
    expect(sd.filename).toBeTruthy();
    expect(sd.mime_type).toBeTruthy();
    expect(sd.file_size).toBeGreaterThan(0);
    // ID-112.7: the URL HTML path extracts in-process via Trafilatura; the PDF
    // path stamps 'docling'. Either is valid for the proof URL.
    expect(sd.extraction_method).toMatch(/^(trafilatura|docling)$/);
  });

  it('lands the reference_items half of the evidence pair (§5.2)', async () => {
    const { data, error } = await client
      .from('reference_items')
      .select(
        'id, body, embedding, source_document_id, ingestion_source, published_at, source_url',
      )
      .eq('id', riId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const ri = data![0]!;
    expect(ri.source_url).toBe(normalised);
    expect(ri.body).toBeTruthy(); // non-empty extracted body
    expect(ri.embedding).not.toBeNull(); // whole-record embedding (BI-17)
    expect(ri.source_document_id).toBe(sdId);
    expect(ri.ingestion_source).toBe('rss_feed');

    // published_at round-trips the seeded ledger value: the pipeline takes
    // the LATEST ledger row's published_at (UrlItem D-10), so compare to
    // the max-ingested_at ledger row for this URL.
    const { data: ledger, error: ledgerError } = await client
      .from('feed_articles')
      .select('published_at')
      .eq('external_url', normalised)
      .order('ingested_at', { ascending: false })
      .limit(1);
    expect(ledgerError).toBeNull();
    expect(ledger).toHaveLength(1);
    const seeded = ledger![0]!.published_at;
    expect(seeded).toBeTruthy();
    expect(new Date(ri.published_at as string).getTime()).toBe(
      new Date(seeded as string).getTime(),
    );
  });

  // ID-131.19 M6 retirement: `content_items` was DROPPED at M6 with no
  // replacement table. This block's entire subject — proving the URL
  // pipeline lands ZERO content_items rows (as opposed to the
  // source_documents/reference_items evidence pair) — is now moot: the
  // table it queried no longer exists, so a live `.from('content_items')`
  // call would error (relation does not exist) rather than legitimately
  // return a zero count. Removed rather than redirected to
  // `source_documents`, since there is no destination table for a
  // "this table has zero rows" assertion once the table itself is gone.

  it('backlinks every ledger row to the ri id with content_item_id NULL (§5.4)', async () => {
    // {75.17} two-walk contract: walk 1 ALWAYS defers this backlink (the
    // engine flushes the ri row only after the component returns); it lands
    // on walk 2's re-run. The driver's second-walk leg ran before this
    // suite, so the converged state is asserted here.
    const { data, error } = await client
      .from('feed_articles')
      .select('id, reference_item_id, content_item_id, passed')
      .eq('external_url', normalised);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
    for (const row of data!) {
      expect(row.reference_item_id).toBe(riId);
      expect(row.content_item_id).toBeNull();
    }
  });

  it('holds exactly-one row counts post-second-walk (§5.5 idempotency)', async () => {
    // The driver's second-walk leg ran inside the same invocation; a broken
    // idempotency path would mint duplicate rows under fresh PKs (the uuid5
    // PK forbids same-key duplicates), so count-by-natural-key is the
    // duplicate detector. The id-equality assertions above are the
    // PKs-unchanged proof (deterministic uuid5 of the URL).
    const { count: sdCount, error: sdError } = await client
      .from('source_documents')
      .select('id', { count: 'exact', head: true })
      .eq('source_url', normalised);
    expect(sdError).toBeNull();
    expect(sdCount).toBe(1);

    const { count: riCount, error: riError } = await client
      .from('reference_items')
      .select('id', { count: 'exact', head: true })
      .eq('source_url', normalised);
    expect(riError).toBeNull();
    expect(riCount).toBe(1);

    const { count: riBySd, error: riBySdError } = await client
      .from('reference_items')
      .select('id', { count: 'exact', head: true })
      .eq('source_document_id', sdId);
    expect(riBySdError).toBeNull();
    expect(riBySd).toBe(1);
  });
});
