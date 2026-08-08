---
title: "Canonical — Test Philosophy"
---

# Canonical — Test Philosophy

<!-- Last verified: 08/08/2026 (workstream 3 factoring: §3.4 gains the three-way collision (three files, not two, landed on `lib/validation/schemas.ts` — united, 88 tests before and after) and a third merge hazard, an inert `vi.mock()` going live on merge because it hoists into whatever file it lands in. `__tests__/validation/` is retired. Earlier the same day: `__tests__/guards/` populated — §8's guard list re-pointed there and extended to five entries, §3.2 records that a guard may import a production module as a *helper* without that module being its subject, and that the subject test (not the filename) decides. Verified by executing the moves, not by review: the D-8 URL-normalisation parity file was measured to import and execute `normaliseUrl`, failed the source-scanning test, and went to its mirror path instead. Earlier: 08/08/2026 §3.4 rewritten after the 2b factoring pass executed: the guides example is now historical, a third failure mode is named — a test at a path with no production module, which the codemod also passes — and the collision-means-same-route-not-same-behaviour rule plus the two merge hazards (load-bearing fixture shapes, per-file shared state crossing a threshold) are recorded. Verified by executing the splits, not by review: 16 escalations to 3, 1249 tests green under __tests__/app/api. Earlier: 07/08/2026 §3 rewritten around the single mirror rule — test path equals production path; the prior `app/api/**` → `__tests__/api/**` row is reversed and the rationale recorded in §3.1. Adds §3.3 naming, §3.4 location-is-not-factoring, §3.5 codemod. Earlier: 22/07/2026 S491 W4 docs sweep — guard-test list refreshed, audit artefact paths marked as archived, staging terminology updated post staging-first cutover). Original extraction: kh-prod-readiness-S40 W2; six audit criteria authored by Liam 06/05/2026. -->

**Status:** Active reference.

This document is the canonical reference for writing, reviewing, and remediating tests in the Canonical platform. It is the source of truth for test-discipline decisions; the test-audit programme (audit artefacts now archived in the `knowledge-hub-archive` repo) executed against the criteria captured here.

> **Cross-links:**
> - `CLAUDE.md` Key References — points here (`docs/reference/testing/`).
> - `consolidated-findings.md` — observed antipatterns + remediation classification (`knowledge-hub-archive` repo).
> - `remediation-plan.md` — wave plan for fixing existing-test gaps (W-RA…W-RH) (`knowledge-hub-archive` repo).
> - `0-9-synthesis-impact.md` — wave-level disposition under Phase 0.9 architecture proposal (docs-site).

---

## 1. The six audit criteria (Liam, 06/05/2026)

These are the criteria every test in the codebase is audited against. New tests must satisfy all six.

1. **Tests verify expected behaviour, treating implementation as a black box.** What the user (human or AI consumer) observes must drive the assertion shape. Internal call patterns are not behaviour.
2. **Tests exercise the public API exclusively.** Reach the system through its export surface — HTTP routes, exported library functions, MCP tool calls, rendered components — never private helpers, internal class fields, or mocked module internals.
3. **Tests that examine internal implementation details are wasteful and must be avoided.** Asserting on chain-method ordering, mock call counts beyond minimum, or specific class-name strings makes the test brittle to refactor without proving correctness.
4. **Coverage targets: 100% coverage is expected at all times — but every test must always be based on business behaviour, not implementation details.** Coverage is not a goal in itself; behaviour-asserting tests that happen to cover everything are the goal.
5. **Tests document expected business behaviour.** Test titles should read like product specs ("rejects unauthorised users with 403", "renders empty-state CTA when search returns zero results"), not framework descriptions ("calls supabase.from with users", "passes auth header to fetch").
6. **Use factory functions with optional overrides for test data.** A test creating a content item should call `validCreateBody({ title: 'Custom' })`, not hand-roll a 25-field object literal. Factories absorb schema drift; literal objects propagate it.

---

## 2. Three observed antipatterns (consolidated-findings.md §3)

The cross-tree audit (Agents A-E, 813 files) ranked three remediation themes by site count. Avoid these in new code; remediate when found.

### 2.1 Assertion-shape coupling (3 forms)

Tests that pass only when the implementation calls a chain in a specific order, or renders a specific class string. Brittle by construction — refactors break tests without breaking behaviour.

- **Chain-method asserts** (~92 sites in api+lib): `expect(_chain.from).toHaveBeenCalledWith('users')` then `expect(_chain.eq).toHaveBeenCalledWith('id', X)`. Replace with response-body assertions on the route or returned value of the lib helper.
- **CSS-class state coupling** (~155 sites in components): `expect(button).toHaveClass('text-error-foreground')`. Replace with `getByRole('alert')`, `aria-invalid` attribute, or `getByText` of the visible error message.
- **E2E conditional false-pass** (~12 sites in 7 specs): `if (await X.isVisible().catch(() => false)) { … }`. Replace with hard `await expect(X).toBeVisible()`. The conditional fallback silently passes on empty DBs or missing fixtures; the hard expect fails honestly.

### 2.2 Factory consolidation (single largest LOC win)

24 MCP test files each carry a near-duplicate `createMockMcpServer()` definition (~600 LOC saving on consolidation). Multiple file/cron/Supabase-client mock factories also drift across files. Pattern: extract canonical factory absorbing the most-permissive variation into `__tests__/helpers/<topic>.ts`, expose a `Partial<T>` overrides parameter, refactor call sites to use the helper.

Reference implementation: `__tests__/helpers/mock-supabase.ts` (`createMockSupabaseClient()`); `__tests__/helpers/mcp-server.ts` (W-RA target).

### 2.3 Implementation-shaped `it()` titles (~155 actionable + 86 borderline)

Titles that describe code shape rather than user-observable outcome. Patterns:

| Antipattern | Replacement |
|---|---|
| `it('passes the headers to fetch')` | `it('applies workspace token to outbound request')` (action → observable result) |
| `it('calls supabase.from with users')` | `it('lists users in the workspace')` (verb → noun) |
| `it('configures the route with auth')` | `it('requires authentication for /api/items')` |
| `it('wraps the handler with logging')` | `it('emits structured-log entry per request')` |

Keep `it('calls X')` only when the side effect IS the observable behaviour and the assertion verifies the payload (e.g. `it('calls Slack webhook with bid-deadline message')` followed by an assertion on the message body).

---

## 3. Test location rules

**One rule, no exceptions: a test's path under `__tests__/` equals its production path from the repo root.**

| Production module | Test path |
|---|---|
| `app/api/procurement/[id]/export/route.ts` | `__tests__/app/api/procurement/[id]/export/route.test.ts` |
| `app/settings/page.tsx` | `__tests__/app/settings/page.test.tsx` |
| `app/item/new/new-item-tabs.tsx` | `__tests__/app/item/new/new-item-tabs.test.tsx` |
| `components/settings/settings-sidebar.tsx` | `__tests__/components/settings/settings-sidebar.test.tsx` |
| `lib/domains/procurement/ai/<file>.ts` | `__tests__/lib/domains/procurement/ai/**` |
| `lib/mcp/tools/review.ts` | `__tests__/lib/mcp/tools/review.test.ts` |

Strip the `__tests__/` prefix and you have the production path. Directories mirror it exactly, **including `[param]` brackets** — `__tests__/app/api/refinement/touchpoints/[id]/`, never `.../touchpoints/id/`. Filenames are the production module's basename: `route.test.ts`, `page.test.tsx`, `new-item-tabs.test.tsx`. The parent directory name is never repeated in the filename (`procurement/[id]/export/route.test.ts`, not `procurement/procurement-export.test.ts`).

### 3.1 Why the mirror, and why the earlier rule was wrong

This section previously sent `app/api/**/route.ts` tests to `__tests__/api/**`, eliding the `app/` segment. That was reversed on 07/08/2026 after measuring the tree: of the 18 top-level directories under `__tests__/`, nine already mirrored a production directory exactly and six were test infrastructure with no production counterpart. Exactly three elided their production parent — `api` (for `app/api`), `validation` (for `lib/validation`) and `mcp` (for `lib/mcp`) — and those three were precisely the directories that had produced split trees, duplicate filenames and repeated confusion about where a new test belongs. The elision was the anomaly, not the fix.

Next.js is explicitly unopinionated about test organisation, so this is a project convention rather than a framework requirement. Note that domain-first organisation cannot apply to the route surface: Next.js derives the URL from the path, so `app/api/**` stays layer-first permanently. Domain-first is correct for `lib/` and already holds there (`lib/domains/procurement/` ↔ `__tests__/lib/domains/procurement/`).

### 3.2 Directories that mirror nothing

Test infrastructure and tiers keep their own names, because there is no production path to mirror: `__tests__/helpers/`, `__tests__/fixtures/`, `__tests__/integration/` (real-Anthropic + real-Supabase tier; must hit the live Platform staging DB `rbwqewalexrzgxtvcqrh`, never mocks), `__tests__/build/`, `__tests__/workflows/` and `__tests__/pipeline/`. `e2e/tests/**` is its own Playwright tier outside `__tests__/`.

`__tests__/guards/` holds the structural guards — tests that scan source or tracked bytes rather than exercising an export, and so have no production module to mirror. See §8 for the current set and for the test of what belongs there.

The three directories that used to elide their production parent are all gone: `__tests__/api/` merged into `__tests__/app/api/`, and `__tests__/validation/` and `__tests__/mcp/` split between their mirror homes (`__tests__/lib/validation/`, `__tests__/lib/mcp/`) and `__tests__/guards/`. Every remaining top-level directory either mirrors a production path or is listed above.

A guard may still *import* a production module as a **helper** — a path resolver or a manifest loader — without that module being its subject. `corpus-manifest.test.ts` loads `@/lib/corpus/fixture-manifest` and `eval-fixture-sync.test.ts` calls `resolveEvalFixture`, but neither asserts on that module's behaviour; the assertions are about the fixture bytes on disk. The distinguishing question is what the assertions are *about*, and the giveaway is that the real subject tests already exist at the mirror paths (`__tests__/lib/eval/fixtures.test.ts` covers `resolveEvalFixture` itself).

Within the mirror, Next.js private-folder syntax groups without implying a route. `__tests__/app/api/_cross-cutting/` holds tests that deliberately reach several unrelated routes to prove a shared property — auth enforcement, validation behaviour — and so have no single production path.

### 3.3 When one production module needs several test files

Prefer **one test file per production module**. A second file covering the same module is usually a signal that the files are wrongly factored rather than that they need distinguishing names — see §3.4.

The exception is a genuine variant of the same subject, where the aspect is carried as a dot-separated suffix on the module basename: `page.mobile.test.tsx` alongside `page.test.tsx`. Established instances include `__tests__/app/layout.branding.test.tsx` and the pair `__tests__/lib/client-config.branding.test.ts` / `client-config.loader.test.ts`. Hyphenated forms (`page-mobile`) are not used — a hyphen reads as part of the module name, and flattening it loses the aspect. Do not reach for a new dot-suffix to resolve a collision; resolve the factoring instead.

### 3.4 Location is not factoring

The mirror rule constrains *where* a file sits, not *what it covers*. Three failure modes survive a correct location, all three observed during the 2b factoring pass and all three reported OK by the codemod:

- **A multi-route file parked at its common ancestor.** The former `__tests__/app/api/guides/guides.test.ts` covered three routes from the `guides/` directory; because that directory *is* their common ancestor, its location was derivable and the codemod passed it. Split so each route has one test file.
- **One route split across files by HTTP method.** Two files each testing a different verb on the same handler read as though they cover different routes. Merge them. Note the inverse also occurs and is *not* a defect: one handler serving two query shapes (`review/queue/route.ts` pivots on `?publication_status=in_review`) is still one route, so it stays one file.
- **A file at a path where no production module exists.** `__tests__/app/api/procurement/[id]/export/route.test.ts` sat at a path whose `route.ts` had never existed; it actually covered `export/docx` and `export/xlsx`. Deriving a *plausible* path is not the same as hitting a real one, and the codemod checks only the former.

When a mechanical move would land two files on the same path, that collision is the signal to review the factoring — not to invent a suffix.

A collision is not always a pair. Applying the mirror rule to `lib/validation/schemas.ts` landed **three** files on one path — a `schemas.test.ts` from each of the two trees plus `__tests__/validation/validation.test.ts`, whose name suggested it tested the validation *mechanism* but which imported `@/lib/validation/schemas` and nothing else. The three shared zero exports and zero assertions, so all three were united (88 tests before, 88 after). Read the imports, not the filename: the file that looks like the odd one out may be the third copy.

**A collision means "same route". It never means "same behaviour".** Resolve it by comparing assertions, not filenames. `guides.test.ts` and `guides/route.test.ts` both hit `GET /api/guides` and shared *zero* assertions: one proved the retired `?include=stats` leg is inert, the other proved auth and filtering. The merge was a union, and treating it as de-duplication would have silently deleted a regression guard. Where a genuine duplicate does exist, prefer folding the incoming case's extra assertions onto the survivor over keeping two near-twins.

### The merge hazards, and the one principle behind them

**A test file boundary is a silent isolation boundary. Merging two files merges everything it was isolating — and the merged file passes on the day while already being wrong.** That single property produced every merge hazard observed in the 2b/workstream-3 pass. It fails later, under someone else's change, which is what makes it worth naming rather than learning twice:

- **`vi.mock()` hoists into whatever file it lands in, so an inert mock becomes live.** The D-8 URL-normalisation parity file mocked `@/lib/logger` and `@/lib/intelligence/rate-limiter` — vestigial from when `normaliseUrl` lived in `content-extractor.ts`, and dead where they sat. Carried across, they would have applied to the surviving file's other block. Check what the *subject* actually imports; here it imports nothing at all, and dropping both was confirmed by execution.
- **Module-level mutable state accumulates per file, so two under-cap files can merge to over-cap.** `review/queue/route.ts` rate-limits 20 GETs/min on an in-memory counter that persists across tests within a file. Two files of 13 and 7 calls each passed alone; merged they sat exactly at the cap — green that day, 429 on the next case anyone added. Reset such state in `beforeEach` and say why.

One further hazard is not about isolation but is easy to mistake for tidying:

- **Fixture shapes can be load-bearing on the production contract.** Unifying a sparse fixture with a fully-populated one looks like cleanup. In the guides case, nine projected columns are marked `.optional()` in the route *because* the sparse assertions exist, and the route's own comment named the test as the reason. Normalising the fixtures would have been a production-contract change. Read the production module first.

### 3.5 Tooling

`scripts/codemods/align-test-paths.ts` derives the correct path for every test under `__tests__/app/` and moves it with `git mv`. Dry-run by default; `--apply` to write; `--scope` to restrict. Reports land in the gitignored `docs/generated/`.

It resolves the subject under test from the AST, counting only imported `@/app/**` modules and excluding `vi.mock()` / `vi.doMock()` arguments — a mocked module is a dependency, not the subject. A regex approach cannot make that distinction and mis-routes files that mock a sibling module.

It escalates rather than guesses: target collisions, occupied targets, files with no subject import, multi-route files whose filename is a naming decision, and catch-all buckets needing a content split. Escalated files are left byte-identical and listed in `docs/generated/align-test-paths-needs-manual.json`.

**A clean run is weaker evidence than it looks.** The codemod checks that a test's path matches its *imports*; it never checks that the imported production module *exists*. `__tests__/app/api/procurement/[id]/export/route.test.ts` reported OK against an `app/api/procurement/[id]/export/route.ts` that has never existed. So a clean run means "derivable", not "correct" — §3.4 still applies, and a location guard built on this tool must add an existence check rather than inherit the gap.

---

## 4. Test runner discipline

| Runner | Command | Scope |
|---|---|---|
| Vitest unit/component | `bun run test` | Excludes `__tests__/integration/**`. Default fast suite. |
| Vitest integration | `bun run test:integration` | `__tests__/integration/**.integration.test.ts` only; uses real Anthropic + real Supabase persistent staging branch. |
| Vitest watch | `bun run test:watch` | Watch mode. |
| Vitest changed | `vitest --changed` | Stop-hook scope; `bun run test` is full regression. |
| Playwright E2E | `bun run test:e2e` | `e2e/tests/**`; runs against staging (`https://canonical-platform-git-staging-tw-group.vercel.app`). |
| MCP eval Layer 1 | `bun run test:mcp-eval` | Protocol compliance (42 checks). |
| MCP eval Layer 3 | `bun run test:mcp-eval:rq` | Response quality (17 checks). |
| MCP eval Layer 4 | `bun run test:mcp-eval:fc` | Functional correctness (37 checks; live DB). |

`bun test` (no `run`) invokes Bun's native runner — **NOT Vitest** — and will fail in unexpected ways. Always use `bun run test`.

---

## 5. Mock discipline

### 5.1 Default to real where the cost is acceptable

- **Database:** integration tests hit the Platform staging DB; unit tests use `createMockSupabaseClient()` from `__tests__/helpers/mock-supabase.ts`. Never mock the database in integration tests — prior incident: mocked tests passed but a prod migration failed.
- **AI calls:** integration tests use real Anthropic (with the project Anthropic API key); unit tests inject a mock client at the boundary. Token costs of integration runs are budgeted.
- **Time:** use `vi.spyOn(Date, 'now')` with a fixed timestamp (`new Date('2026-01-15T12:00:00Z').getTime()`) — never construct `Date` directly. The constructor is not stubbed by `vi.spyOn(Date, 'now')`; tests using `new Date()` see real time and flake at midnight boundaries.

### 5.2 `vi.mock()` discipline

- Use `vi.hoisted()` for mock variables that need to be referenced before the mock body runs.
- Arrow functions in `mockImplementation()` cannot be used with `new` — use `function` keyword if the SUT uses `new MockedThing()`.
- When centralised constants change, sweep `vi.mock()` blocks for stale literal copies — they default to literal duplicates of the constant, not `actual.X` re-exports, and silently drift.

### 5.3 Mock the boundary, not the unit

Mock at the seam where the SUT meets the outside world (HTTP, DB, Anthropic SDK), not at every internal helper. Over-mocking creates tests that pass with broken implementations.

---

## 6. UUID + data validity in tests

- **Zod UUID validation is strict (RFC 4122).** Test UUIDs like `00000000-...0001` fail validation. Use real v4 UUIDs (`gen_random_uuid()` shapes) for any field that flows through Zod validation.
- **Pipeline service-account UUID:** `a0000000-0000-4000-8000-000000000001` for any `userId` parameter to classification helpers. Literal strings fail.
- **Test users:** `.env.local` exposes `TEST_USER_1` / `TEST_USER_2` / `TEST_USER_3` with admin / editor / viewer roles. Reference them, don't invent new ones.

---

## 7. Common framework gotchas

### 7.1 React + jsdom

- Radix Select needs pointer-event shims in jsdom. Call `installRadixPointerShims()` from `@/__tests__/helpers/radix-pointer-shims` in `beforeEach` for any test rendering a `<Select>`.
- React `act()` warnings cluster into 3 classes: bare `dispatchEvent`, child `useEffect`-fetch, `waitFor` drain. Classify before fixing — see `feedback_react_act_warning_classes` memory.

### 7.2 Playwright

- Browser install is required after `pip install`: `python3 -m playwright install chromium`. Version mismatches surface as obscure failures.
- Mobile viewport (Pixel 5) may need `click({ force: true })` or `dispatchEvent('click')` for partially obscured buttons.
- Always `waitFor({ state: 'visible' })` before `fill()` on login inputs — otherwise auth-flow timing flakes.

### 7.3 TanStack Query

- Component tests using a hook that depends on a query must wrap the component in a `QueryClientProvider`. Use `createQueryWrapper().Wrapper` from `__tests__/helpers/query-wrapper.tsx` (`feedback_searchbar_query_provider`).

---

## 8. Guard tests are tests too

Guard tests fail the build when structural drift is introduced. They protect the test discipline itself. A guard scans source or tracked bytes rather than exercising an export, so it has no production module to mirror and lives in `__tests__/guards/` (§3.2):

- `__tests__/guards/mcp-fixture-sync.test.ts` — MCP tool/resource/prompt registrations match the inventory file.
- `__tests__/guards/validation-sweep.test.ts` — every API route reading `searchParams` or body must use `parseBody` / `parseSearchParams` from `@/lib/validation`, never inline `.safeParse()`.
- `__tests__/guards/corpus-manifest.test.ts` — the corpus fixture register (`docs/reference/testing/corpus-manifest.json`) covers exactly the tracked fixture bytes, every fixture declares a live consumer (the orphan rule), and `verify_driver.py`'s `FIXTURE_SETS` agrees with it.
- `__tests__/guards/eval-fixture-sync.test.ts` — the eval gold-standard fixtures exist and are not truncated.
- `__tests__/guards/procurement-form-reanchor-guard.test.ts` — the two procurement umbrella write routes never persist the form-anchored engagement keys back into `workspaces.domain_metadata` (ID-130 T-B9 dual-writer guard).

Not every guard has moved yet. `__tests__/docs/` still holds four source-scanning guards (`test-classname-token-coupling`, `test-impl-shaped-titles`, `strict-tool-schema-subset`, `user-scratch-citations`) that import no production module and so meet the same test; rehoming them is an open follow-up, not a ruling that `__tests__/docs/` is correct. The test of whether a file belongs here is its **subject**, not its name or its self-description: the D-8 URL-normalisation parity guard was proposed for this directory and rejected, because it *executes* `normaliseUrl` against a shared fixture rather than reading source. Its subject is a production module, so the mirror rule wins and it lands at `__tests__/lib/extraction/url-normalise.test.ts`.

(Former guards `no-app-guc-rls-policy.test.ts` and `pipeline-parity.test.ts` were deliberately retired — the first with the migration squash, the second with the obsolete `kb_pipeline` removal.)

When adding a new tool / fixture / lifecycle helper, update the guard test in the same commit.

---

## 9. The production-readiness audit lineage

The Phase 1 audit (kh-prod-readiness S37+S38, finalised May 2026) ran 5 parallel sub-agents (A, B, C, D, E) across 813 source files using `ts-morph` + `ast-grep` to flag rule violations against the 6 criteria above. Output: `consolidated-findings.md` (cross-tree per-criterion histogram + top-50) and `remediation-plan.md` (8 partitioned waves W-RA…W-RH, ~44-59h aggregate).

Findings highlights:

- **C1 (behaviour-not-implementation) + C4 (factory functions): zero violations** across all 813 files.
- **Integration tier (30 files): zero violations** — the gold-standard reference template.
- **C3 (chain-method coupling): ~92 sites** in api+lib (largest behavioural-coupling cluster).
- **C2 (mislocation): 25 files** with cross-tree mislocations.
- **C5 (implementation-shaped titles): ~155 sites** for rewrite + 86 borderline.

The 8 remediation waves are tracked at `docs/audits/kh-production-readiness-phase-1/STATUS.md` (`knowledge-hub-archive`) repo, and disposition under Phase 0.9 architecture proposal at `0-9-synthesis-impact.md` (docs-site).

---

## 10. Proving a data-shape invariant (DR-094, re-homed S504)

A data-shape invariant ("column X is never NULL under the new writer", "every row
carries provenance Y") is proven ONLY by rows **written under the new code** —
pre-existing rows prove nothing about the writer, and a green suite over legacy
fixtures is not evidence. Write through the new path, then assert on what landed.

## 11. When this document changes

- Adding a new criterion: ratify with Liam first; new criteria affect every existing test.
- Adding an antipattern: include cross-link to the file or PR where it was first observed.
- Updating mock guidance: include the failure mode that motivated the update (memory-feedback-style).
- Bumping the Last-verified date: same commit as content changes (tracked-doc freshness guard).
