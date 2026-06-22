/**
 * Tests for POST /api/ingest/url — reference-layer ingest (ID-110 {110.6}).
 *
 * Verifies the re-pointed route lands the ID-75 evidence pair via the
 * `reference_ingest` RPC and NO LONGER writes content_items:
 *   - Fresh URL → 2xx, calls reference_ingest, response carries id + title and
 *     OMITS suggested_layer / content_type / duplicate_matches (TECH §3.3).
 *   - Classifiable URL populates primary_domain/subtopic (DELTA c
 *     populate-unless-error); classifier throw → null, no 500.
 *   - Path-less URL (https://host/) → non-empty filename (host), no 500
 *     (source_documents.filename NOT NULL — ENG-FIX).
 *   - Pre-seeded URL → url_already_exists.
 *   - SSRF-rejected URL → 400. Sub-100-char extraction → 422.
 *   - ZERO content_items writes on the success path.
 *
 * Plus the spec-mandated uuid5 identity-parity assertion (TECH §1 L358): the
 * server-minted reference_id must equal the Python pipeline uuid5 for the same
 * normalised URL — proven here against the known fixture without a DB round-trip
 * by computing RFC-4122 v5 (SHA-1) in-process, the same algorithm
 * extensions.uuid_generate_v5 and Python uuid.uuid5 both implement.
 *
 * Spec: specs/id-110-url-import-reference-items/TECH.md §1-§3.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Module mocks. The route lazy-imports extraction / embed / classify, so these
// mocks must be in place before the dynamic import resolves.
// ---------------------------------------------------------------------------
vi.mock('@/lib/auth/client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth/client')>(
      '@/lib/auth/client',
    );
  return { ...actual, getAuthorisedClient: vi.fn() };
});

// Rate-limit is mocked so the front-matter 429 branch (migrated from the
// retired ingest-url.test.ts) is deterministic. Default: allowed.
const { mockCheckRateLimit } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));

vi.mock('@/lib/extraction/url-validation', () => ({
  validateUrl: vi.fn(() => ({ valid: true })),
}));

// {112.11}: normaliseUrl relocated from content-extractor to
// @/lib/extraction/url-normalise. The route imports it from the new home.
// Identity normalisation is sufficient for the route tests; the real
// normaliseUrl is unit-tested in its own suite.
vi.mock('@/lib/extraction/url-normalise', () => ({
  normaliseUrl: vi.fn((u: string) => u),
}));

// {112.10}: the route now owns the SSRF-gated fetch (fetchForExtraction) +
// local metadata (extractHtmlMetadata) and hands HTML to the B1 /extract pure
// cleaner (cleanViaWorker). PDF stays in-process via extractPdfText.
vi.mock('@/lib/extraction/url', () => ({
  fetchForExtraction: vi.fn(),
  extractHtmlMetadata: vi.fn(),
}));
vi.mock('@/lib/extraction/clean-via-worker', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/extraction/clean-via-worker')
  >('@/lib/extraction/clean-via-worker');
  return { ...actual, cleanViaWorker: vi.fn() };
});
vi.mock('@/lib/extraction/pdf', () => ({ extractPdfText: vi.fn() }));
vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
}));
vi.mock('@/lib/ai/classify', () => ({ classifyText: vi.fn() }));

import { POST } from '@/app/api/ingest/url/route';
import { getAuthorisedClient } from '@/lib/auth/client';
import { validateUrl } from '@/lib/extraction/url-validation';
import { fetchForExtraction, extractHtmlMetadata } from '@/lib/extraction/url';
import {
  cleanViaWorker,
  ExtractEndpointError,
} from '@/lib/extraction/clean-via-worker';
import { extractPdfText } from '@/lib/extraction/pdf';
import { classifyText } from '@/lib/ai/classify';

const getAuthorisedClientMock = vi.mocked(getAuthorisedClient);
const validateUrlMock = vi.mocked(validateUrl);
const fetchForExtractionMock = vi.mocked(fetchForExtraction);
const extractHtmlMetadataMock = vi.mocked(extractHtmlMetadata);
const cleanViaWorkerMock = vi.mocked(cleanViaWorker);
const extractPdfTextMock = vi.mocked(extractPdfText);
const classifyTextMock = vi.mocked(classifyText);

const EDITOR_USER_ID = 'b0000000-0000-4000-8000-000000000bbb';
const REF_ID = 'ac261849-c4e5-5a28-970b-4a063146ad2a';
const SD_ID = 'aaaaaaaa-0000-4000-8000-00000000sd00';

type MockClient = ReturnType<typeof createMockSupabaseClient>;

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/ingest/url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Default HTML metadata the route derives locally (no Readability). */
function makeHtmlMetadata(over: Record<string, unknown> = {}) {
  return {
    title: 'Example Page',
    author: '',
    excerpt: 'A short excerpt.',
    ogImage: '',
    ogDescription: '',
    ogDate: '',
    ...over,
  };
}

/** Configure the mock client as an authenticated editor for this route. */
function configureEditorAuth(client: MockClient) {
  getAuthorisedClientMock.mockResolvedValue({
    success: true,
    user: { id: EDITOR_USER_ID, email: 'editor@test', user_metadata: {} },
    supabase: client,
    role: 'editor',
  } as never);
}

/** Make the reference_ingest RPC return one freshly-minted row. */
function configureRpcFresh(client: MockClient) {
  client.rpc.mockResolvedValue({
    data: [
      {
        reference_id: REF_ID,
        source_document_id: SD_ID,
        title: 'Example Page',
        summary: 'A short excerpt.',
        source_url: 'https://example.com/a',
        primary_domain: null,
        primary_subtopic: null,
        already_existed: false,
      },
    ],
    error: null,
  });
}

describe('POST /api/ingest/url — reference-layer ingest (ID-110 {110.6})', () => {
  let client: MockClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockSupabaseClient();
    configureEditorAuth(client);
    mockCheckRateLimit.mockReturnValue({
      allowed: true,
      remaining: 9,
      resetAt: Date.now() + 60_000,
    });
    validateUrlMock.mockReturnValue({ valid: true });
    // Default: an HTML fetch landing on the same URL, cleaned to 800 chars (OK).
    fetchForExtractionMock.mockResolvedValue({
      kind: 'html',
      html: '<html><body><article>content</article></body></html>',
      finalUrl: 'https://example.com/a',
    });
    extractHtmlMetadataMock.mockReturnValue(makeHtmlMetadata());
    cleanViaWorkerMock.mockResolvedValue({
      text: 'x'.repeat(800),
      verdict: 'ok',
      warnings: [],
    });
    classifyTextMock.mockResolvedValue({
      primary_domain: 'cyber-security',
      primary_subtopic: 'iso-27001',
    });
    // URL-exists check resolves to "not found" by default.
    client._chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    configureRpcFresh(client);
  });

  it('lands the reference via reference_ingest and never writes content_items', async () => {
    const res = await POST(
      makeRequest({ url: 'https://example.com/a' }) as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();

    // Wrote via the RPC...
    expect(client.rpc).toHaveBeenCalledWith(
      'reference_ingest',
      expect.objectContaining({ p_source_url: 'https://example.com/a' }),
    );
    // ...and NEVER touched content_items.
    const tablesTouched = client.from.mock.calls.map((c) => c[0]);
    expect(tablesTouched).not.toContain('content_items');

    // Response carries id + title from the RPC row.
    expect(json.id).toBe(REF_ID);
    expect(json.title).toBe('Example Page');
    expect(json.source_url).toBe('https://example.com/a');
    expect(json.dedup_status).toBe('clean');
  });

  it('cleans HTML via the B1 /extract endpoint and records trafilatura provenance (PI-9/PI-11)', async () => {
    const res = await POST(
      makeRequest({ url: 'https://example.com/a' }) as never,
    );
    expect(res.status).toBe(200);

    // The route fetched the HTML itself, then handed it to cleanViaWorker with
    // the post-redirect final URL (NOT re-fetched on B1).
    expect(cleanViaWorkerMock).toHaveBeenCalledWith(
      '<html><body><article>content</article></body></html>',
      'https://example.com/a',
    );

    // extraction_metadata.extractor carries 'trafilatura' so the {112.9} RPC
    // derivation writes extraction_method='trafilatura' (was 'readability').
    const rpcArgs = client.rpc.mock.calls[0][1] as {
      p_mime_type: string;
      p_body: string;
      p_extraction_metadata: Record<string, unknown>;
    };
    expect(rpcArgs.p_extraction_metadata).toMatchObject({
      extractor: 'trafilatura',
      via: 'app_sync_url_import',
    });
    // text/html mime for the HTML path; body is the Trafilatura-cleaned text.
    expect(rpcArgs.p_mime_type).toBe('text/html');
    expect(rpcArgs.p_body).toBe('x'.repeat(800));
  });

  it('surfaces a WARN-verdict warning from /extract on the response (PI-5)', async () => {
    cleanViaWorkerMock.mockResolvedValueOnce({
      text: 'x'.repeat(200),
      verdict: 'warn',
      warnings: ['Limited text extracted from this page.'],
    });
    const res = await POST(
      makeRequest({ url: 'https://example.com/a' }) as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warnings).toEqual(
      expect.arrayContaining(['Limited text extracted from this page.']),
    );
  });

  it('returns a recoverable 503 (NOT 500) when /extract is unreachable — no Readability fallback (SOFT-COUPLE)', async () => {
    cleanViaWorkerMock.mockRejectedValueOnce(
      new ExtractEndpointError('/extract endpoint unreachable: ECONNREFUSED'),
    );
    const res = await POST(
      makeRequest({ url: 'https://example.com/a' }) as never,
    );
    expect(res.status).toBe(503);
    // No in-process Readability fallback (it would keep @mozilla/readability
    // alive past the {112.13} deletion) and NO reference written.
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('OMITS the dropped content_items affordances from the response (TECH §3.3)', async () => {
    const res = await POST(
      makeRequest({ url: 'https://example.com/a' }) as never,
    );
    const json = await res.json();
    expect(json).not.toHaveProperty('suggested_layer');
    expect(json).not.toHaveProperty('content_type');
    expect(json).not.toHaveProperty('topic_suggestion');
    expect(json).not.toHaveProperty('guide_section_suggestions');
    expect(json).not.toHaveProperty('duplicate_matches');
  });

  it('populates primary_domain/subtopic from the classifier (DELTA c)', async () => {
    await POST(makeRequest({ url: 'https://example.com/a' }) as never);
    expect(client.rpc).toHaveBeenCalledWith(
      'reference_ingest',
      expect.objectContaining({
        p_primary_domain: 'cyber-security',
        p_primary_subtopic: 'iso-27001',
      }),
    );
  });

  it('passes NULL domain/subtopic when the classifier throws (populate-UNLESS-error)', async () => {
    classifyTextMock.mockRejectedValueOnce(new Error('classifier down'));
    const res = await POST(
      makeRequest({ url: 'https://example.com/a' }) as never,
    );
    expect(res.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith(
      'reference_ingest',
      expect.objectContaining({
        p_primary_domain: null,
        p_primary_subtopic: null,
      }),
    );
    const json = await res.json();
    expect(json.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Classification failed'),
      ]),
    );
  });

  it('derives a non-empty filename (host) for a path-less URL — no 500 (ENG-FIX)', async () => {
    const res = await POST(
      makeRequest({ url: 'https://example.com/' }) as never,
    );
    expect(res.status).toBe(200);
    const rpcArgs = client.rpc.mock.calls[0][1] as { p_filename: string };
    expect(rpcArgs.p_filename).toBe('example.com');
    expect(rpcArgs.p_filename.length).toBeGreaterThan(0);
  });

  it('keeps the PDF path in-process via unpdf (application/pdf, extractor unpdf) — never calls /extract', async () => {
    fetchForExtractionMock.mockResolvedValueOnce({
      kind: 'pdf',
      buffer: new Uint8Array([1, 2, 3]).buffer,
      finalUrl: 'https://example.com/a.pdf',
    });
    extractPdfTextMock.mockResolvedValueOnce({
      text: 'y'.repeat(800),
      pageCount: 3,
    });
    await POST(makeRequest({ url: 'https://example.com/a.pdf' }) as never);
    // PDF body cleaned in-process — the pure cleaner is HTML-only.
    expect(extractPdfTextMock).toHaveBeenCalledTimes(1);
    expect(cleanViaWorkerMock).not.toHaveBeenCalled();
    const rpcArgs = client.rpc.mock.calls[0][1] as {
      p_mime_type: string;
      p_extraction_metadata: Record<string, unknown>;
    };
    expect(rpcArgs.p_mime_type).toBe('application/pdf');
    expect(rpcArgs.p_extraction_metadata).toMatchObject({
      extractor: 'unpdf',
      via: 'app_sync_url_import',
      page_count: 3,
    });
  });

  it('returns url_already_exists when the URL is already a reference', async () => {
    client._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: REF_ID, title: 'Existing Ref' },
      error: null,
    });
    const res = await POST(
      makeRequest({ url: 'https://example.com/a' }) as never,
    );
    const json = await res.json();
    expect(json.url_already_exists).toBe(true);
    expect(json.existing_item).toEqual({ id: REF_ID, title: 'Existing Ref' });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('rejects an SSRF-blocked URL with 400', async () => {
    validateUrlMock.mockReturnValueOnce({
      valid: false,
      error: 'Blocked host',
    });
    const res = await POST(
      makeRequest({ url: 'http://169.254.169.254/' }) as never,
    );
    expect(res.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns 422 when /extract returns a REJECT verdict (content too short) — distinct from the 503 outage', async () => {
    cleanViaWorkerMock.mockResolvedValueOnce({
      text: 'tiny',
      verdict: 'reject',
      warnings: [],
    });
    const res = await POST(
      makeRequest({ url: 'https://example.com/a' }) as never,
    );
    expect(res.status).toBe(422);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Front-matter: auth + rate-limit + body validation.
  //
  // Migrated from the retired __tests__/api/ingest-url.test.ts (ID-110 {110.6}
  // stale-test retirement). These behaviours are unchanged by the reference
  // re-point — they all guard BEFORE any reference_ingest write — so they are
  // re-asserted here against the current contract: a 4xx short-circuit must
  // never reach the RPC. (SSRF-400 and url_already_exists are covered above.)
  // -------------------------------------------------------------------------

  it('returns authFailureResponse (401) BEFORE any extraction call when unauthenticated', async () => {
    getAuthorisedClientMock.mockResolvedValueOnce({
      success: false,
      reason: 'unauthenticated',
    } as never);
    const res = await POST(
      makeRequest({ url: 'https://example.com/a' }) as never,
    );
    expect(res.status).toBe(401);
    // The auth gate short-circuits before any fetch/clean — never reaches B1.
    expect(fetchForExtractionMock).not.toHaveBeenCalled();
    expect(cleanViaWorkerMock).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller lacks the editor/admin role', async () => {
    getAuthorisedClientMock.mockResolvedValueOnce({
      success: false,
      reason: 'forbidden',
    } as never);
    const res = await POST(
      makeRequest({ url: 'https://example.com/a' }) as never,
    );
    expect(res.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns 429 when the per-user rate limit is exhausted', async () => {
    mockCheckRateLimit.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });
    const res = await POST(
      makeRequest({ url: 'https://example.com/a' }) as never,
    );
    expect(res.status).toBe(429);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns 400 when the body omits the url field', async () => {
    const res = await POST(makeRequest({}) as never);
    expect(res.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns 400 when the url is not a valid URL', async () => {
    const res = await POST(makeRequest({ url: 'not-a-url' }) as never);
    expect(res.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// uuid5 identity-parity (spec-mandated, TECH §1 L358).
// ---------------------------------------------------------------------------

/**
 * Compute an RFC-4122 v5 (SHA-1) UUID — the identical algorithm to Postgres
 * extensions.uuid_generate_v5 and Python uuid.uuid5. Self-contained (no `uuid`
 * npm dependency) so this is a deterministic unit assertion, not a staging
 * round-trip.
 */
function uuid5(namespace: string, name: string): string {
  const nsHex = namespace.replace(/-/g, '');
  const nsBytes = Buffer.from(nsHex, 'hex');
  const hash = createHash('sha1')
    .update(nsBytes)
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC-4122 variant
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

describe('reference_ingest uuid5 identity parity (TECH §1 L358)', () => {
  // _KH_PIPELINE_DOC_NS — pinned in scripts/cocoindex_pipeline/flow.py:1601 and
  // in migration 20260614010200_id110_reference_ingest_rpc.sql.
  const NS = 'fbfaf1ff-1ee4-583c-9757-1674465b2ec1';

  it('mints the known reference_id for ri:https://example.com/a', () => {
    // The RPC mints reference_item_id = uuid5(NS, 'ri:' || normalised_url).
    expect(uuid5(NS, 'ri:https://example.com/a')).toBe(
      'ac261849-c4e5-5a28-970b-4a063146ad2a',
    );
  });

  it('mints a stable, distinct source_document_id for the same URL', () => {
    const sd = uuid5(NS, 'sd:https://example.com/a');
    const ri = uuid5(NS, 'ri:https://example.com/a');
    expect(sd).not.toBe(ri);
    // Determinism: same name → same id (idempotency foundation).
    expect(uuid5(NS, 'sd:https://example.com/a')).toBe(sd);
  });
});
