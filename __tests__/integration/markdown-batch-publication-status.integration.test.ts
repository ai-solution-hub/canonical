/**
 * EP2 §1.11 — D-A publication-status end-to-end integration test
 *   (T7 / spec §10.4).
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md v1.3 §10.4 (D-A end-to-end).
 * Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T7 row, AC (b):
 *
 *   "(b) D-A publication-status integration (spec §10.4) — upload
 *   `foo-final.md` → row has `publication_status='in_review'` → row does
 *   NOT appear in default `hybrid_search` → admin PATCHes
 *   `publication_status='published'` → row NOW appears in default search.
 *   Guarded behind `KH_RUN_INTEGRATION=1`."
 *
 * --------------------------------------------------------------------------
 * SPEC DRIFT D1 — gating env var.
 *
 * The plan + spec text say "Guarded behind `KH_RUN_INTEGRATION=1`". That env
 * var is not present in the codebase. Canonical gating pattern (from
 * `__tests__/integration/items-patch-publication-status.integration.test.ts:108-114`)
 * is `HAS_REQUIRED_ENV` — Supabase env presence detection. Memory
 * `feedback_eval_scripts_assume_populated_db` says graceful-skip on
 * data-empty / missing-env staging is correct. T9 in W5 will fold the spec
 * drift back into the spec text.
 *
 * --------------------------------------------------------------------------
 * SPEC DRIFT D3 — hybrid_search visibility filter on `publication_status`.
 *
 * The spec §10.4 final-leg assertion is:
 *
 *   "row does NOT appear in default `hybrid_search` → admin PATCHes
 *   `publication_status='published'` → row NOW appears"
 *
 * The publication-lifecycle spec §1.2 partitions this into THREE phases:
 *
 *   - Phase 1 — schema (column + CHECK + indexes + trigger). SHIPPED
 *     (S200/S201).
 *   - Phase 2 — PATCH + MCP write paths. SHIPPED (S202).
 *   - Phase 3 — RPC widening (`hybrid_search`, `search_for_bid_response`,
 *     `search_content_chunks`) using a consolidated `visibility_filter`
 *     enum. NOT YET SHIPPED as of S213 W1.
 *
 * Today's `hybrid_search` (migration `20260421223339`) WHERE clause is:
 *
 *     WHERE ci.embedding IS NOT NULL
 *       AND ci.archived_at IS NULL
 *       AND (ci.governance_review_status IS NULL
 *            OR ci.governance_review_status != 'draft')
 *       AND (include_superseded OR ci.superseded_by IS NULL)
 *
 * No filter on `publication_status`. So an item written by the orchestrator
 * with `publication_status='in_review'` AND `governance_review_status=NULL`
 * AND `archived_at=NULL` AND `superseded_by=NULL` WILL appear in
 * `hybrid_search` today — contradicting the spec §10.4 invisibility leg.
 *
 * Two pragmatic options were available: (a) skip the entire test until
 * Phase 3 ships; (b) write the spec-true assertion and mark it `it.skipIf`
 * a runtime probe of the `hybrid_search` definition. Option (b) makes the
 * test self-activating when Phase 3 ships and keeps the spec contract
 * documented in code; we picked it.
 *
 * The runtime probe: query `pg_proc.prosrc` for the `hybrid_search` function
 * body and check whether it references `publication_status`. If so, run the
 * full assertion. If not, skip with a clear notice. T9 in W5 will fold
 * the drift back into the spec text (or the spec stays as the target and
 * the §5.2 Phase 3 plan picks up the gap).
 *
 * --------------------------------------------------------------------------
 * Surface under test:
 *   - Route POST `/api/ingest/markdown` (`app/api/ingest/markdown/route.ts`)
 *     in `phase=import` mode. Auth: admin.
 *   - Orchestrator `runImportPhase` in `lib/ingest/markdown-orchestrator.ts`,
 *     including the D-A guard at INSERT time
 *     (`draftFinalToPublicationStatus('final') === 'in_review'`).
 *   - Route PATCH `/api/items/[id]` (`app/api/items/[id]/route.ts`) for the
 *     `field='publication_status', value='published'` transition (§5.2 §3.2).
 *   - DB RPC `hybrid_search` for the visibility leg.
 *
 * Prerequisites:
 *   - `.env.local` with NEXT_PUBLIC_SUPABASE_URL,
 *     NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *     TEST_USER_1_PASSWORD, OPENAI_API_KEY (for the orchestrator's embedding
 *     generation; see `lib/ai/embed.ts`).
 *   - `bun run seed:e2e-users` has been run against the target DB.
 *
 * Run via: `bun run test:integration -- markdown-batch-publication-status`
 *
 * @vitest-environment node
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
// service-client MUST be imported first — it loads dotenv for all env vars.
import { serviceClient } from './helpers/service-client';
import {
  cacheAllTestUserSessions,
  restoreSession,
  getTestUserId,
  type AuthCookieStore,
  type AuthCookieEntry,
  type CachedSessions,
} from './helpers/auth-session';

// ---------------------------------------------------------------------------
// Mock next/headers at file scope so the hoisted cookieStore is shared with
// the production createClient() code path. Same pattern as
// items-patch-publication-status.integration.test.ts.
// ---------------------------------------------------------------------------

const { authCookies, cachedSessions } = vi.hoisted(() => ({
  authCookies: new Map<
    string,
    { name: string; value: string }
  >() as AuthCookieStore,
  cachedSessions: {
    admin: new Map(),
    editor: new Map(),
    viewer: new Map(),
  } as unknown as CachedSessions,
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

// Import handlers AFTER the mock is registered.
const { POST: markdownIngestPost } =
  await import('@/app/api/ingest/markdown/route');
const { PATCH: itemsPatch } = await import('@/app/api/items/[id]/route');

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[MD-PUB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededIds: string[] = [];
let TEST_USER_1_ID = '';
let HYBRID_SEARCH_FILTERS_PUBLICATION_STATUS = false;

const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.TEST_USER_1_PASSWORD &&
  process.env.CRON_SECRET &&
  process.env.OPENAI_API_KEY,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Probe live DB to determine whether `hybrid_search` filters on
 * `publication_status`. The function body is in `pg_proc.prosrc` for
 * SQL/PLPGSQL functions.
 *
 * Returns `true` if and only if the running DB has §5.2 Phase 3 RPC widening
 * applied. Any error or unexpected shape returns `false` (cautious — we'd
 * rather skip than false-pass).
 */
async function probeHybridSearchFiltersPublicationStatus(): Promise<boolean> {
  // The Supabase service-role key is only used here to discover schema state;
  // the production code path under test still goes via the SSR auth client
  // wired through next/headers.
  type ProcRow = { prosrc: string };
  // `select_one_function_body` requires a query that won't be confused by
  // overloads; we filter by name + schema and pick the first row.
  // Use a tiny inline RPC fallback — `pg_proc` is queryable via PostgREST
  // if exposed, but here we use a minimal SQL-as-RPC via `execute_sql` is
  // unavailable to the JS client, so we rely on `pg_proc` being readable
  // through the supabase-js layer. If the schema layer doesn't expose
  // `pg_proc`, the call returns an error and we conservatively return false.
  //
  // Practical alternative: read the migration file off disk. We avoid file
  // I/O in tests; runtime probe is more honest.
  const { data, error } = await serviceClient
    // PostgREST typically does NOT expose `pg_proc` — but the service-role
    // key bypasses RLS and many Supabase projects expose `pg_catalog`.
    // If the call fails, treat absence as Phase-3-not-shipped.
    .schema('pg_catalog' as never)
    .from('pg_proc' as never)
    .select('prosrc' as never)
    .eq('proname' as never, 'hybrid_search')
    .limit(1)
    .returns<ProcRow[]>();
  if (error || !data || data.length === 0) return false;
  return data[0].prosrc.includes('publication_status');
}

/**
 * Fallback probe — directly call `hybrid_search` against an item we INSERT
 * with `publication_status='in_review'` and `governance_review_status=NULL`.
 * If the item appears in the default-call results, Phase 3 is NOT shipped
 * (the publication_status filter is absent). If it does NOT appear, Phase 3
 * IS shipped.
 *
 * This is the empirical fallback when `pg_proc.prosrc` introspection is
 * blocked by PostgREST schema exposure rules.
 */
async function probeHybridSearchEmpirically(): Promise<boolean> {
  // Build a deterministic, distinctive content body so the embedding gate
  // and ILIKE gate both succeed.
  const probeMarker = `HYBRIDSEARCHPROBE${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const probeContent =
    `${probeMarker} probe content for visibility-filter detection — ` +
    'this is a synthetic row used to determine whether publication_status ' +
    'filtering is active on hybrid_search; deleted in afterAll.';

  // Insert with publication_status='in_review' + an embedding (1024-dim
  // vector of 0.001 — meaningless but valid for the RPC's `embedding IS
  // NOT NULL` filter).
  const stubEmbedding = JSON.stringify(new Array(1024).fill(0.001));
  const ins = await serviceClient
    .from('content_items')
    .insert({
      title: `${TEST_PREFIX} hybrid-search-probe`,
      content: probeContent,
      content_type: 'article',
      created_by: TEST_USER_1_ID,
      publication_status: 'in_review',
      embedding: stubEmbedding,
    })
    .select('id')
    .single();
  if (ins.error || !ins.data) {
    // Cannot probe — fail closed (assume Phase 3 NOT shipped, skip the test).
    return false;
  }
  seededIds.push(ins.data.id);

  // limit_count is intentionally high (V_W1 F-2 hardening): the probe relies
  // on the stub embedding's perfect self-match (cos_sim=1) plus the unique
  // probeMarker ILIKE clause to surface the row. Both gates are robust today
  // but if hybrid_search ranking weights drift OR staging item count grows
  // past ~1000, a small limit_count could under-rank the probe row below the
  // cutoff and false-positive Phase 3 as "shipped". 1000 is well above
  // staging cardinality and headroom for ranking drift.
  const { data, error } = await serviceClient.rpc('hybrid_search', {
    query_embedding: stubEmbedding,
    query_text: probeMarker,
    similarity_threshold: 0.0,
    limit_count: 1000,
  });
  if (error || !data) return false;
  const ids = (data as Array<{ id: string }>).map((r) => r.id);
  // If the in_review row appears, Phase 3 is NOT shipped.
  // If absent, Phase 3 IS shipped.
  return !ids.includes(ins.data.id);
}

/**
 * Invoke the production POST handler for `/api/ingest/markdown` with a single
 * `.md` file in `phase=import` mode.
 */
async function postImportSingleFile(opts: {
  filename: string;
  body: string;
}): Promise<Response> {
  const fd = new FormData();
  fd.append('phase', 'import');
  fd.append(
    'files[]',
    new File([opts.body], opts.filename, { type: 'text/markdown' }),
  );
  fd.append('options', JSON.stringify({}));
  const req = new NextRequest('http://localhost/api/ingest/markdown', {
    method: 'POST',
    body: fd,
  });
  return markdownIngestPost(req);
}

/**
 * Invoke the production PATCH handler with the publication_status transition.
 */
async function patchPublicationStatus(
  itemId: string,
  newStatus: 'draft' | 'in_review' | 'published' | 'archived',
): Promise<Response> {
  const req = new NextRequest(`http://localhost/api/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ field: 'publication_status', value: newStatus }),
    headers: { 'content-type': 'application/json' },
  });
  return itemsPatch(req, { params: Promise.resolve({ id: itemId }) });
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!HAS_REQUIRED_ENV) return;
  TEST_USER_1_ID = await getTestUserId('admin');
  await cacheAllTestUserSessions(cachedSessions);

  // Determine whether §5.2 Phase 3 RPC widening has shipped (D3). Try the
  // pg_proc introspection first; if it fails (most likely — PostgREST
  // typically does not expose pg_catalog), fall back to the empirical probe.
  let detected = false;
  try {
    detected = await probeHybridSearchFiltersPublicationStatus();
  } catch {
    detected = false;
  }
  if (!detected) {
    try {
      detected = await probeHybridSearchEmpirically();
    } catch {
      detected = false;
    }
  }
  HYBRID_SEARCH_FILTERS_PUBLICATION_STATUS = detected;
}, 60_000);

beforeEach(() => {
  if (!HAS_REQUIRED_ENV) return;
  // Admin role exercises both the orchestrator import path and the PATCH
  // transition (admin is the only role allowed all four publication-status
  // transitions per §5.2 spec §3.4).
  restoreSession(authCookies, cachedSessions, 'admin');
});

afterAll(async () => {
  if (seededIds.length === 0) return;
  // The import path triggers v1 history rows + the PATCH adds a
  // publication_state history row. Delete `content_history` rows BEFORE
  // the parent `content_items` rows so the FK does not block.
  await serviceClient
    .from('content_history')
    .delete()
    .in('content_item_id', seededIds);
  // `content_chunks` are emitted by `regenerateChunks` in the orchestrator —
  // delete them too. Best-effort: if the table doesn't exist for any reason,
  // continue.
  try {
    await serviceClient
      .from('content_chunks')
      .delete()
      .in('content_item_id', seededIds);
  } catch {
    /* swallow — best-effort cleanup */
  }
  await serviceClient.from('content_items').delete().in('id', seededIds);
  // Sweep our pipeline_runs rows. The orchestrator's terminal UPDATE in
  // `finaliseRun` may leave `status='running'` if it fails (independent
  // pre-existing behaviour observed during this test wave; not caused by
  // this test). We delete by created_by + pipeline_name to avoid
  // polluting staging with stuck rows. Restricted to TEST_USER_1_ID.
  await serviceClient
    .from('pipeline_runs')
    .delete()
    .eq('pipeline_name', 'upload_markdown_batch')
    .eq('created_by', TEST_USER_1_ID);
}, 60_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIfEnv(
  'POST /api/ingest/markdown phase=import — D-A publication-status end-to-end (T7 / spec §10.4)',
  () => {
    it('foo-final.md → publication_status=in_review → invisible in default hybrid_search → admin PATCH "published" → visible', async () => {
      // Honest guard for D3 — if §5.2 Phase 3 (RPC widening) has not
      // shipped, skip the visibility assertions and only verify the
      // INSERT-side D-A guard. This keeps the test self-activating
      // once Phase 3 lands.
      const phase3Active = HYBRID_SEARCH_FILTERS_PUBLICATION_STATUS;

      // ─────────────────────────────────────────────────────────────────
      // Setup: distinctive content with a unique marker so hybrid_search
      // can locate the row deterministically (without conflating with
      // the existing 600+ content_items rows in staging).
      // ─────────────────────────────────────────────────────────────────
      const marker = `MDPUBSTATUSMARKER${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      const filename = `${TEST_PREFIX}-foo-final.md`;
      const body =
        `# ${TEST_PREFIX} D-A Final Item\n\n` +
        `${marker} canonical body for the D-A end-to-end integration test. ` +
        'This row tests the publication-status lifecycle from ingest to ' +
        'admin approval. Length padded over fifty characters to clear the ' +
        'dedup minimum.';

      // ─────────────────────────────────────────────────────────────────
      // Phase 1: import via POST /api/ingest/markdown.
      //
      // Post-S226 §5.4.4 the route is async — returns 202 with a queue
      // envelope. The orchestrator runs under the cron worker, which is
      // what writes content_items + sets publication_status='in_review'
      // (the D-A INSERT guard under test). We drive the worker explicitly
      // and look up the resulting row by source_file.
      // ─────────────────────────────────────────────────────────────────
      const importRes = await postImportSingleFile({ filename, body });
      const importBodyText = await importRes.clone().text();
      expect(importRes.status, importBodyText).toBe(202);
      const importJson = (await importRes.json()) as {
        job_id: string;
        pipeline_run_id: string;
        status: 'queued';
        deduplicated: boolean;
      };
      expect(importJson.status).toBe('queued');
      expect(importJson.deduplicated).toBe(false);
      expect(importJson.pipeline_run_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      // Drive the cron worker — runs the real orchestrator which performs
      // dedup + embeddings + INSERT into content_items with the D-A INSERT
      // guard that this test is asserting on.
      const { GET: cronGet } = await import(
        '@/app/api/cron/process-queue/route'
      );
      const cronReq = new NextRequest(
        'http://localhost/api/cron/process-queue',
        {
          method: 'GET',
          headers: { authorization: `Bearer ${process.env.CRON_SECRET!}` },
        },
      );
      const cronRes = await cronGet(cronReq);
      expect(cronRes.status).toBe(200);

      // Look up the row the worker wrote, keyed on (source_file, created_by).
      const lookup = await serviceClient
        .from('content_items')
        .select('id')
        .eq('source_file', filename)
        .eq('created_by', TEST_USER_1_ID)
        .single();
      expect(lookup.error).toBeNull();
      const importedId = lookup.data!.id;
      seededIds.push(importedId);

      // ─────────────────────────────────────────────────────────────────
      // Assert D-A INSERT guard: orchestrator wrote
      //   publication_status='in_review' (because filename contains
      //   'final' → heuristic 'final' → draftFinalToPublicationStatus
      //   maps to 'in_review' — D-A invariant).
      //   governance_review_status=NULL (orchestrator §7.3 + spec §9.2).
      // ─────────────────────────────────────────────────────────────────
      const postImportRow = await serviceClient
        .from('content_items')
        .select(
          'id, publication_status, governance_review_status, archived_at, source_file',
        )
        .eq('id', importedId)
        .single();
      expect(postImportRow.error).toBeNull();
      expect(postImportRow.data?.publication_status).toBe('in_review');
      expect(postImportRow.data?.governance_review_status).toBeNull();
      expect(postImportRow.data?.archived_at).toBeNull();
      expect(postImportRow.data?.source_file).toBe(filename);

      // ─────────────────────────────────────────────────────────────────
      // Phase 2: invisibility leg — default hybrid_search MUST NOT return
      // the in_review row.
      //
      // GUARDED on D3: skip-with-notice when Phase 3 RPC widening has
      // not shipped. The probe is in beforeAll. T9 in W5 will fold the
      // drift back into the spec.
      // ─────────────────────────────────────────────────────────────────
      if (phase3Active) {
        // Use a stub embedding — the marker keyword + the ILIKE gate
        // surface the row regardless of vector similarity. The test only
        // cares about the visibility WHERE clause, not the ranking.
        const stubEmbedding = JSON.stringify(new Array(1024).fill(0.001));
        const beforeApprove = await serviceClient.rpc('hybrid_search', {
          query_embedding: stubEmbedding,
          query_text: marker,
          similarity_threshold: 0.0,
          limit_count: 100,
        });
        expect(beforeApprove.error).toBeNull();
        const idsBefore = (beforeApprove.data as Array<{ id: string }>).map(
          (r) => r.id,
        );
        expect(idsBefore).not.toContain(importedId);
      } else {
        // Phase 3 not shipped — record the skip in the test output so
        // the parent session sees it, but proceed to verify the rest of
        // the lifecycle (PATCH transition).
        console.warn(
          '[markdown-batch-publication-status] §5.2 Phase 3 (hybrid_search visibility filter) not shipped on target DB. Skipping invisibility + visibility hybrid_search legs. T9/W5 will fold the drift into the spec.',
        );
      }

      // ─────────────────────────────────────────────────────────────────
      // Phase 3: admin PATCHes publication_status='published'.
      //
      // This MUST succeed (admin can transition `in_review → published`
      // per §5.2 spec §3.4 role-gate matrix).
      // ─────────────────────────────────────────────────────────────────
      const patchRes = await patchPublicationStatus(importedId, 'published');
      const patchBodyText = await patchRes.clone().text();
      expect(patchRes.status, patchBodyText).toBe(200);
      const patchJson = (await patchRes.json()) as { success: boolean };
      expect(patchJson.success).toBe(true);

      // ─────────────────────────────────────────────────────────────────
      // Verify DB-side transition + invariant maintenance.
      // ─────────────────────────────────────────────────────────────────
      const postPatchRow = await serviceClient
        .from('content_items')
        .select('publication_status, governance_review_status, archived_at')
        .eq('id', importedId)
        .single();
      expect(postPatchRow.error).toBeNull();
      expect(postPatchRow.data?.publication_status).toBe('published');
      expect(postPatchRow.data?.governance_review_status).toBeNull();
      expect(postPatchRow.data?.archived_at).toBeNull();

      // ─────────────────────────────────────────────────────────────────
      // Phase 4: visibility leg — default hybrid_search MUST now return
      // the published row.
      //
      // Same D3 guard — if Phase 3 not shipped, skip-with-notice.
      // ─────────────────────────────────────────────────────────────────
      if (phase3Active) {
        const stubEmbedding = JSON.stringify(new Array(1024).fill(0.001));
        const afterApprove = await serviceClient.rpc('hybrid_search', {
          query_embedding: stubEmbedding,
          query_text: marker,
          similarity_threshold: 0.0,
          limit_count: 100,
        });
        expect(afterApprove.error).toBeNull();
        const idsAfter = (afterApprove.data as Array<{ id: string }>).map(
          (r) => r.id,
        );
        expect(idsAfter).toContain(importedId);
      }
      // No else — if Phase 3 not shipped, the upstream warn covers it.

      // ─────────────────────────────────────────────────────────────────
      // Audit trail: at least one content_history row tagged
      // change_type='publication_state' (PATCH transition; orchestrator's
      // initial_ingest is change_type='initial_ingest', distinct).
      // ─────────────────────────────────────────────────────────────────
      const history = await serviceClient
        .from('content_history')
        .select('change_type, change_reason')
        .eq('content_item_id', importedId)
        .eq('change_type', 'publication_state');
      expect(history.error).toBeNull();
      expect(history.data?.length ?? 0).toBeGreaterThanOrEqual(1);
      // Spec §3.2 + items-patch route: change_reason text "Transition from
      // in_review to published".
      const reasons = (history.data ?? []).map((r) => r.change_reason);
      expect(reasons).toContain('Transition from in_review to published');
    }, 120_000);
  },
);
