---
title: "Canonical — Test Philosophy"
---

# Canonical — Test Philosophy

<!-- Last verified: 22/07/2026 (S491 W4 docs sweep — guard-test list refreshed (2 deleted guards removed, validation-sweep path corrected), audit artefact paths marked as archived, staging terminology updated post staging-first cutover). Original extraction: kh-prod-readiness-S40 W2; six audit criteria authored by Liam 06/05/2026. -->

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

The audit identified 25 mislocated test files. The rule:

| Production code lives in… | Tests live in… | Reason |
|---|---|---|
| `app/api/**/route.ts` | `__tests__/api/**` | HTTP-handler tests; exercise the route through its handler export. |
| `app/**/page.tsx` (server components) | `__tests__/app/**` | Server component rendering tests; mock fetch at the route level. |
| `components/**/*.tsx` | `__tests__/components/**` | Component rendering + interaction tests. |
| `lib/<domain>/<file>.ts` | `__tests__/lib/<domain>/**` | Pure library tests; exercise the export. |
| `lib/validation/*.ts` | `__tests__/lib/validation/**` | Schema-validation tests; deserve their own slice for the validation-sweep guard. |
| `__tests__/integration/**` | (same — integration tier) | Real-Anthropic + real-Supabase tests; must hit the live Platform staging DB (`rbwqewalexrzgxtvcqrh`), never mocks. |
| `e2e/tests/**` | (same — E2E tier) | Playwright end-to-end specs against staging deployment. |

A test file's location should be derivable from its production-code import. If a test under `__tests__/api/` exclusively imports from `lib/`, it is mislocated.

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

Guard tests fail the build when structural drift is introduced. They protect the test discipline itself. The current guard-test surface includes:

- `__tests__/mcp/mcp-fixture-sync.test.ts` — MCP tool/resource/prompt registrations match the inventory file.
- `__tests__/validation/validation-sweep.test.ts` — every API route reading `searchParams` or body must use `parseBody` / `parseSearchParams` from `@/lib/validation`, never inline `.safeParse()`.

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

## 10. When this document changes

- Adding a new criterion: ratify with Liam first; new criteria affect every existing test.
- Adding an antipattern: include cross-link to the file or PR where it was first observed.
- Updating mock guidance: include the failure mode that motivated the update (memory-feedback-style).
- Bumping the Last-verified date: same commit as content changes (tracked-doc freshness guard).
