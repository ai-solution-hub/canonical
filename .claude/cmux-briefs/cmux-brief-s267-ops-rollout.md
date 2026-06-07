# cmux sub-orchestrator brief — S267 — ops-rollout (Task ID-50, subtasks 50.1 + 50.2 ONLY)

You are a **sub-orchestrator** in Knowledge Hub's parallel-cmux phase (S267). You drive
**Task ID-50, subtasks 50.1 + 50.2 ONLY** on your own worktree branch. The parent
(orchestrator-of-orchestrators) cherry-picks your commits back to `main` at teardown.

## First actions (orient — you are NOT stale)

Branched from `main` HEAD `73ffb2b4` into your own worktree. Do **NOT**
`git reset --hard origin/main`. Just orient:

1. `pwd && git branch --show-current && git status` — confirm
   `cmux-worker-ops-rollout-73ffb2b4`, clean.
2. Load the **workflow-orchestration** skill — your SDLC backbone.

## Paths: RELATIVE ONLY (`app/...`, `lib/...`, `docs/...`). Never absolute `/Users/...`.

## Tooling per worktree: fresh checkout, no `node_modules` — `bun install` at repo root

before running `tsc` or the codemod classifier.

## Commit model: worker-branch-only — incremental commits on YOUR branch, no push, no

`main`. Trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## Open Questions: NEVER AskUserQuestion (headless → stalls). Write `OQ-pending.md` at

worktree root (question + options + provisional default + why), apply the default,
CONTINUE. Parent relays overrides.

## Workflow discipline (load-bearing): assess against INSTALLED code, not assumptions

(S262 lesson — this Task BEGINS with a step-back ASSESS precisely for that reason);
non-vacuous AC.

## Final report: write `.claude/cmux-events/final-report-ops-rollout.yaml` (gitignored)

before finishing —
`{summary, commits, subtask_dispositions, OQs_for_parent, next_session_handoff}`.

## Ledger updates: flip ONLY ID-50's subtask statuses + journal blocks; splice the {50.3+}

impl Subtask records into ID-50. Task deps = STRINGS, subtask deps = NUMBERS. Tasks have
NO `details` field. 4 terminals share task-list.json — keep edits scoped to ID-50's
records.

---

## YOUR TASK: ID-50 — OPS-T1 corpus rollout — **SUBTASKS 50.1 + 50.2 ONLY**

deps: ID-32 (DONE). **HARD SCOPE: do ONLY 50.1 (ASSESS) + 50.2 (PLAN). NO implementation
this session.** Stop after 50.2 PLAN is authored — do NOT wrap any routes or migrate any
tests. The impl waves ({50.3+}) are a FUTURE session. Output = an assessment doc + a
PLAN + the {50.3+} Subtask records.

### {50.1} ASSESS — choose the corpus-rollout approach (against INSTALLED code)

Determine the best approach for the ~369-error working-tree rollout. The assessment doc
must cover:

(a) **GENERIC defineRoute CTX TYPE** to resolve the `withRequestContext` (+WRC)
contravariance — the fix lives in `lib/api/define-route.ts` (ID-32.25's file): a generic
ctx param or overload. ID-32.27 gate found exactly **118 TS2345**.

(b) **TEST CALL-SITE MIGRATION** approach: the errors are mostly route-test files calling
the now-wrapped exports with the pre-wrap signature (24 RSVE across 7 route-test files per
the gate). Codemod-migrate vs hand-migrate + the exact replacement pattern.

(c) **INCREMENTAL-GREEN vs BIG-BANG**: per-route-group waves each keeping tsc/`next build`
green.

(d) **SCOPE — enumerate the ~137 MECHANISABLE routes.** ⚠ `codemod-needs-manual.json` is
**NOT in the main tree** (it only existed in a stale worktree). **REGENERATE** the
classification by running the codemod classifier (`scripts/codemods/wrap-define-route.ts`,
`MANUAL_SHAPES` at ~L113) against the current `app/api/**` corpus (dry-run). Do not rely
on a stale artifact.

(e) **⚠ MANDATORY — RETIREMENT/COLLAPSE PRE-FILTER (added S267 — this was missing from the
Task record).** Before emitting the migration scope, cross-reference each MECHANISABLE
route against the canonical, current
`docs/plans/phase-0-investigation/architecture/07-collapse-list.md` (specifically §6
UI/route retires+renames, §8 conditional sub-doc bindings, §12 STILL-OPEN). Handle per
flag:

- **`[CONDITIONAL-RETIRE]` / STILL-OPEN → DEFER, do NOT wrap.** **Known case:
  `app/api/upload/route.ts`** (binds at `02-data-flow.md` §12.2, disposition unresolved —
  may retire or be repurposed to a folder-write). Carve it out explicitly; note "blocked
  on §12.2 resolution". Wrapping-then-deleting is wasted churn.
- **`[RATIFIED-RETIRE]` → exclude entirely** (route should be deleted, not wrapped).
- **`[RATIFIED-RENAME]` → wrap the POST-rename path only.** (`digest`→`change-reports`
  already shipped; `bid_*`→`procurement_*` route paths already `procurement/**` — confirm
  the rename landed, then wrap.)
- **Marginal / ambiguous (`app/api/admin/batch-reclassify/route.ts` — §5.2 names the seed
  _scripts_, not the route)** → write `OQ-pending.md` asking the parent whether retire-
  intent extends to the route; default = wrap (route survives as the wired endpoint).
- **Document every carve-out in the assessment doc and REDUCE the stated MECHANISABLE
  count** (from ~137) by the deferred routes, so 50.2 doesn't decompose work for a route
  slated to disappear.

(f) **⚠ AUDIT COORDINATION (added S267).** The s37 test audit
(`docs/audits/s37-test-audit/{consolidated-findings.md,remediation-plan.md}`) has
assertion-rewrite waves (W-RD/W-RE) that edit the SAME `__tests__/api/*.test.ts` files
ID-50's test-call-site migration touches. The audit is **remediation, not retirement**
(C1/C4 = 0 — no test files to delete; its 3 migrate-to-integration tests are in
`lib/`/`hooks/`/`fixtures/`, none in `__tests__/api/`), so it does NOT shrink ID-50's
scope — but **50.2 PLAN must sequence the test-call-site migration to coordinate with (or
follow) the audit's assertion-rewrite waves** to avoid two efforts colliding on the same
files. If the audit remediation is an active parallel effort, flag the parent.

Each output grounded against installed code, not assumption.

### {50.2} PLAN — decompose into impl Subtasks {50.3+}

From the 50.1 assessment, decompose the rollout into implementable Subtasks (sibling-only
deps, each independently green + CI-verifiable): the generic-ctx-type slice; the
test-call-site migration slice(s) (sequenced per (f)); the per-route-group wrapping waves
(grouped to keep tsc/`next build` green per wave); the final all-routes-wrapped + AC-10
type-drift-detect baseline-to-zero slice. PRODUCT/TECH inherit from the ratified OPS-T1
specs (no new product surface). Each Subtask: load-bearing details + one-line testStrategy
mapping to a green tsc/build/CI outcome. **The {50.3+} scope must reflect the 50.1
carve-outs (deferred retiring routes excluded).**

### Canonical refs (READ-only — do NOT edit lib/codemod this session)

- `lib/api/define-route.ts` (ID-32.25's pass-through wrapper — the generic-ctx fix target)
- `scripts/codemods/wrap-define-route.ts` (the proven codemod + `MANUAL_SHAPES`)
- `docs/plans/phase-0-investigation/architecture/07-collapse-list.md` (§6/§8/§12 — the
  pre-filter source)
- `docs/audits/s37-test-audit/{consolidated-findings.md,remediation-plan.md}` (audit
  coordination)
- `docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PLAN.md` (AMENDED-S265)
- `docs/specs/id-16-ast-dataflow-tool/investigations/type-safety-strategy-research-S262.md`
  §7
- ID-32.28's 369-error analysis (in the ID-32 journal)

### Files you WRITE this session

The assessment doc (e.g.
`docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/ASSESS-S267.md`), a PLAN, and the
{50.3+} Subtask records spliced into ID-50 in `task-list.json`. You only READ
`lib/api/define-route.ts` + the codemod — do NOT edit them.
