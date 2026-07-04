/**
 * Source-A inference — REAL-corpus regression (S262-32-B2).
 *
 * The 32.8 / 32.20 in-memory tests mounted the fetcher + schemas files at
 * `/repo/...` and exercised `findSchemaConstant` with an EXPLICIT project
 * path. Neither test loaded the real on-disk corpus via
 * `createCodemodProject()`, so they could not catch the binding defect that
 * `inferSchema` returned `z.unknown()` for ALL ~195 routes against the real
 * tree:
 *
 *   1. `routePathToCandidateUrl` only stripped the `^/repo/` (in-memory)
 *      and `^app/` prefixes, so a real absolute path
 *      (`/Users/.../app/api/review/queue/route.ts`) yielded the garbage
 *      candidate URL `//Users/.../app/api/review/queue` — never matching a
 *      fetcher URL.
 *   2. The `DEFAULT_SCHEMAS_PATH` / `DEFAULT_FETCHERS_PATH` literals
 *      (`/repo/...`) never resolved inside a disk-loaded ts-morph project, so
 *      the no-options (production) path read nothing.
 *
 * This suite loads the ACTUAL project via `createCodemodProject()` and asserts
 * on the OBSERVABLE output of `inferSchema` / `inferSchemaSourceA`: a real
 * `${interface}Schema` identifier for known MECHANISABLE baseline routes whose
 * fetcher URL matches a baseline interface. It is the coverage the in-memory
 * suites lacked.
 *
 * Spec: docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PRODUCT.md AC-5 / AC-6;
 *       docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/TECH.md §3.A.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  routePathToCandidateUrl,
  inferSchemaSourceA,
} from '@/scripts/codemods/inference-source-a';
import {
  createCodemodProject,
  enumerateRouteFiles,
  inferSchema,
} from '@/scripts/codemods/wrap-define-route';

// bl-245 (S321): the real-corpus suites resolve types across the full ts-morph
// project — the 5000ms Vitest default false-reds under parallel-wave machine load
// AND on loaded CI shard runners. 15s ALSO proved insufficient on the S321
// mini-align (2-vCPU runner, 4 parallel files: the heavy tail tests exceeded it).
// 60s matches the local evidence envelope (full file ≈60s/29 tests, tail-heavy).
vi.setConfig({ testTimeout: 60_000 });

// ── routePathToCandidateUrl — absolute path handling ───────────────────────

describe('routePathToCandidateUrl derives /api/... from BOTH path styles', () => {
  it('derives /api/... from a real ABSOLUTE on-disk path', () => {
    // The production path: ts-morph reports absolute file paths.
    expect(
      routePathToCandidateUrl(
        '/Users/dev/knowledge-hub/app/api/review/queue/route.ts',
      ),
    ).toBe('/api/review/queue');
  });

  it('still derives /api/... from the in-memory /repo/ path style', () => {
    // The 32.8 in-memory test path style must keep working.
    expect(routePathToCandidateUrl('/repo/app/api/review/stats/route.ts')).toBe(
      '/api/review/stats',
    );
  });

  it('preserves Next.js dynamic segments in an absolute path', () => {
    expect(
      routePathToCandidateUrl(
        '/Users/dev/knowledge-hub/app/api/pipeline-runs/[id]/route.ts',
      ),
    ).toBe('/api/pipeline-runs/[id]');
  });
});

// ── inferSchema — real corpus binding ──────────────────────────────────────

/**
 * Locate the route SourceFile whose POSIX path ends with the given
 * `app/api/...` suffix inside the real project. Fails loudly if the route the
 * test relies on has moved — that is a meaningful signal, not flakiness.
 */
function routeBySuffix(
  routes: ReturnType<typeof enumerateRouteFiles>,
  suffix: string,
) {
  const sf = routes.find((r) =>
    r.getFilePath().replace(/\\/g, '/').endsWith(suffix),
  );
  if (!sf) {
    throw new Error(
      `[real-corpus test] expected route ${suffix} in the real corpus`,
    );
  }
  return sf;
}

describe('inferSchema binds real ${interface}Schema over the REAL corpus (AC-5)', () => {
  it('binds ReviewQueueResponseSchema for the /api/review/queue route', () => {
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/review/queue/route.ts');

    // Source A directly — the observable identifier, not internals.
    expect(inferSchemaSourceA(sf, 'GET', project)).toEqual({
      schema: 'ReviewQueueResponseSchema',
    });
    // And through the production chain entry point.
    expect(inferSchema(sf, 'GET', project)).toEqual({
      schema: 'ReviewQueueResponseSchema',
    });
  });

  it('binds TaxonomySyncStatusSchema for the /api/admin/taxonomy-sync/status route', () => {
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(
      routes,
      'app/api/admin/taxonomy-sync/status/route.ts',
    );

    expect(inferSchemaSourceA(sf, 'GET', project)).toEqual({
      schema: 'TaxonomySyncStatusSchema',
    });
  });

  it('yields real schemas (>0) across the corpus, not z.unknown() for all', () => {
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);

    let real = 0;
    for (const sf of routes) {
      if (inferSchema(sf, 'GET', project).schema !== 'z.unknown()') real += 1;
    }

    // Pre-fix this was 0 (the binding defect). The MECHANISABLE + URL-matched
    // subset of the 37-baseline is the floor; assert strictly positive so a
    // future regression that re-breaks the binding fails this gate.
    expect(real).toBeGreaterThan(0);
  });
});

// ── 32.21 — broadened fetcher/hook walk (AC-5 expansion) ───────────────────

/**
 * Source-A originally walked ONLY `lib/query/fetchers.ts`, so the ~30 baseline
 * interfaces that are fetched via `fetchJson<T>(url)` INSIDE a hook/component
 * (not the central fetchers registry) never bound — the walk never reached
 * their call sites. Subtask 32.21 broadens `collectFetcherCalls` to scan
 * `hooks/**`, `components/**`, and `lib/query/**` for the SAME static-URL +
 * type-arg extraction, keeping the baseline filter (AC-5) so only baseline
 * interfaces bind.
 *
 * These tests assert on the OBSERVABLE returned schema expression for
 * representative hook/component-fetched routes — `z.array(<X>Schema)` for
 * array type args (`fetchJson<X[]>`) and the bare `<X>Schema` for scalar ones.
 *
 * Spec: docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PRODUCT.md AC-5;
 *       Subtask 32.21 dispatch brief (Option B, ratified by Liam).
 */
describe('inferSchema binds hook/component-fetched baseline interfaces (32.21 AC-5 expansion)', () => {
  it('binds z.array(CompanyProfileSchema) for /api/intelligence/profiles (hook fetchJson<CompanyProfile[]>)', () => {
    // hooks/intelligence/use-company-profiles.ts:
    //   fetchJson<CompanyProfile[]>('/api/intelligence/profiles')
    // An array type arg must infer z.array(<X>Schema), not the bare schema.
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/intelligence/profiles/route.ts');

    expect(inferSchemaSourceA(sf, 'GET', project)).toEqual({
      schema: 'z.array(CompanyProfileSchema)',
    });
    expect(inferSchema(sf, 'GET', project)).toEqual({
      schema: 'z.array(CompanyProfileSchema)',
    });
  });

  it('binds CompanyProfileSchema (scalar) for /api/intelligence/profiles/[id]', () => {
    // hooks/intelligence/use-company-profiles.ts also fetches a single profile:
    //   fetchJson<CompanyProfile>(`/api/intelligence/profiles/${id}`)
    // The scalar type arg on the [id] sub-route must bind the bare schema —
    // the segment-aligned matcher keeps it distinct from the array site above.
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(
      routes,
      'app/api/intelligence/profiles/[id]/route.ts',
    );

    expect(inferSchemaSourceA(sf, 'GET', project)).toEqual({
      schema: 'CompanyProfileSchema',
    });
  });

  it('binds z.array(FeedSourceSchema) for /api/intelligence/workspaces/[id]/sources (hook fetchJson<FeedSource[]>)', () => {
    // hooks/intelligence/use-feed-sources.ts:
    //   fetchJson<FeedSource[]>(`/api/intelligence/workspaces/${workspaceId}/sources`)
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(
      routes,
      'app/api/intelligence/workspaces/[id]/sources/route.ts',
    );

    expect(inferSchemaSourceA(sf, 'GET', project)).toEqual({
      schema: 'z.array(FeedSourceSchema)',
    });
  });

  it('binds NotificationsResponseSchema for /api/notifications (hook fetchJson<NotificationsResponse>)', () => {
    // hooks/use-notifications.ts:
    //   fetchJson<NotificationsResponse>('/api/notifications')
    // A scalar static-URL hook fetch — the third representative bind.
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/notifications/route.ts');

    expect(inferSchemaSourceA(sf, 'GET', project)).toEqual({
      schema: 'NotificationsResponseSchema',
    });
  });

  // The wildcard-collision fixture this test used to exercise
  // (`/api/admin/content-dedup/[id]` absorbing the `/queue` and
  // `/near-duplicates` literal-segment fetcher URLs, then needing the
  // resolver to prefer the wildcard-ALIGNED `DedupItemResponseSchema`
  // candidate over the absorbed literals) no longer exists on disk: the
  // admin content-dedup route family was retired under ID-131.15
  // (G-DEDUP legacy dedup-family retirement, S446). No other real route
  // in the corpus currently exhibits an equivalent three-way wildcard
  // collision, so this test case is removed rather than left pointing at
  // a nonexistent fixture. If the "prefer wildcard-aligned over absorbed
  // literal" resolver behaviour needs dedicated real-corpus coverage
  // again, a fresh fixture route should be identified or authored — flagged
  // as a coverage gap for the codemod test suite, not a dedup-retirement
  // concern.

  it('does NOT bind a non-baseline fetchJson<T> site (ProcurementSummary on /api/procurement/[id])', () => {
    // hooks/procurement/use-procurement-session.ts fetches a NON-baseline type:
    //   fetchJson<ProcurementSummary>(`/api/procurement/${procurementId}`)
    // ProcurementSummary is absent from the baseline, so even though the URL
    // matches the bare /api/procurement/[id] route, the AC-5 baseline filter
    // must leave it unbound (z.unknown()).
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/procurement/[id]/route.ts');

    expect(inferSchemaSourceA(sf, 'GET', project)).toEqual({
      schema: 'z.unknown()',
      reason: 'NEEDS_SCHEMA',
    });
  });

  it('raises the corpus-wide real-bind count materially above the post-B2 floor of 6', () => {
    // Post-B2 the floor was 6 (fetchers.ts-only walk). Broadening to hooks /
    // components / lib/query binds the hook-fetched baseline interfaces; the
    // achieved count was 34, until ID-131.15 (G-DEDUP legacy dedup-family
    // retirement, S446) deleted the admin content-dedup route family — 8 of
    // the previously-bound GET routes went with it, dropping the achieved
    // count to 26. Assert a concrete lower bound (>= 22) rather than a magic
    // exact — a future fetcher addition should not break this gate, but a
    // regression that re-narrows the walk toward the post-B2 floor must.
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);

    let real = 0;
    for (const sf of routes) {
      if (inferSchema(sf, 'GET', project).schema !== 'z.unknown()') real += 1;
    }

    expect(real).toBeGreaterThanOrEqual(22);
  });
});

// ── 32.22 — mutationFetchJson write-response binds (method-aware walk) ──────

/**
 * Subtask 32.22 extends `collectFetcherCalls` to recognise
 * `mutationFetchJson<T>(url, ...)` write-response call sites alongside the
 * read-side `fetchJson<T>(url)` calls, tagging each with its fetch KIND
 * (`read` / `write`). Binding is then made HTTP-method-aware:
 *   - `method ∈ {GET, HEAD}`             → match `read` (fetchJson) sites only.
 *   - `method ∈ {POST, PUT, PATCH, DELETE}` → match `write` (mutationFetchJson)
 *                                            sites only.
 *
 * This closes AC-5's bindable-baseline coverage: the 15 write-response
 * baseline interfaces (`ChangeReportGenerateResponse`, `RescoringPreviewResponse`,
 * `ResolveFlagsResponse`, `MutationResult`, `CreateFeedSourceResponse`, …) are
 * all fetched exclusively via `mutationFetchJson<T>` and were therefore
 * invisible to the read-only 32.21 walk.
 *
 * The tests assert on the OBSERVABLE returned schema expression for the write
 * method of representative mutation routes, plus the critical method-awareness
 * invariant (a route exporting BOTH GET and a write method binds DISTINCT
 * schemas per method) and a no-regression guard on the 32.21 GET binds.
 *
 * Spec: docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PRODUCT.md AC-5;
 *       Subtask 32.22 dispatch brief (Option B, ratified by Liam).
 */
describe('inferSchema binds mutationFetchJson write-response baseline interfaces (32.22 AC-5)', () => {
  it('binds MutationResultSchema for POST /api/tags/rename (mutationFetchJson<MutationResult>)', () => {
    // hooks/use-tags-data.ts:
    //   mutationFetchJson<MutationResult>('/api/tags/rename', params)
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/tags/rename/route.ts');

    expect(inferSchemaSourceA(sf, 'POST', project)).toEqual({
      schema: 'MutationResultSchema',
    });
    expect(inferSchema(sf, 'POST', project)).toEqual({
      schema: 'MutationResultSchema',
    });
  });

  it('binds ChangeReportGenerateResponseSchema for POST /api/change-reports/generate', () => {
    // hooks/use-change-reports-data.ts:
    //   mutationFetchJson<ChangeReportGenerateResponse>('/api/change-reports/generate', params)
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(
      routes,
      'app/api/change-reports/generate/route.ts',
    );

    expect(inferSchemaSourceA(sf, 'POST', project)).toEqual({
      schema: 'ChangeReportGenerateResponseSchema',
    });
  });

  it('binds RescoringPreviewResponseSchema for POST /api/intelligence/workspaces/[id]/prompts/preview (template-URL mutation)', () => {
    // hooks/intelligence/use-rescoring-preview.ts:
    //   mutationFetchJson<RescoringPreviewResponse>(
    //     `/api/intelligence/workspaces/${workspaceId}/prompts/preview`, body)
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(
      routes,
      'app/api/intelligence/workspaces/[id]/prompts/preview/route.ts',
    );

    expect(inferSchemaSourceA(sf, 'POST', project)).toEqual({
      schema: 'RescoringPreviewResponseSchema',
    });
  });

  it('binds ResolveFlagsResponseSchema for POST /api/intelligence/workspaces/[id]/flags/resolve', () => {
    // hooks/intelligence/use-resolve-flags.ts:
    //   mutationFetchJson<ResolveFlagsResponse>(
    //     `/api/intelligence/workspaces/${workspaceId}/flags/resolve`, body)
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(
      routes,
      'app/api/intelligence/workspaces/[id]/flags/resolve/route.ts',
    );

    expect(inferSchemaSourceA(sf, 'POST', project)).toEqual({
      schema: 'ResolveFlagsResponseSchema',
    });
  });

  it('is HTTP-method-aware: /api/intelligence/workspaces/[id]/sources binds DISTINCT schemas for GET vs POST', () => {
    // The SAME URL is fetched two ways at the SAME route:
    //   GET  — hooks/intelligence/use-feed-sources.ts:
    //            fetchJson<FeedSource[]>(`/api/intelligence/workspaces/${id}/sources`)
    //   POST — hooks/intelligence/use-feed-sources.ts:
    //            mutationFetchJson<CreateFeedSourceResponse>(
    //              `/api/intelligence/workspaces/${id}/sources`, data)
    // Method-aware binding MUST return the read schema on GET and the
    // write schema on POST — never cross-bind.
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(
      routes,
      'app/api/intelligence/workspaces/[id]/sources/route.ts',
    );

    expect(inferSchemaSourceA(sf, 'GET', project)).toEqual({
      schema: 'z.array(FeedSourceSchema)',
    });
    expect(inferSchemaSourceA(sf, 'POST', project)).toEqual({
      schema: 'CreateFeedSourceResponseSchema',
    });
    // Through the production chain entry point too.
    expect(inferSchema(sf, 'GET', project)).toEqual({
      schema: 'z.array(FeedSourceSchema)',
    });
    expect(inferSchema(sf, 'POST', project)).toEqual({
      schema: 'CreateFeedSourceResponseSchema',
    });
  });

  it('does NOT cross-bind a write schema onto a GET: /api/change-reports/generate GET stays unbound', () => {
    // The only fetch at /api/change-reports/generate is a POST mutation.
    // A GET request must NOT pick up the write-side ChangeReportGenerateResponse
    // — there is no read-side fetchJson for this URL, so GET falls back.
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(
      routes,
      'app/api/change-reports/generate/route.ts',
    );

    expect(inferSchemaSourceA(sf, 'GET', project)).toEqual({
      schema: 'z.unknown()',
      reason: 'NEEDS_SCHEMA',
    });
  });

  it('does NOT cross-bind a read schema onto a write method: /api/notifications POST is not the GET read schema', () => {
    // hooks/use-notifications.ts fetches the GET read via
    //   fetchJson<NotificationsResponse>('/api/notifications')
    // and a SEPARATE write via mutationFetchJson<Record<string, unknown>> at
    // '/api/notifications/read' (a DIFFERENT URL). A POST to /api/notifications
    // therefore has no matching write-side mutation and must NOT bind the
    // GET-only NotificationsResponseSchema.
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/notifications/route.ts');

    expect(inferSchemaSourceA(sf, 'GET', project)).toEqual({
      schema: 'NotificationsResponseSchema',
    });
    expect(inferSchemaSourceA(sf, 'POST', project).schema).not.toBe(
      'NotificationsResponseSchema',
    );
  });

  it('does NOT regress the 32.21 GET binds (read schemas still bind on GET)', () => {
    // Representative 32.21 read-side binds must remain intact after the
    // method-aware extension — GET still maps to fetchJson sites only.
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);

    expect(
      inferSchemaSourceA(
        routeBySuffix(routes, 'app/api/review/queue/route.ts'),
        'GET',
        project,
      ),
    ).toEqual({ schema: 'ReviewQueueResponseSchema' });

    expect(
      inferSchemaSourceA(
        routeBySuffix(routes, 'app/api/intelligence/profiles/route.ts'),
        'GET',
        project,
      ),
    ).toEqual({ schema: 'z.array(CompanyProfileSchema)' });

    expect(
      inferSchemaSourceA(
        routeBySuffix(routes, 'app/api/notifications/route.ts'),
        'GET',
        project,
      ),
    ).toEqual({ schema: 'NotificationsResponseSchema' });
  });

  it('raises the corpus-wide bindable-baseline coverage across read + write methods (>= 34)', () => {
    // 32.21 achieved 34 GET binds; ID-131.15 (G-DEDUP legacy dedup-family
    // retirement, S446) later deleted the admin content-dedup route family,
    // dropping the GET-only floor to 26 (see the real-bind-count test above).
    // Adding the 15 write-response interfaces via method-aware mutation
    // binding still raises the combined read+write bind count well above
    // the historical 34 mark. We count routes that bind a real schema for
    // ANY of their exported-style methods (GET for reads, POST/PATCH/etc for
    // writes). Assert a concrete lower bound that exceeds the GET-only floor
    // so a regression that drops the mutation walk fails this gate.
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);

    let readBinds = 0;
    let writeBinds = 0;
    for (const sf of routes) {
      if (inferSchema(sf, 'GET', project).schema !== 'z.unknown()') {
        readBinds += 1;
      }
      if (inferSchema(sf, 'POST', project).schema !== 'z.unknown()') {
        writeBinds += 1;
      }
    }

    // Combined coverage must clear 34 even with the post-ID-131.15 GET floor.
    expect(readBinds).toBeGreaterThanOrEqual(22);
    expect(writeBinds).toBeGreaterThanOrEqual(10);
    expect(readBinds + writeBinds).toBeGreaterThanOrEqual(34);
  });
});

// ── 32.28 — defect-B5 binding-correction override (route+method precedence) ─

/**
 * DEFECT-B5: the 32.20 Source-A URL-matcher bound a schema describing a
 * DIFFERENT entity to 5 routes (6 method-bindings). The matcher associates a
 * route with the FIRST baseline `fetchJson`/`mutationFetchJson` type-arg whose
 * URL aligns — for these routes that type-arg's `${interface}Schema` is the
 * WRONG shape (its required top-level keys are entirely absent from the
 * route's real 2xx body, so it rejects LOUD under the {32.25} pass-through
 * wrapper regardless of `.loose()` strictness — a binding-correctness defect,
 * NOT the nullable/strictness drift {32.26} owns).
 *
 * The correction is a route+method → schema override consulted with
 * PRECEDENCE over the heuristic chain (Source B → Source A) — surgical, so the
 * canonical `type-drift-detect.ts` URL matcher is never touched. The override
 * binds the 6 hand-authored schemas (lib/validation/schemas.ts, OUTSIDE the
 * {32.26} generated block) verified against each handler's real success
 * return. NO working-tree routes are wrapped here — the corpus rollout that
 * applies these correct bindings to the working tree is Task ID-49.
 *
 * These tests assert on the OBSERVABLE `inferSchema` output for each of the 6
 * method-bindings, plus the critical no-regression invariant that the
 * coverage/targets GET (which was CORRECTLY bound to `TargetsResponseSchema`)
 * is NOT disturbed by the method-keyed PUT override.
 *
 * Spec: docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PLAN.md §0; task-list.json
 *       ID-32.28 (RE-SCOPED, OQ-10).
 */
describe('inferSchema applies the defect-B5 binding-correction override (32.28)', () => {
  it('binds EntityCoOccurrenceResponseSchema for GET /api/entities/co-occurrence (was EntityDetailSchema)', () => {
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/entities/co-occurrence/route.ts');
    expect(inferSchema(sf, 'GET', project)).toEqual({
      schema: 'EntityCoOccurrenceResponseSchema',
    });
  });

  it('binds CoverageTargetsPutResponseSchema for PUT /api/coverage/targets (was TargetsResponseSchema)', () => {
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/coverage/targets/route.ts');
    expect(inferSchema(sf, 'PUT', project)).toEqual({
      schema: 'CoverageTargetsPutResponseSchema',
    });
  });

  it('does NOT disturb the CORRECT GET /api/coverage/targets binding (still TargetsResponseSchema)', () => {
    // The GET genuinely returns `{ targets }` and was correctly bound. The
    // method-keyed PUT override must not leak onto the GET — this guards the
    // override against a route-level (method-blind) regression.
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/coverage/targets/route.ts');
    expect(inferSchema(sf, 'GET', project)).toEqual({
      schema: 'TargetsResponseSchema',
    });
  });

  it('binds ItemPatchResponseSchema for PATCH /api/items/[id] (was PatchResponseSchema)', () => {
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/items/[id]/route.ts');
    expect(inferSchema(sf, 'PATCH', project)).toEqual({
      schema: 'ItemPatchResponseSchema',
    });
  });

  it('binds ItemDeleteResponseSchema for DELETE /api/items/[id] (was PatchResponseSchema)', () => {
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/items/[id]/route.ts');
    expect(inferSchema(sf, 'DELETE', project)).toEqual({
      schema: 'ItemDeleteResponseSchema',
    });
  });

  it('binds BatchReviewResponseSchema for POST /api/items/batch-review (was PatchResponseSchema)', () => {
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/items/batch-review/route.ts');
    expect(inferSchema(sf, 'POST', project)).toEqual({
      schema: 'BatchReviewResponseSchema',
    });
  });

  it('binds BatchWorkspacesResponseSchema for POST /api/items/batch-workspaces (was PatchResponseSchema)', () => {
    const project = createCodemodProject();
    const routes = enumerateRouteFiles(project);
    const sf = routeBySuffix(routes, 'app/api/items/batch-workspaces/route.ts');
    expect(inferSchema(sf, 'POST', project)).toEqual({
      schema: 'BatchWorkspacesResponseSchema',
    });
  });
});
