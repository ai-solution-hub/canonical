/**
 * Integration test — ID-75 TECH §5 landing set (the {62.10} URL proof).
 *
 * Subtask ID-62.10 (S319 — URL-mode verify driver companion).
 *
 * SELF-DRIVING SINCE S524 (id-46 {46.12}). This file used to assert against
 * state seeded by a separate host-side Python tool
 * (deploy/onprem/verify/verify_driver.py), which an operator had to remember
 * to run first — so the suite skipped on every automated run and the URL
 * landing path was proven exactly once, manually, at S319. The driver had no
 * runtime caller and was deleted; its seed step is now
 * `_helpers/url-landing-seed.ts` and its walk step is `runWalk()`, both
 * invoked from this file's beforeAll. The landing poll and idempotency
 * assertions were always this file's job (ID-62 Inv-22) and are unchanged.
 *
 * This file asserts the EVIDENCE PAIR the walk must land — explicitly
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
 *   3. (retired) The "ZERO content_items rows" leg went with the table:
 *      ID-131 M6 dropped content_items outright, so there is no longer
 *      anything to count. See the tombstone comment further down.
 *   4. feed_articles backlink: reference_item_id = the ri id. The companion
 *      "AND content_item_id IS NULL" leg went with the COLUMN — ID-131 M6
 *      dropped feed_articles.content_item_id
 *      (20260706110000_id131_drops.sql STEP 4). TWO-WALK TIMING ({75.17}):
 *      the in-component backlink write races the engine's post-return
 *      ri_target flush, so walk 1 defers it (structured
 *      cocoindex.url_backlink_deferred log) and the backlink CONVERGES on
 *      walk 2 — which is why beforeAll runs TWO walks, not one. Dropping
 *      the second walk invalidates 4 and 5.
 *   5. Idempotency (post-second-walk): row counts unchanged (exactly one
 *      sd, exactly one ri) and PKs unchanged (the deterministic uuid5 ids
 *      ARE the PK-stability proof).
 *
 * Env-gate (live assertions): real Supabase service-role credentials
 * (Inv-27 — reachable from anywhere) AND the walk env the sidecar needs
 * (COCOINDEX_STAGING_URL + PIPELINE_TRIGGER_SECRET). Both are set by the
 * nightly job, so this suite now RUNS there; it stays skip-clean off-host
 * and in the PR integration job, which has live staging creds but no
 * sidecar to walk. The uuid5-derivation suite at the top is pure and runs
 * everywhere (typed-shape coverage off-host).
 *
 * COCOINDEX_URL_VERIFY_URL overrides the proof URL; it is no longer the gate.
 *
 * References:
 *   - the ID-75 URL-cocoindex spec, TECH.md §5 (landing-set contract).
 *   - docs/specs/id-62-fixture-staging-infra/TECH.md Inv-22/23/27. (Inv-21's
 *     "one primitive, two parameterisations" framing described two files
 *     that shared no code; retired S524 with the second file.)
 *   - scripts/cocoindex_pipeline/flow.py (_KH_PIPELINE_DOC_NS + uuid5 mint).
 *   - docs/reference/testing/test-philosophy.md (behaviour-not-implementation).
 */

import { createHash } from 'node:crypto';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../helpers/supabase-client';
import {
  DEFAULT_PROOF_URL,
  seedUrlLandingLedgerRow,
} from './_helpers/url-landing-seed';
import { runWalk } from './_helpers/walk';

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

const PROOF_URL = process.env.COCOINDEX_URL_VERIFY_URL ?? DEFAULT_PROOF_URL;
const HAS_LIVE_DB = hasRealLiveDbCredentials();
/** The sidecar the walk legs need — set by the nightly job, absent elsewhere. */
const HAS_WALK_ENV = Boolean(
  (process.env.COCOINDEX_STAGING_URL ??
    process.env.COCOINDEX_FIXTURE_STAGING_URL) &&
  process.env.PIPELINE_TRIGGER_SECRET,
);
const ENABLED = HAS_LIVE_DB && HAS_WALK_ENV;

describe.skipIf(!ENABLED)('URL landing set (ID-75 TECH §5)', () => {
  const normalised = normaliseUrl(PROOF_URL);
  const sdId = sdIdFor(normalised);
  const riId = riIdFor(normalised);

  let client: Awaited<ReturnType<typeof createLiveServiceClient>>;

  // Seed → walk → walk. The second walk is NOT belt-and-braces: {75.17}'s
  // backlink defers on walk 1 by design and converges on walk 2, so §5.4 and
  // §5.5 below are only meaningful after it.
  //
  // Budget: two walks at the helper's 300s default, plus the seed. The
  // per-hook budget must exceed the walks it awaits — the inverted-budget
  // defect W6/id-415 is fixing elsewhere in this suite.
  beforeAll(async () => {
    client = await createLiveServiceClient();
    await seedUrlLandingLedgerRow(client, normalised);
    await runWalk();
    await runWalk();
  }, 660_000);

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
        'id, body, source_document_id, ingestion_source, published_at, source_url',
      )
      .eq('id', riId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const ri = data![0]!;
    expect(ri.source_url).toBe(normalised);
    expect(ri.body).toBeTruthy(); // non-empty extracted body
    expect(ri.source_document_id).toBe(sdId);
    expect(ri.ingestion_source).toBe('rss_feed');

    // Whole-record embedding (BI-17) — reference_items.embedding was
    // DROPPED by migration 20260706120000_id131_drop_inline_vector_cols
    // (DR-036); the vector lands on record_embeddings keyed
    // (owner_kind='reference_item', owner_id = ri id).
    const { data: embRows, error: embError } = await client
      .from('record_embeddings')
      .select('id, embedding')
      .eq('owner_kind', 'reference_item')
      .eq('owner_id', riId)
      .limit(1);
    expect(embError).toBeNull();
    expect(embRows).not.toBeNull();
    expect(embRows!.length).toBeGreaterThan(0);
    expect(embRows![0]!.embedding).not.toBeNull();

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

  it('backlinks every ledger row to the ri id (§5.4)', async () => {
    // {75.17} two-walk contract: walk 1 ALWAYS defers this backlink (the
    // engine flushes the ri row only after the component returns); it lands
    // on walk 2's re-run. The driver's second-walk leg ran before this
    // suite, so the converged state is asserted here.
    //
    // The companion `content_item_id IS NULL` assertion is gone with the
    // column: ID-131 M6 dropped feed_articles.content_item_id
    // (20260706110000_id131_drops.sql STEP 4), so selecting it errored the
    // whole query rather than testing anything.
    const { data, error } = await client
      .from('feed_articles')
      .select('id, reference_item_id, passed')
      .eq('external_url', normalised);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(1);
    for (const row of data!) {
      expect(row.reference_item_id).toBe(riId);
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
