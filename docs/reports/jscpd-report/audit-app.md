# Audit — area: `app/` (Next.js App Router: routes + API)

Branch: `jscpd-dupe-audit`. Read-only. Evidence anchored to jscpd raw clones
(`docs/reports/jscpd-report/jscpd-report.json`), `analysis.json` crossdir/hot_files,
ast-dataflow caller proofs, and unsandboxed grep. 0-caller != retire rule applied.

## Headline metrics

- **139 of 205 `app/api/**/route.ts` files (68%) participate in >=1 jscpd clone.** The
  clone fragments are overwhelmingly the same route preamble: `getAuthorisedClient([...])`
  + `authFailureResponse` + `UUID_RE.test(id)` 400 + `request.json()` try/catch +
  `parseBody(Schema, raw)` + the trailing `catch { safeErrorMessage(...) 500 }` envelope.
  This is a MISSING SHARED ROUTE-HELPER LAYER, not 139 independent defects.
- `app/api` cross-dir clone partners (analysis.json crossdir): `lib/queue` (266 tok),
  `lib/procurement` (114 tok), `lib/ai` (51 tok), `lib` (122 tok) — business logic is
  duplicated across the route<->lib boundary (see Finding APP-2, APP-3).

## Finding APP-1 — dedup admin route family shares ~90% logic (HOT node)

Files:
- `app/api/admin/content-dedup/[id]/confirm-duplicate/route.ts` (189 LOC; jscpd hot_file #2: 15 pairs / 1457 tok)
- `app/api/admin/content-dedup/[id]/confirm-unique/route.ts` (172 LOC)
- `app/api/admin/content-dedup/[id]/supersede/route.ts` (393 LOC; hot_file: 8 pairs)
- sibling near-dup family: `near-duplicates/[pairId]/confirm-unique/route.ts` <-> `.../merge/route.ts` (154 tok clone)

jscpd exact clones (raw report):
- confirm-duplicate **L1-70 == confirm-unique L1-70 (289 tok, near-identical)** — imports,
  `maxDuration`, `UUID_RE`, POST signature, auth, UUID check, JSON parse, `parseBody`,
  AND the idempotency guard (load subject -> `dedup_status !== 'suspected_duplicate'` -> 409).
- confirm-duplicate L116-134 == confirm-unique L107-124 (74 tok) — `content_history`
  version-lookup block.
- confirm-duplicate L143-156 == confirm-unique L133-146 (73 tok) — `content_history` insert block.
- confirm-duplicate L58-70 == supersede L93-105 (58 tok) and L70-94 == supersede L105-131
  (89 tok) — supersede shares the same subject-load + idempotency preamble.

The ONLY real difference between confirm-duplicate and confirm-unique: confirm-duplicate
also writes `archived_at/archived_by/archive_reason` and sets `dedup_status='confirmed_duplicate'`
with `change_type='archive'`; confirm-unique only flips to `'confirmed_unique'` with
`change_type='metadata_change'`. supersede delegates the retire to the already-shared
`setSupersession()` helper but re-implements the preamble + its own history snapshots.

LIVE (not dead): `components/admin/content-dedup/content-dedup-action-buttons.tsx` POSTs to
all three (L80 confirm-duplicate, L93 confirm-unique, L114 supersede). KEEP the endpoints;
consolidate the bodies.

Recommendation: extract a `resolveDedupSubject(request, params, supabase)` guard
(auth+UUID+parseBody+load+idempotency-409, returns `{subject, note}` or an early `Response`)
+ a `writeDedupHistory(supabase, subject, {changeType, changeReason, summary, user})` helper
into `lib/dedup/` (or `lib/supersession/`). Each route then becomes the ~15-line
status-specific tail. Saves ~150 LOC across the family. Risk: low (pure refactor behind a
verified caller set; route response shapes unchanged).

## Finding APP-2 — procurement drafting loop copied across 3 production sites

`runDraftingPipeline` (`lib/ai/draft.ts`) is the shared drafting PRIMITIVE (good). But the
ORCHESTRATION LOOP around it — fetch `form_questions`, skip `no_content`/`already_drafted`,
fetch `matched_content_ids` -> `content_items`, call pipeline, upsert `form_responses`
`onConflict question_id`, update question `status='ai_drafted'`, aggregate cost/tokens — is
copy-pasted. ast-dataflow `callers --symbol lib/ai/draft.ts:runDraftingPipeline` (production):
- `app/api/procurement/[id]/responses/draft/route.ts:203` (fn:POST) — single/multi-question sync loop (290 LOC)
- `lib/queue/handlers/procurement-draft-all.ts:282` (fn:runBidDraftAllJob) — batch loop (410 LOC)
- `app/api/procurement/[id]/responses/[rId]/regenerate/route.ts:121` (fn:POST)
- `app/api/procurement/[id]/responses/draft-stream/route.ts` (grep: same `form_responses`
  upsert + `matched_content_ids` fetch at L119/L288-290; SSE variant, 432 LOC)

The queue handler's OWN docstring (L6-8) admits: "Source-of-truth for the loop body: literal
extraction from `.../draft-all/route.ts:80-301`". analysis.json crossdir confirms
`draft/route.ts <-> procurement-draft-all.ts` (215 tok) and `app/api <-> lib/queue` (266 tok).
NOTE: `draft-all/route.ts` itself is ALREADY refactored to a thin 202-enqueue (heavy loop
moved to the queue handler) — so the surviving copies are draft + handler + draft-stream + regenerate.

Recommendation: extract one `draftQuestions(questions, {supabase, modelTier, force/skipExisting})`
core into `lib/ai/draft.ts` (or `lib/procurement/drafting-loop.ts`) returning the per-question
results + totals. The 3 route/handler callers reduce to: validate -> load questions ->
`draftQuestions(...)` -> shape response (sync JSON / SSE / batch-result envelope). Saves
~250 LOC. Risk: medium — behaviour-preserving extraction touching the live drafting path
(draft-stream's SSE emission must stay; the LOOP is what's shared, not the transport).

## Finding APP-3 — activity feed RPC->ActivityItem mapping duplicated route<->lib

`app/api/activity/route.ts` L46-83 calls `supabase.rpc('get_grouped_activity_feed', ...)`
then maps each row `latest_at -> created_at` into the `ActivityItem` shape. `lib/dashboard.ts`
L305/L444-460 does the IDENTICAL RPC call + IDENTICAL `latest_at -> created_at` mapping.
`ActivityItem`/`GroupedActivityItem` interfaces are DEFINED in `lib/dashboard.ts:50,60` — the
route re-maps to that shape WITHOUT importing a shared mapper. analysis.json crossdir:
`app/api/activity/route.ts <-> lib/dashboard.ts`. Wikipedia-Principle violation: one fact
(the RPC-row -> ActivityItem projection) with two homes to keep in sync.

Recommendation: export `mapActivityRow(row): ActivityItem` (or
`fetchGroupedActivity(supabase, {limit, before})`) from `lib/dashboard.ts`; the route imports
it. Saves ~25 LOC + removes a drift risk. Risk: low.

## Finding APP-4 — error.tsx boundary boilerplate (22 files)

22 `app/**/error.tsx` files. All share the identical head: `'use client'` + Sentry +
`useEffect(() => { logger.error(...); Sentry.captureException(error) }, [error])` + the
`<div role="alert" class="mx-auto flex max-w-7xl flex-col items-center ...">` shell with a
lucide icon, an `<h2>`, a `<p>`, and `<Button onClick={reset}>Try again</Button>` (+ optional
"Return home" Link). Only the icon, heading, and body copy vary. analysis.json crossdir lists
the cluster: browse<->procurement/provenance/settings/reference error.tsx,
coverage<->app/error.tsx, documents/diff<->item/[id], intelligence<->workspaces, item/new<->coverage.

Next.js REQUIRES a file per route segment (a segment cannot import another segment's
boundary), so the FILES must stay — but the BODY can be one shared
`components/errors/error-boundary-shell.tsx` taking `{icon, heading, body, error, reset,
showHome?}`. Each `error.tsx` shrinks to ~8 lines. Saves ~30 LOC and centralises the
Sentry/logger wiring (today each file repeats it; a missed Sentry call is invisible drift).
Risk: low.

## Finding APP-5 — route-preamble boilerplate is the ID-50 `defineRoute` target (DO NOT build a competing helper)

`lib/api/define-route.ts` EXISTS (recovered for ID-50, per its docstring -> ops-t1-codemod
TECH §2.4a). It is a Zod response-schema PASS-THROUGH wrapper. Current adoption: **1 real
app caller** — `app/api/intelligence/workspaces/[id]/metrics/route.ts` (grep + GitNexus). The
other "matches" are the schema registry (`lib/validation/schemas.ts`) and ast-dataflow's own
type-drift fixture. So the infra is recovered but the rollout is essentially un-started.

Caveat: as written, `defineRoute(schema, handler)` wraps RESPONSE validation only — it does
NOT itself absorb the auth-guard / UUID-check / parseBody REQUEST preamble that the 139/205
clones are made of. The ID-50 rollout (codemod) is the right HOME for standardising routes,
but to actually retire the preamble clones it needs a companion request-side primitive
(an auth+params+body guard the handler composes). Recommendation: flag APP-1/APP-5 boilerplate
to ID-50 as the in-scope consumer; do NOT introduce a parallel `withRoute`/`apiHandler` helper
that competes with `defineRoute`. The `review/queue/route.ts` HOT file (7 internal self-clones,
14 pairs) is the best pilot target. Risk: n/a (planning hand-off, not a code change here).

## Finding APP-6 — `bid` -> `procurement`/`form` rename residue (collapse-list direction)

Directories are already renamed (`app/api/procurement/`, `app/procurement/`; no `bid/`,
`bids/`, or `digest/` dirs remain — collapse-list rename mostly shipped). BUT residue persists
in code/comments/copy:
- 44 files under `app/` reference bare `bid`/`bids`. JSDoc `@route` strings still document the
  OLD paths: `app/api/procurement/route.ts:20` `/** GET /api/bids ... */`,
  `app/api/procurement/[id]/route.ts:25/131/252`, `.../tender/route.ts:57`,
  `.../responses/draft/route.ts:24` `POST /api/bids/:id/responses/draft`,
  `.../outcome/route.ts:18`, etc. The documented endpoint does not exist (`/api/bids` 404s).
- `app/procurement/error.tsx` user copy still says "Couldn't load this bid" / "The bid data".
- `lib/dashboard.ts` still uses `entity_type: 'bid_response'`, `active_bids`, `bid_summary`
  identifiers (cross-area, noted).
- `app/api/admin/batch-reclassify/route.ts:30` comment references the old
  `app/api/bids/[id]/responses/draft-all/route.ts` path.

Recommendation: doc/identifier rename sweep (`bid` -> `procurement`/`form` per collapse-list,
DB enum `bid_response` is a separate schema-touching item — note, don't action). Low value but
low risk; bundle into the ID-50 route pass or a dedicated rename PR. Use `gitnexus_rename` for
identifiers, manual for comments. Risk: low (comments/copy); medium if DB enum touched.

## Structure notes (target alignment)

- The 6-domain model wants "one architectural pattern, not bespoke verticals." The route layer
  today has NO shared pattern — every route re-derives auth+UUID+parse+envelope. The ID-50
  `defineRoute` rollout (APP-5) is the single highest-leverage structural fix for `app/`.
- Business logic leaking into routes (APP-2, APP-3): the drafting loop and activity mapping
  belong in `lib/` (the route should be a thin transport adapter). Several routes already do
  this well (supersede -> `setSupersession`, draft-all -> queue handler) — extend that
  discipline.
- `app/api/admin/content-dedup/` and `.../content-dedup/near-duplicates/` are two parallel
  implementations of the same review surface (6+ component clones, 154-tok route clone). If the
  near-duplicate flow is the successor, the two should share a single
  `lib/dedup/review-actions` core (APP-1 generalised).
