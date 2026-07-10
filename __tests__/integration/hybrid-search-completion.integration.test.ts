/**
 * ID-144 {144.8} — hybrid_search RPC completion: end-to-end acceptance
 * (real Supabase). Runs under `bun run test:integration`, NEVER `bun test`
 * or the mocked `bun run test` suite — the RPC body is PL/pgSQL and a mock
 * cannot execute it (TECH §4).
 *
 * Spec: docs-site specs/id-144-hybrid-search-completion/TECH.md §2/§4/§5
 * (S460-ratified). Cites DR-050 (owner_kind is the grain discriminator;
 * content_type stays editorial), DR-051 (per-grain date-anchor mapping +
 * STRICT-EXCLUDE NULL handling), DR-052 (12-arg positional-param cap) —
 * these are cited, not re-litigated (already ratified in TECH §8).
 *
 * Covers (TECH §4 verification table):
 *   - OD-1: scope_tag (q_a_pair arm) + source_url (reference_item arm)
 *     project through (previously hard-coded []/null at the read boundary).
 *   - OD-2/BI-14: owner_kind is a dedicated grain-discriminator column,
 *     distinct from the editorial content_type column (arm 1 only).
 *   - BI-15: filter_kind narrows server-side, BEFORE the LIMIT (the OBS-4
 *     regression this fixes: a client-side post-LIMIT filter could return
 *     fewer than a full page even when more matches of the requested kind
 *     existed).
 *   - BI-16: filter_domain / filter_subtopic / filter_date_from / _to bound
 *     the result set; filter_subtopic naturally excludes the q_a_pair grain
 *     (no subtopic column on that arm); STRICT-EXCLUDE drops undated rows
 *     once a date bound is set.
 *   - BI-10/BI-20: the all-NULL default is unnarrowed (all grains returned)
 *     and the limit-raising load-more produces stable, dupe-free pages
 *     (the bl-431 OBS-3 `ORDER BY similarity DESC, id` tie-breaker).
 *   - API-layer PGRST202 guard: POST /api/search threads kind/domain/date
 *     through to `api.hybrid_search` — proves the wrapper regen + the
 *     supabase-js `api` schema resolution (DR-030/DR-032); a stale wrapper
 *     would PGRST202 or silently ignore the new params.
 *
 * Design notes:
 *   - RPC-direct assertions use a SYNTHETIC (random) 1024-dim vector for
 *     every `record_embeddings` row AND every `query_embedding` param —
 *     inclusion is guaranteed via the RPC's text-match OR-branch
 *     (`query_text <> '' AND ... ILIKE '%...%'`), so no real embedding-model
 *     call is needed for the RPC-direct groups. The BI-20 pagination group
 *     deliberately reuses the SAME vector + near-identical text across all
 *     seeded rows to force an exact similarity TIE, which is what actually
 *     exercises the id tie-breaker (rather than relying on incidental
 *     floating-point luck).
 *   - The API-layer group calls the real `/api/search` route, which calls
 *     the real `generateEmbedding()` (OpenAI) — that one real embedding
 *     call is unavoidable when testing the production route end-to-end.
 *   - Every marker is a unique, group-prefixed string derived from a
 *     per-run TEST_TAG (`Date.now()`), so `query_text` ILIKE matches never
 *     cross-contaminate between describe blocks or prior/parallel runs.
 *   - Cleanup (afterAll) deletes in FK-safe order: record_embeddings (no FK,
 *     but must be deleted explicitly) → reference_items (FK RESTRICT to
 *     source_documents) → q_a_pairs → source_documents. record_lifecycle
 *     rows are NOT deleted explicitly — both owner FKs CASCADE.
 *
 * Prerequisites: `.env`/`.env.local` with NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 * TEST_USER_1_PASSWORD (admin, for the API-layer group).
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
// service-client MUST be imported first — it loads dotenv for all env vars
// (mirrors every other file in this directory, e.g. supersession-filter).
import { serviceClient } from './helpers/service-client';
import {
  signInAsTestUser,
  type AuthCookieStore,
  type AuthCookieEntry,
} from './helpers/auth-session';

// ---------------------------------------------------------------------------
// API-layer group setup: mock `next/headers` at file scope (hoisted) so the
// production `getAuthenticatedClient` → `createClient` → cookie path runs
// against a real session, then import the route AFTER the mock is
// registered. Mirrors display-name-routes.integration.test.ts.
// ---------------------------------------------------------------------------

const { authCookies } = vi.hoisted(() => ({
  authCookies: new Map<
    string,
    { name: string; value: string }
  >() as AuthCookieStore,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () =>
      Array.from(authCookies.values()).map(
        ({ name, value }): AuthCookieEntry => ({ name, value }),
      ),
    get: (name: string) => authCookies.get(name),
    set: (name: string, value: string) => {
      authCookies.set(name, { name, value });
    },
  }),
}));

const { POST: searchPost } = await import('@/app/api/search/route');

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Fixtures / constants
// ---------------------------------------------------------------------------

const TEST_TAG = `id144-${Date.now()}`;
const EMBEDDING_MODEL = 'text-embedding-3-large';
/** Safely in the past — never falls inside any narrow date-range assertion below. */
const DEFAULT_DATE = '2020-01-01T00:00:00.000Z';

function makeVector(length = 1024): number[] {
  return Array.from({ length }, () => Math.random() * 2 - 1);
}

const SHARED_VECTOR_STR = JSON.stringify(makeVector());

interface HybridSearchRow {
  id: string;
  owner_kind: string;
  content_type: string;
  scope_tag: string[] | null;
  source_url: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Seeded-row registry + cleanup (FK-safe order — see file header)
// ---------------------------------------------------------------------------

const seeded = {
  qaPairIds: [] as string[],
  referenceItemIds: [] as string[],
  sourceDocumentIds: [] as string[],
};

afterAll(async () => {
  if (seeded.qaPairIds.length) {
    await serviceClient
      .from('record_embeddings')
      .delete()
      .eq('owner_kind', 'q_a_pair')
      .in('owner_id', seeded.qaPairIds);
  }
  if (seeded.referenceItemIds.length) {
    await serviceClient
      .from('record_embeddings')
      .delete()
      .eq('owner_kind', 'reference_item')
      .in('owner_id', seeded.referenceItemIds);
    await serviceClient
      .from('reference_items')
      .delete()
      .in('id', seeded.referenceItemIds);
  }
  if (seeded.qaPairIds.length) {
    await serviceClient.from('q_a_pairs').delete().in('id', seeded.qaPairIds);
  }
  if (seeded.sourceDocumentIds.length) {
    await serviceClient
      .from('source_documents')
      .delete()
      .in('id', seeded.sourceDocumentIds);
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedQaPair(opts: {
  marker: string;
  scopeTag?: string[];
  validFrom?: string | null;
  /**
   * Links q_a_pairs.source_document_id (nullable, FK-less by design — ID-59
   * {sidecar}) to an existing source_documents row. record_lifecycle.domain
   * for a q_a_pair owner is NOT directly writable: `trg_record_lifecycle_
   * domain_sync` (BEFORE INSERT OR UPDATE on record_lifecycle) unconditionally
   * derives it from `q_a_pairs.source_document_id -> source_documents.
   * primary_domain` (COALESCE'd to 'unclassified' when unset) — any direct
   * `.update({ domain })` gets silently clobbered back by this trigger on the
   * very next write. Pointing this at a source_documents row with the desired
   * primary_domain is the only way to get a non-'unclassified' domain onto a
   * seeded q_a_pair's record_lifecycle facet.
   */
  sourceDocumentId?: string;
}): Promise<string> {
  const id = randomUUID();
  const insert = await serviceClient
    .from('q_a_pairs')
    .insert({
      id,
      question_text: `[${opts.marker}] integration test question (id-144.8)`,
      answer_standard: `[${opts.marker}] integration test answer covering hybrid_search completion (id-144.8).`,
      scope_tag: opts.scopeTag ?? [],
      publication_status: 'published',
      valid_from: opts.validFrom === undefined ? DEFAULT_DATE : opts.validFrom,
      source_document_id: opts.sourceDocumentId ?? null,
    })
    .select('id')
    .single();
  if (insert.error || !insert.data) {
    throw new Error(
      `seed q_a_pairs (${opts.marker}) failed: ${insert.error?.message ?? 'no data'}`,
    );
  }
  seeded.qaPairIds.push(id);

  const embInsert = await serviceClient.from('record_embeddings').insert({
    owner_kind: 'q_a_pair',
    owner_id: id,
    model: EMBEDDING_MODEL,
    embedding: SHARED_VECTOR_STR,
  });
  if (embInsert.error) {
    throw new Error(
      `seed record_embeddings for q_a_pair (${opts.marker}) failed: ${embInsert.error.message}`,
    );
  }

  return id;
}

async function seedSourceDocument(opts: {
  marker: string;
  contentType?: string | null;
  primaryDomain?: string;
  primarySubtopic?: string;
  capturedDate?: string | null;
}): Promise<string> {
  const id = randomUUID();
  const insert = await serviceClient
    .from('source_documents')
    .insert({
      id,
      filename: `${opts.marker}.md`,
      mime_type: 'text/markdown',
      file_size: 128,
      content_hash: `${opts.marker}-${randomUUID()}`,
      storage_path: `test/id-144.8/${opts.marker}.md`,
      status: 'processed',
      suggested_title: `[${opts.marker}] integration test document (id-144.8)`,
      content_type:
        opts.contentType === undefined ? 'article' : opts.contentType,
      publication_status: 'published',
      primary_domain: opts.primaryDomain ?? 'unclassified',
      primary_subtopic: opts.primarySubtopic ?? 'unclassified',
      captured_date:
        opts.capturedDate === undefined ? DEFAULT_DATE : opts.capturedDate,
    })
    .select('id')
    .single();
  if (insert.error || !insert.data) {
    throw new Error(
      `seed source_documents (${opts.marker}) failed: ${insert.error?.message ?? 'no data'}`,
    );
  }
  seeded.sourceDocumentIds.push(id);
  return id;
}

async function seedReferenceItem(opts: {
  marker: string;
  primaryDomain?: string;
  primarySubtopic?: string;
  publishedAt?: string;
}): Promise<{
  referenceId: string;
  sourceDocumentId: string;
  sourceUrl: string;
}> {
  const sourceUrl = `https://id144-test.example.com/${opts.marker}-${randomUUID()}`;
  const { data, error } = await serviceClient.rpc('reference_ingest', {
    p_source_url: sourceUrl,
    p_title: `[${opts.marker}] integration test reference (id-144.8)`,
    p_body: `[${opts.marker}] integration test reference body content for id-144.8 coverage.`,
    p_summary: `[${opts.marker}] integration test reference summary (id-144.8)`,
    p_primary_domain: opts.primaryDomain ?? 'unclassified',
    p_primary_subtopic: opts.primarySubtopic ?? 'unclassified',
    p_embedding: SHARED_VECTOR_STR,
    p_published_at: opts.publishedAt ?? DEFAULT_DATE,
    p_filename: `${opts.marker}.md`,
    p_mime_type: 'text/markdown',
    p_file_size: 128,
    p_content_hash: `${opts.marker}-refhash-${randomUUID()}`,
  });
  if (error || !data) {
    throw new Error(
      `seed reference_ingest (${opts.marker}) failed: ${error?.message ?? 'no data'}`,
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error(`seed reference_ingest (${opts.marker}) returned no row`);
  }
  seeded.referenceItemIds.push(row.reference_id);
  seeded.sourceDocumentIds.push(row.source_document_id);
  return {
    referenceId: row.reference_id,
    sourceDocumentId: row.source_document_id,
    sourceUrl,
  };
}

async function callHybridSearch(params: {
  queryText: string;
  limitCount?: number;
  filterKind?: 'answer' | 'document' | 'reference';
  filterDomain?: string;
  filterSubtopic?: string;
  filterDateFrom?: string;
  filterDateTo?: string;
}): Promise<HybridSearchRow[]> {
  const { data, error } = await serviceClient.rpc('hybrid_search', {
    query_embedding: SHARED_VECTOR_STR,
    query_text: params.queryText,
    similarity_threshold: 0,
    limit_count: params.limitCount ?? 20,
    filter_kind: params.filterKind,
    filter_domain: params.filterDomain,
    filter_subtopic: params.filterSubtopic,
    filter_date_from: params.filterDateFrom,
    filter_date_to: params.filterDateTo,
  });
  if (error) {
    throw new Error(`hybrid_search RPC failed: ${error.message}`);
  }
  return (data ?? []) as HybridSearchRow[];
}

// ---------------------------------------------------------------------------
// OD-1: scope_tag (q_a_pair) + source_url (reference_item) project through
// ---------------------------------------------------------------------------

describe('OD-1 projections: scope_tag (q_a_pair arm) + source_url (reference_item arm)', () => {
  const MARKER = `OD1${TEST_TAG}`;
  let qaId: string;
  let refId: string;
  let refUrl: string;

  beforeAll(async () => {
    qaId = await seedQaPair({ marker: MARKER, scopeTag: ['internal-it'] });
    const ref = await seedReferenceItem({ marker: MARKER });
    refId = ref.referenceId;
    refUrl = ref.sourceUrl;
  }, 30_000);

  it('projects the seeded scope_tag onto the answer row (previously hard-coded [])', async () => {
    const rows = await callHybridSearch({ queryText: MARKER });
    const qaRow = rows.find((r) => r.id === qaId);
    expect(qaRow).toBeDefined();
    expect(qaRow!.owner_kind).toBe('q_a_pair');
    expect(qaRow!.scope_tag).toEqual(['internal-it']);
  });

  it('projects the seeded source_url onto the reference row (previously hard-coded null)', async () => {
    const rows = await callHybridSearch({ queryText: MARKER });
    const refRow = rows.find((r) => r.id === refId);
    expect(refRow).toBeDefined();
    expect(refRow!.owner_kind).toBe('reference_item');
    expect(refRow!.source_url).toBe(refUrl);
  });
});

// ---------------------------------------------------------------------------
// OD-2 / BI-14: owner_kind is the grain discriminator; content_type stays
// editorial (DR-050) — the sd-arm conflation this Task resolves.
// ---------------------------------------------------------------------------

describe('OD-2/BI-14 owner_kind is a dedicated grain discriminator (DR-050)', () => {
  const MARKER = `OD2${TEST_TAG}`;
  let sdId: string;

  beforeAll(async () => {
    sdId = await seedSourceDocument({ marker: MARKER, contentType: 'article' });
  }, 30_000);

  it('arm-1 rows carry owner_kind=source_document while content_type keeps its real editorial value', async () => {
    const rows = await callHybridSearch({ queryText: MARKER });
    const sdRow = rows.find((r) => r.id === sdId);
    expect(sdRow).toBeDefined();
    expect(sdRow!.owner_kind).toBe('source_document');
    expect(sdRow!.content_type).toBe('article');
    expect(sdRow!.content_type).not.toBe('source_document');
  });
});

// ---------------------------------------------------------------------------
// BI-15: filter_kind narrows server-side, BEFORE the LIMIT (OBS-4 guard)
// ---------------------------------------------------------------------------

describe('BI-15 filter_kind narrows before LIMIT (OBS-4 regression guard)', () => {
  const MARKER = `BI15${TEST_TAG}`;
  const QA_COUNT = 4;
  const LIMIT = 3;
  const qaIds: string[] = [];

  beforeAll(async () => {
    for (let i = 0; i < QA_COUNT; i++) {
      qaIds.push(await seedQaPair({ marker: `${MARKER}-${i}` }));
    }
  }, 30_000);

  it('returns ONLY q_a_pair-owner rows and a FULL limit_count page when more answers match than the limit', async () => {
    expect(QA_COUNT).toBeGreaterThan(LIMIT);
    const rows = await callHybridSearch({
      queryText: MARKER,
      filterKind: 'answer',
      limitCount: LIMIT,
    });
    expect(rows).toHaveLength(LIMIT);
    for (const row of rows) {
      expect(row.owner_kind).toBe('q_a_pair');
      expect(qaIds).toContain(row.id);
    }
  });
});

// ---------------------------------------------------------------------------
// BI-16: domain/subtopic/date filters + STRICT-EXCLUDE (DR-051)
// ---------------------------------------------------------------------------

describe('BI-16 domain/subtopic/date filters, STRICT-EXCLUDE undated rows (DR-051)', () => {
  const MARKER = `BI16${TEST_TAG}`;
  const DOMAIN_A = `${MARKER}-domA`;
  const DOMAIN_B = `${MARKER}-domB`;
  const SUBTOPIC_A = `${MARKER}-subA`;
  const SUBTOPIC_B = `${MARKER}-subB`;
  const IN_RANGE_DATE = '2026-02-10T00:00:00.000Z';
  const RANGE_FROM = '2026-02-01T00:00:00.000Z';
  const RANGE_TO = '2026-02-28T23:59:59.999Z';

  let sdA: string; // domA/subA, captured_date IN RANGE
  let sdB: string; // domB/subB, captured_date IN RANGE
  let sdC: string; // domA/subA, captured_date NULL (undated)
  let qaDated: string; // domain=domA (via source_document_id -> sdA), valid_from IN RANGE
  let qaUndated: string; // domain=domA (via source_document_id -> sdA), valid_from NULL (undated)

  beforeAll(async () => {
    sdA = await seedSourceDocument({
      marker: `${MARKER}-A`,
      primaryDomain: DOMAIN_A,
      primarySubtopic: SUBTOPIC_A,
      capturedDate: IN_RANGE_DATE,
    });
    sdB = await seedSourceDocument({
      marker: `${MARKER}-B`,
      primaryDomain: DOMAIN_B,
      primarySubtopic: SUBTOPIC_B,
      capturedDate: IN_RANGE_DATE,
    });
    sdC = await seedSourceDocument({
      marker: `${MARKER}-C`,
      primaryDomain: DOMAIN_A,
      primarySubtopic: SUBTOPIC_A,
      capturedDate: null,
    });
    // record_lifecycle.domain for a q_a_pair owner is derived (write-time
    // trigger) from q_a_pairs.source_document_id -> source_documents.
    // primary_domain — link both to sdA (domain=DOMAIN_A) to get that domain
    // synced onto their record_lifecycle facet (see seedQaPair jsdoc).
    qaDated = await seedQaPair({
      marker: `${MARKER}-QAD`,
      sourceDocumentId: sdA,
      validFrom: IN_RANGE_DATE,
    });
    qaUndated = await seedQaPair({
      marker: `${MARKER}-QAU`,
      sourceDocumentId: sdA,
      validFrom: null,
    });
  }, 30_000);

  it('filter_domain restricts to the arm domain expr (sd.primary_domain / record_lifecycle.domain)', async () => {
    const rows = await callHybridSearch({
      queryText: MARKER,
      filterDomain: DOMAIN_A,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(sdA);
    expect(ids).toContain(sdC);
    expect(ids).toContain(qaDated);
    expect(ids).not.toContain(sdB);
  });

  it('filter_subtopic restricts to the arm subtopic expr and EXCLUDES answers (no subtopic grain)', async () => {
    const rows = await callHybridSearch({
      queryText: MARKER,
      filterSubtopic: SUBTOPIC_A,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(sdA);
    expect(ids).toContain(sdC);
    expect(ids).not.toContain(sdB);
    // q_a_pairs project NULL::text for subtopic — a non-null filter_subtopic
    // naturally excludes the whole answer grain (TECH §2.4).
    expect(ids).not.toContain(qaDated);
    expect(ids).not.toContain(qaUndated);
  });

  it('filter_date_from/_to bound the result set; STRICT-EXCLUDE drops undated rows once a bound is set', async () => {
    const rows = await callHybridSearch({
      queryText: MARKER,
      filterDateFrom: RANGE_FROM,
      filterDateTo: RANGE_TO,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(sdA); // captured_date in range
    expect(ids).not.toContain(sdC); // undated -> STRICT-EXCLUDE
    expect(ids).toContain(qaDated); // valid_from in range
    expect(ids).not.toContain(qaUndated); // valid_from NULL -> STRICT-EXCLUDE
  });
});

// ---------------------------------------------------------------------------
// BI-10/BI-20: all-NULL default unchanged + stable dupe-free load-more
// ---------------------------------------------------------------------------

describe('BI-10/BI-20 all-NULL default unchanged + stable dupe-free load-more pagination', () => {
  const GROUP_MARKER = `BI1020${TEST_TAG}`;

  describe('BI-10 default (all filter_* NULL) returns the union across grains, unnarrowed', () => {
    const MARKER = `${GROUP_MARKER}-DEFAULT`;
    let sdId: string;
    let qaId: string;
    let refId: string;

    beforeAll(async () => {
      sdId = await seedSourceDocument({ marker: MARKER });
      qaId = await seedQaPair({ marker: MARKER });
      const ref = await seedReferenceItem({ marker: MARKER });
      refId = ref.referenceId;
    }, 30_000);

    it('returns rows from all three seeded grains when every filter_* param is NULL', async () => {
      const rows = await callHybridSearch({ queryText: MARKER });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(sdId);
      expect(ids).toContain(qaId);
      expect(ids).toContain(refId);
    });
  });

  describe('BI-20 load-more pagination is stable and dupe-free across a raised limit', () => {
    const MARKER = `${GROUP_MARKER}-PAGE`;
    const ROW_COUNT = 6;
    const ids: string[] = [];

    beforeAll(async () => {
      // IDENTICAL marker text + the SAME SHARED_VECTOR_STR embedding on every
      // row forces an exact similarity TIE — the only way to reliably
      // exercise the bl-431 OBS-3 `ORDER BY similarity DESC, id` tie-breaker
      // rather than relying on incidental floating-point luck.
      for (let i = 0; i < ROW_COUNT; i++) {
        ids.push(await seedQaPair({ marker: MARKER }));
      }
    }, 30_000);

    it('a smaller-limit page is a stable PREFIX of a larger-limit page, and both are dupe-free', async () => {
      const small = await callHybridSearch({
        queryText: MARKER,
        limitCount: 3,
      });
      const large = await callHybridSearch({
        queryText: MARKER,
        limitCount: ROW_COUNT,
      });

      expect(small).toHaveLength(3);
      expect(large).toHaveLength(ROW_COUNT);

      const smallIds = small.map((r) => r.id);
      const largeIds = large.map((r) => r.id);

      expect(new Set(smallIds).size).toBe(smallIds.length);
      expect(new Set(largeIds).size).toBe(largeIds.length);

      // Stable prefix: raising the limit must not reshuffle the earlier page.
      expect(largeIds.slice(0, 3)).toEqual(smallIds);
      // Sanity: every seeded id appears exactly once across the larger page.
      expect(new Set(largeIds)).toEqual(new Set(ids));
    });
  });
});

// ---------------------------------------------------------------------------
// API-layer PGRST202 guard: POST /api/search threads filters through
// api.hybrid_search (DR-030/DR-032) — a stale wrapper would PGRST202 or
// silently ignore the new params.
// ---------------------------------------------------------------------------

describe('API-layer PGRST202 guard: POST /api/search filters take effect via api.hybrid_search', () => {
  const MARKER = `APILAYER${TEST_TAG}`;
  const DOMAIN = `${MARKER}-dom`;
  const OTHER_DOMAIN = `${MARKER}-other-dom`;
  const IN_RANGE_DATE = '2026-03-15T00:00:00.000Z';
  let matchId: string;
  let excludedDomainId: string;

  beforeAll(async () => {
    matchId = await seedSourceDocument({
      marker: `${MARKER}-match`,
      primaryDomain: DOMAIN,
      capturedDate: IN_RANGE_DATE,
    });
    excludedDomainId = await seedSourceDocument({
      marker: `${MARKER}-other`,
      primaryDomain: OTHER_DOMAIN,
      capturedDate: IN_RANGE_DATE,
    });
    await signInAsTestUser(authCookies, 'admin');
  }, 30_000);

  it('threads kind/domain/dateFrom/dateTo (bare dates) through to the RPC and narrows the response — no PGRST202', async () => {
    const res = await searchPost(
      new NextRequest('http://localhost/api/search', {
        method: 'POST',
        body: JSON.stringify({
          query: MARKER,
          kind: 'document',
          domain: DOMAIN,
          // Bare dates — exercises the S460 route-boundary normalisation
          // (TECH §2.5) in the SAME call as the wrapper/params guard.
          dateFrom: '2026-03-01',
          dateTo: '2026-03-31',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ id: string }>;
      count: number;
    };
    const ids = body.results.map((r) => r.id);
    expect(ids).toContain(matchId);
    expect(ids).not.toContain(excludedDomainId);
  }, 30_000);
});
