# Test Audit — Consolidated Findings (kh-prod-readiness-S37 W5 + S38 W3 fan-out → S38 W4 synthesis)

> Authoring agent: kh-prod-readiness-S38 main session, 07/05/2026. Inputs:
> `agent-a-output.md` (S37 pilot, api/, 140 files), `agent-b-output.md` (S38,
> components/, 237 files), `agent-c-output.md` (S38, lib/, 171 files),
> `agent-d-output.md` (S38, mixed slice, 188 files actual), `agent-e-output.md`
> (S38, e2e/tests/ + integration/, 77 files). Drives: `remediation-plan.md`
> (sibling) → roadmap §8.0a.2 IMPL waves S39+. Read-only synthesis. No code
> changes.

## 1. Cross-tree scope

| Slice     | Tree                                                                                                                                         | Files        | Agent | Session        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----- | -------------- |
| A         | `__tests__/api/`                                                                                                                             | 140          | A     | S37 W5 (pilot) |
| B         | `__tests__/components/`                                                                                                                      | 237          | B     | S38 W3         |
| C         | `__tests__/lib/`                                                                                                                             | 171          | C     | S38 W3         |
| D         | `__tests__/hooks/` + `app/` + `mcp/` + `scripts/` + `contexts/` + `validation/` + `eval/` + `migrations/` + `docs/` + `build/` + `fixtures/` | 188 (actual) | D     | S38 W3         |
| E         | `e2e/tests/` (47) + `__tests__/integration/` (30)                                                                                            | 77           | E     | S38 W3         |
| **Total** | All audit-scoped trees                                                                                                                       | **813**      | —     | S37 + S38      |

**Out of scope (deferred follow-ups):** `scripts/tests/**` (Python pytest tree);
`__tests__/helpers/**` (no tests); test fixture / setup files. Per
scope-and-dispatch.md §1.2.

## 2. Per-criterion histogram (cross-tree)

| Criterion                                   | A api               | B components                                  | C lib                                  | D mixed                                                      | E e2e+integration                                                    | Cross-tree total                                                                   |
| ------------------------------------------- | ------------------- | --------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **C1 black-box**                            | 0                   | 0                                             | 0                                      | 0                                                            | 0                                                                    | **0 violations**                                                                   |
| **C2 public API (mislocation)**             | 9                   | 14 (soft)                                     | 1 (reverse)                            | 1                                                            | 0                                                                    | **25 mislocations**                                                                |
| **C3 internal-detail (chain-shape)**        | 23 files / 67 sites | n/a                                           | 7 files / 23 sites                     | 4 real + 2 borderline                                        | 0 (integration clean)                                                | **~30 files / ~92 chain-shape sites**                                              |
| **C3 internal-detail (CSS-class coupling)** | n/a                 | 36 files / ~155 sites                         | n/a                                    | n/a                                                          | n/a                                                                  | **~155 className couplings (components-specific)**                                 |
| **C4 mock-only suites**                     | 0                   | 0                                             | 0                                      | 0                                                            | 0                                                                    | **0 violations**                                                                   |
| **C5 implementation-shaped titles**         | 14                  | 67 occurrences across ~27 files               | 16 files / ~28 sites                   | ~30-40 actionable                                            | 0                                                                    | **~155 actionable, plus 86 borderline callback titles in components**              |
| **C6 factory duplication**                  | 12 cross-file dups  | 7 cross-file + 16 inconsistent prop factories | 6 cross-file `createMockSupabase` dups | 50+ local + **24 MCP server factory dups** (~600 LOC saving) | 0                                                                    | **~75 cross-file dups; MCP server factory cluster is the single largest IMPL win** |
| **E2E-1 conditional false-pass**            | n/a                 | n/a                                           | n/a                                    | n/a                                                          | 7 files / ~12 sites                                                  | **7 e2e specs (Wave 1 cluster + provenance + settings + digest)**                  |
| **E2E-2 weakened assertions**               | n/a                 | n/a                                           | n/a                                    | n/a                                                          | small (`auth.spec`, `intelligence-workflow.spec`)                    | Borderline — mostly legitimate magic-link OR-chains.                               |
| **E2E-3 workarounds (`force: true`, etc.)** | n/a                 | n/a                                           | n/a                                    | n/a                                                          | All audited entries are mobile-viewport-justified (CLAUDE.md gotcha) | 0 illegitimate.                                                                    |
| **E2E-4 graceful-skip discipline**          | n/a                 | n/a                                           | n/a                                    | n/a                                                          | Documented patterns OK; silent-skip is the issue (E2E-1)             | n/a (subsumed by E2E-1)                                                            |

### 2.1 Three headline numbers

- **C1 + C4 = zero violations across 813 files.** The codebase does not test
  private helpers via `vi.spyOn` (every audited `vi.spyOn` targets
  `console.error/warn` for noise suppression or `Date.now` for time-pinning) and
  has no fully mock-pass-through suites. This is the strongest signal the
  production code is well-isolated and the test-author mindset is healthy.
- **Integration tree (`__tests__/integration/`, 30 files) = zero violations.**
  All use the documented `describe.skipIf(!HAS_REQUIRED_ENV)` env-gate pattern,
  scoped mocking only at boundary seams (cookie shim, AI/embed mocks documented
  with TODOs), and titles describe externally observable behaviour. Reference
  templates: `display-name-routes`, `queue/lifecycle`, `queue/concurrency`,
  `admin-users`, `archive-trigger-coverage`. **Use these as the gold standard
  for new integration test authoring.**
- **Three concentrated remediation themes account for 80%+ of actionable work.**
  (1) Assertion-shape coupling in three forms (C3 chain-asserts in api+lib, C3
  className couplings in components, E2E-1 conditional false-pass in e2e); (2)
  Factory duplication, dominated by the 24-file MCP server cluster; (3)
  Implementation-title rewrites for the converged
  `/^(passes|calls|applies|uses|configures|wraps|forwards|sets) /` family.

## 3. Cross-tree theme: assertion-shape coupling

The dominant test-quality anti-pattern surfaces in **three different syntactic
forms** that share one root cause: the test asserts the SHAPE of how the SUT
performs work rather than the OUTCOME.

| Form                                  | Where                                                    | Pattern                                                                                                                                     | Signal                                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **3a. Supabase chain-method asserts** | `__tests__/api/` (23 files) + `__tests__/lib/` (7 files) | `expect(_chain.eq).toHaveBeenCalledWith('user_id', X)`, `expect(_chain.select).toHaveBeenCalledTimes(N)`                                    | Test would fail if implementation switched to RPC even though end-user behaviour is identical.                                                   |
| **3b. CSS-class state coupling**      | `__tests__/components/` (36 files / ~155 sites)          | `expect(node.className).toContain('text-warning')`, `expect(badge).toHaveClass('bg-error-50')`, `container.querySelector('.font-semibold')` | Test would fail if Warm Meridian token rename ships even though visual / semantic state is identical. Tightly couples to Tailwind class strings. |
| **3c. E2E conditional false-pass**    | `e2e/tests/` (7 files / ~12 sites)                       | `if (await X.isVisible().catch(() => false)) { … }`, `if (badgeCount > 0) { … }`                                                            | Test silently passes on empty staging (memory `feedback_e2e_conditional_false_pass`). Most insidious form — looks like a working assertion.      |

### 3.1 Why this matters

All three forms produce **passing tests that mask production drift**:

- Form 3a: a query-shape change that's semantically identical breaks every
  coupled test, forcing a "fix the tests not the code" rework cycle (consumes
  session time, no behaviour-change signal).
- Form 3b: a design-token rename (e.g. `text-warning` → `text-attention`) breaks
  every coupled test even though the rendered colour is identical (Warm Meridian
  implementation routinely renames tokens).
- Form 3c: empty-DB regressions land green and ship; broken UX is invisible
  until a customer reports.

### 3.2 Single-sweep remediation hypothesis

A unified S38+ "anti-coupling sweep" would resolve 3a + 3b + 3c concurrently
because the corrective pattern is the same: assert on **observable outcome**
(response body, ARIA role, visible text, presence of expected DOM node) rather
than **construction shape** (query-builder method invocation, class-string
presence, count-based conditional). See `remediation-plan.md` §3 for the wave
breakdown.

## 4. Cross-tree theme: factory consolidation

22 + 7 + 6 + 50 = **75+ ad-hoc factories** identified across the four non-E2E
slices. Consolidation candidates ranked by LOC-saved-per-hour:

| Cluster                              | Slices      | Files | Current pattern                                                                             | Proposed home                                                                                     | LOC saved |
| ------------------------------------ | ----------- | ----- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------- |
| **MCP server factories** (D)         | mcp/        | 24    | 24 independent spellings of `createMockMcpServer` / `createMockServer` / `createTestServer` | `__tests__/helpers/mcp-server.ts`                                                                 | **~600**  |
| **Cron request builders** (A)        | api/        | 4     | `createCronRequest()` defined 4 times                                                       | `__tests__/helpers/factories/cron-request.ts`                                                     | ~80       |
| **Mock file builders** (A)           | api/        | 5+    | `createMockFile()` ×3, `buildFakeFile()` ×2, `buildUploadRequest()` ×2                      | `__tests__/helpers/factories/file-upload.ts`                                                      | ~120      |
| **`createMockSupabase`** (C)         | lib/        | 6     | 6 cross-file duplicates with subtle shape variations                                        | `__tests__/helpers/mock-supabase.ts` extension (or new `__tests__/helpers/factories/supabase.ts`) | ~150      |
| **`buildRequest()`** (A)             | api/        | 3     | 3 cross-file duplicates                                                                     | `__tests__/helpers/factories/api-request.ts`                                                      | ~60       |
| **Component prop factories** (B)     | components/ | 16+   | inconsistent naming (`createMockItem` / `mockItem` / `itemFixture`)                         | `__tests__/helpers/factories/<domain>.ts` per domain                                              | ~200      |
| **`validCreateBody(overrides)`** (A) | api/        | 1     | Sole canonical `(overrides?)` shape — Liam-preferred per S37 pilot §3.E                     | (already canonical — extract pattern; use as P1 model)                                            | reference |

**Total LOC saved if all clusters consolidated: ~1,210 LOC.** The MCP server
cluster alone at ~600 LOC is the single largest win and should ship as a P0
standalone work package (see `remediation-plan.md` §3.1).

## 5. Top-50 worst offenders (cross-tree)

Severity-ranked. Each entry: (slice, file, primary criterion, secondary
criteria, suggested remediation wave). Waves defined in `remediation-plan.md`
§3.

### 5.1 High severity (1-20)

| Rank | Slice | File                                                        | C2                                           | C3                                              | C5                            | C6  | Wave               |
| ---- | ----- | ----------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------- | ----------------------------- | --- | ------------------ |
| 1    | A     | `__tests__/api/bid-drafting-pipeline.test.ts`               | mislocated → lib/ai                          | 8 prompt-shape asserts                          | "uses the correct model tier" | —   | W-RC + W-RD + W-RF |
| 2    | B     | `__tests__/components/quality-badge.test.tsx`               | —                                            | 15 className asserts (worst single file)        | —                             | —   | W-RE               |
| 3    | A     | `__tests__/api/notifications.test.ts`                       | —                                            | 12 chain-method asserts                         | —                             | —   | W-RD               |
| 4    | A     | `__tests__/api/review-action-verification-history.test.ts`  | —                                            | 12 chain-method asserts (insert payload shapes) | —                             | —   | W-RD               |
| 5    | A     | `__tests__/api/review-history.test.ts`                      | —                                            | 11 chain-method + select-column-list asserts    | —                             | —   | W-RD               |
| 6    | A     | `__tests__/api/draft-and-tags.test.ts`                      | mislocated → validation/ (27 tests)          | —                                               | —                             | —   | W-RC               |
| 7    | B     | `__tests__/components/template-field-review.test.tsx`       | —                                            | 9 className + focus-state-via-class             | —                             | —   | W-RE               |
| 8    | B     | `__tests__/components/source-document-diff-review.test.tsx` | —                                            | 8 className couplings                           | —                             | —   | W-RE               |
| 9    | B     | `__tests__/components/verification-badge.test.tsx`          | —                                            | className-state + colour-class asserts          | —                             | —   | W-RE               |
| 10   | B     | `__tests__/components/response-editor.test.tsx`             | —                                            | className state-detection                       | —                             | —   | W-RE               |
| 11   | E     | `e2e/tests/wave1-dashboard-expiry.spec.ts`                  | —                                            | E2E-1 ×3 conditional skips                      | —                             | —   | W-RB               |
| 12   | E     | `e2e/tests/wave1-item-detail-dates.spec.ts`                 | —                                            | E2E-1 ×3 + E2E-2 ×1                             | —                             | —   | W-RB               |
| 13   | E     | `e2e/tests/digest-page.spec.ts`                             | —                                            | E2E-1 ×3 conditional skips                      | —                             | —   | W-RB               |
| 14   | E     | `e2e/tests/wave1-guide-sections.spec.ts`                    | —                                            | E2E-1 ×2                                        | —                             | —   | W-RB               |
| 15   | E     | `e2e/tests/provenance-pipeline-audit.spec.ts:45-69`         | —                                            | E2E-1 conditional skip                          | —                             | —   | W-RB               |
| 16   | E     | `e2e/tests/provenance-per-item.spec.ts:64-70`               | —                                            | E2E-1 conditional skip                          | —                             | —   | W-RB               |
| 17   | E     | `e2e/tests/settings-mutations.spec.ts:74-83 + 113-123`      | —                                            | E2E-1 ×2 conditional skip                       | —                             | —   | W-RB               |
| 18   | A     | `__tests__/api/upload-diff-path.test.ts`                    | mislocated → lib/source-documents (26 tests) | —                                               | —                             | —   | W-RC               |
| 19   | A     | `__tests__/api/tag-management-rpcs.test.ts`                 | mislocated → validation/ (28 tests)          | —                                               | —                             | —   | W-RC               |
| 20   | C     | `__tests__/lib/quality-actions.test.ts`                     | —                                            | C3 invocation-shape (multiple)                  | —                             | —   | W-RD               |

### 5.2 Medium severity (21-35)

| Rank | Slice | File                                                                                                                                                            | Primary issue                                                             | Wave              |
| ---- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------- |
| 21   | C     | `__tests__/lib/guide-section-mapping.test.ts`                                                                                                                   | C3 + C5                                                                   | W-RD + W-RF       |
| 22   | C     | `__tests__/lib/guide-section-integration.test.ts`                                                                                                               | C2 reverse-mislocation (imports POST from `@/app/api/items/route`)        | W-RC              |
| 23   | C     | `__tests__/lib/queue/auth.test.ts`                                                                                                                              | C3 borderline (security-contract) — migrate to integration tier           | W-RD' (carve-out) |
| 24   | C     | `__tests__/lib/queue/failure.test.ts`                                                                                                                           | C3 medium chain-shape                                                     | W-RD              |
| 25   | C     | `__tests__/lib/queue/enqueue.test.ts`                                                                                                                           | C3 medium chain-shape                                                     | W-RD              |
| 26   | A     | `__tests__/api/admin-provenance-pipeline-runs.test.ts`                                                                                                          | C5 implementation titles ("passes kinds filter to the query chain", etc.) | W-RF              |
| 27   | A     | `__tests__/api/digest-suggestions-integration.test.ts`                                                                                                          | C5 implementation titles + mislocation candidate                          | W-RF + W-RC       |
| 28   | A     | `__tests__/api/ingest-url.test.ts`                                                                                                                              | C5 ("calls classifyContent with correct params" ×N)                       | W-RF              |
| 29   | D     | `__tests__/app/dashboard-first-run.test.tsx`                                                                                                                    | C2 mislocation (tests `@/lib/dashboard-signals`)                          | W-RC              |
| 30   | D     | `__tests__/fixtures/admin-dedup-fixture-helpers.test.ts`                                                                                                        | C3 borderline — fixture-helper contract IS query composition              | W-RD' (carve-out) |
| 31   | D     | `__tests__/scripts/wp-b-triage-report.test.ts`                                                                                                                  | C3 + C5 (query construction in title and asserts)                         | W-RD + W-RF       |
| 32   | B     | 5-file cluster: `governance-section.test.tsx` + `file-upload.test.tsx` + `bulk-actions-review.test.tsx` + `profile-section.test.tsx` + `activity-feed.test.tsx` | C3 className state-detection                                              | W-RE              |
| 33   | A     | `__tests__/api/items-archive.test.ts`                                                                                                                           | C3 + C5 ("calls supabase update with correct fields")                     | W-RD + W-RF       |
| 34   | A     | `__tests__/api/search-preview.test.ts`                                                                                                                          | C3 + C5 ("calls supabase with correct table and ilike filter")            | W-RD + W-RF       |
| 35   | D     | MCP factory cluster — 24 files                                                                                                                                  | C6 factory duplication (~600 LOC)                                         | W-RA (P0)         |

### 5.3 Low / borderline severity (36-50)

| Rank | Slice | File                                                    | Primary issue                                              | Wave                |
| ---- | ----- | ------------------------------------------------------- | ---------------------------------------------------------- | ------------------- |
| 36   | B     | `__tests__/components/session-page-mobile.test.tsx`     | C5 implementation titles                                   | W-RF                |
| 37   | B     | `__tests__/components/bid-detail-mobile.test.tsx`       | C5 + minor C3                                              | W-RF + W-RE         |
| 38   | B     | `__tests__/components/digest-page.test.tsx`             | C5 callback-prop titles                                    | W-RF                |
| 39   | B     | `__tests__/components/source-document-history.test.tsx` | C5 + factory dup                                           | W-RF + W-RG         |
| 40   | C     | `__tests__/lib/intelligence/relevance-scorer.test.ts`   | C5 vacuous titles ("works correctly")                      | W-RF                |
| 41   | C     | `__tests__/lib/template-auto-map.test.ts`               | C5 vacuous titles                                          | W-RF                |
| 42   | C     | `__tests__/lib/dedup.test.ts`                           | C6 duplicate `createMockSupabase`                          | W-RG                |
| 43   | D     | `__tests__/hooks/use-library-data.test.ts`              | C3 borderline                                              | W-RD'               |
| 44   | D     | `__tests__/mcp/mcp-tools-entity.test.ts:393-440`        | C3 + factory dup                                           | W-RD + W-RA         |
| 45   | D     | `__tests__/hooks/use-taxonomy-admin.test.ts`            | C5 callback titles                                         | W-RF                |
| 46   | D     | `__tests__/hooks/use-draft-stream.test.ts`              | C5 implementation titles                                   | W-RF                |
| 47   | E     | `e2e/tests/auth.spec.ts:131-134`                        | E2E-2 borderline (magic-link OR chain — likely legitimate) | W-RB' (review only) |
| 48   | E     | `e2e/tests/intelligence-workflow.spec.ts:73-75`         | E2E-2 over-broad locator                                   | W-RB'               |
| 49   | E     | `e2e/tests/qa-library.spec.ts:705-725`                  | borderline — both branches assert                          | W-RB'               |
| 50   | E     | `e2e/tests/oauth-consent-flow.spec.ts:493`              | E2E-2 `.catch(() => undefined)` on `page.goto`             | W-RB'               |

## 6. Rule-set validation feedback (cross-tree synthesis)

### 6.1 Confirmed rule-set state (post-pilot, post-fan-out)

The S37 pilot's three refinements (§3.2 mislocation, §3.3 content-vs-shape, §3.5
HTTP-handler title exemptions) **held up across all four S38 fan-out slices**.
No agent reported a false-positive rate that broke their audit. The refinements
graduate from "pilot-validated" to "ratified" status.

### 6.2 Per-slice exemption set proposals (NEW from S38 fan-out)

| Slice          | Proposed addition                                                                                                                                  | Rationale                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Components (B) | EXEMPT `/^renders <noun-phrase> when <condition>/` titles                                                                                          | 786 such titles in slice; all describe behaviour at component scale. Distinguish from vacuous `/^renders correctly/` (still flag).                                                                           |
| Components (B) | FLAG `/^calls on[A-Z]/` callback-prop titles ONLY when assertion is identity-only (no payload check)                                               | 86 such titles; ~half are legitimate ("calls onSubmit with form values" + payload assert) and ~half are not ("calls onCancel"). Triage required.                                                             |
| Lib (C)        | DO NOT inherit API exemptions `/^returns \d{3}/` `/^(rejects                                                                                       | accepts) /`                                                                                                                                                                                                  | API-handler-specific. Lib functions return values, not HTTP statuses. |
| Lib (C)        | EXEMPT `applies <X> penalty at <Y>d` and similar quantitative-business-rule titles                                                                 | ~70 such titles in lib slice describe domain-rule behaviour, not implementation.                                                                                                                             |
| Lib (C)        | NOT a violation: `_chain.X.not.toHaveBeenCalled()` (negative chain assert)                                                                         | Verifies side-effect absence, not query construction.                                                                                                                                                        |
| Lib (C)        | CARVE-OUT: `_chain.eq('user_id', X)` proving multi-tenant scoping                                                                                  | Document a security/RLS contract; should MIGRATE to integration tier (W-RD' carve-out wave) rather than delete from unit tests.                                                                              |
| Mixed (D)      | EXEMPT guard-test "implementation coupling" — guards ARE the production-shape contract by design                                                   | `__tests__/migrations/`, `__tests__/docs/`, `__tests__/build/`, `__tests__/fixtures/` self-tests. Flag only if the guard's implementation is fragile (false-positive prone), not for "tests implementation". |
| E2E (E)        | NEW rule E2E-1.1: flag `if (badgeCount > 0)` and `if (count > N)` as conditional-skip variants of the canonical `if (await X.isVisible())` pattern | The pattern surfaces in 4 of the 7 flagged files; the existing E2E-1 regex misses these                                                                                                                      |
| E2E (E)        | EXEMPT viewport-bound `test.skip(viewport.name === 'mobile')` and similar documented skips                                                         | These are explicit test-matrix declarations, not silent fallbacks.                                                                                                                                           |
| E2E (E)        | EXEMPT documented `force: true` clicks under mobile-viewport carve-out (CLAUDE.md gotcha)                                                          | All audited entries are mobile-viewport-justified.                                                                                                                                                           |

### 6.3 Detection rule additions for S38+ remediation IMPL

Two new patterns surfaced as cross-tree concerns:

- **R-NEW-1: CSS-class state-detection couplings** (components-slice). Pattern:
  `expect(<node>.className).toContain('<class>')` OR
  `expect(<node>).toHaveClass('<class>')` OR
  `<container>.querySelector('.<class>')` used to detect rendered state. ~155
  sites in 36 files. Remediation pattern: replace with `getByRole(...)`,
  `getByText(...)`, `aria-current="true"`, or extract to a design-system
  contract test that validates the class is applied for a given state — ONCE per
  state, not per component-test.
- **R-NEW-2: MCP server factory duplication** (mixed-slice). 24 files
  independently spell `createMockMcpServer` / `createMockServer` /
  `createTestServer`. P0 single-sweep consolidation candidate.

### 6.4 Cross-tree budget validation

Per-agent budget held within scope-and-dispatch §11.4 estimates:

| Agent   | Files                       | Time                    | Files/min  | Notes                                                                                 |
| ------- | --------------------------- | ----------------------- | ---------- | ------------------------------------------------------------------------------------- |
| A pilot | 140                         | ~75 min                 | 1.87       | S37 baseline                                                                          |
| B       | 237                         | ~85 min                 | 2.79       | Faster — components have shorter test files                                           |
| C       | 171                         | ~75 min                 | 2.28       | On baseline                                                                           |
| D       | 188 (actual; 218 brief est) | unspecified, no overrun | ~2.0 (est) | Brief overcounted slice; +1 migration since brief authored                            |
| E       | 77                          | ~90 min                 | 0.86       | Slower per file (E2E specs are denser; integration tests need real-DB pattern review) |

No agent exceeded budget; no STOPPED MID-SLICE markers. Scope-and-dispatch
partition (5 agents by tree) is validated for future audit cycles.

## 7. Roadmap §8.0a partition impact

The S37 roadmap §8.0a Test Audit row already partitions IMPL into "wave
structure TBD post-fan-out". Post-S38 W4, the wave breakdown is locked in
`remediation-plan.md` §3 — 8 work packages spanning ~44-59h aggregate
Claude-driven effort + ~6-9h sub-agent budget per parallel-eligible wave.

Update §8.0a.2 task breakdown: replace placeholder with the W-RA through W-RH
wave list + per-wave effort estimates per `remediation-plan.md` §3 + dependency
graph per §4.

## 8. Acceptance criteria (this consolidation pass)

- ✅ All 5 agent outputs read and synthesised.
- ✅ Cross-tree per-criterion histogram produced (§2).
- ✅ Top-50 worst offenders listed across slices (§5).
- ✅ Three concentrated themes identified (§3 assertion-shape coupling, §4
  factory consolidation, plus E2E-specific E2E-1 cluster).
- ✅ Per-slice exemption refinements documented (§6.2).
- ✅ Two new detection rules proposed (§6.3 R-NEW-1 className couplings, R-NEW-2
  MCP factory dup).
- ✅ `remediation-plan.md` companion authored same-session (sibling file).
- ✅ Roadmap §8.0a.2 update path documented (§7).

## 9. References

- Per-agent outputs: `agent-{a,b,c,d,e}-output.md` (this directory).
- Method: `scope-and-dispatch.md` (this directory).
- Sibling: `remediation-plan.md` (S39+ IMPL waves + dependency graph).
- Memory cited by agents: `feedback_e2e_no_workarounds`,
  `feedback_e2e_conditional_false_pass`, `feedback_test_runners_split`,
  `feedback_react_act_warning_classes`, `feedback_searchbar_query_provider`,
  `feedback_eval_scripts_assume_populated_db`,
  `feedback_guard_tests_follow_refactor`,
  `feedback_guard_test_iteration_list_drift`.
- Roadmap target: `docs/reference/product-roadmap.md` §8.0a (renamed from
  `post-mvp-roadmap.md` per kh-prod-readiness-S38 W5).
