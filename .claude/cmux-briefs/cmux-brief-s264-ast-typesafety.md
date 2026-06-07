# cmux Terminal Brief — type-safety / ast track (S264)

**Your role:** Orchestrator for the **type-safety track** — ID-32 residual (**32.23 +
32.24**) **and** new Task **ID-47**. Run `workflow-orchestration`: dispatch
worktree-isolated Planner/Executor/Checker agents per Subtask.

**Bootstrap (read once):**

- `CLAUDE.md`
- `docs/reference/task-list.json` → Task **ID-32** (Subtasks **32.23**, **32.24**
  `details` are load-bearing) + Task **ID-47** (47.1, 47.2 `details`)
- `docs/specs/id-16-ast-dataflow-tool/investigations/type-safety-strategy-research-S262.md`
  — Option-4 rationale, ranked options, warp-analog (drives ID-47), tooling verdict, the
  `.loose()` permissive-schema trap
- `docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/{PRODUCT,TECH,PLAN}.md` — **32.23
  AMENDS these** (PRODUCT §8 ACs + TECH defineRoute contract)
- `docs/continuation-prompts/s262-worker-reports/id32-final-report.yaml` — full per-AC
  state, the 4-defect (B1–B4) saga, commit map, dispositions

**Three work-streams (32.24 + ID-47 are independent — parallelize; 32.23 spec-first):**

1. **32.24** — ast-dataflow CLI ts-morph fix (deps `[]`, **READY**, independent). Fix the
   21 ts-morph errors in `lib/ast-dataflow/queries/*` + `resolve.ts`, then REMOVE the
   `lib/ast-dataflow` + `__tests__/lib/ast-dataflow` exclusions from `tsconfig.json`
   (added in `a9f5ce2b`). Verify `next build` stays green (transitive type-checking).
   type-drift is NOT part of this (green since S263).

2. **32.23** — OPS-T1 Option-4 re-scope: **SPEC-AMENDMENT + PLAN** (not fresh research,
   not from-scratch PRODUCT). Ledger dep `[16]` is **stale** — it predates the Option-4
   decision; treat 32.23 as **READY** (the gate's findings live in the 32.16 journal + the
   final-report). Deliverables: PRODUCT §8 AC rewrite around runtime-strict-fail-open;
   TECH defineRoute PASS-THROUGH validator contract (validate 2xx JSON body, pass
   status/headers/redirects/ streams through; fail-open-prod / loud-dev+CI+test);
   schema-strictness rules (ban blanket `.loose()`/`z.unknown()` except true index
   signatures); PLAN. **PLAN emits 32.25+** (NOT 32.24 — taken): `{32.25}` redesign
   defineRoute, `{32.26}` tighten the 37 permissive schemas to strict,
   `{32.27 = re-finalise 32.16 gate}` flip tripwires to real assertions, AC-1..10 green.

3. **ID-47** — DB-layer type source-of-truth (warp model). **47.1 RESEARCH** (deps `[]`,
   READY) → **47.2 PLAN** (deps `[1]`). PRODUCT/TECH skipped (dev infra). Make
   `supabase`-generated `database.types.ts` (+ MergeDeep JSONB override) the canonical
   CI-guarded source; retire manual `SCHEMA-QUICK-REFERENCE.md`. Direction set in research
   doc §3.

**Session-specific deltas (not in the ledger):**

- **The 37 R-WP17 schemas are deliberately PERMISSIVE** (84 `.loose()` + 10 `z.unknown()`)
  → runtime guarantee is currently FALSE confidence. 32.26 tightens them; derive
  strictness from the real interfaces.
- **The 32.16 gate test is preserved as tag `s262-32.16-acceptance-gate`** (commit
  556cdde3). When finalising the gate (32.27):
  `git checkout s262-32.16-acceptance-gate -- <the two acceptance test files>` — it
  carries `it.fails` tripwires with REAL assertion bodies that auto-flip.
- **The OPS-T1 codemod mechanics (32.5–32.22) are SOUND + reusable** — only the
  defineRoute contract + schema strictness + AC framing change. Full worker history
  preserved as tag `s262-id32-worker-final`.
- **MANDATORY process fix (32.23 PLAN):** the real-corpus acceptance probe runs
  CONTINUOUSLY from the first slice, not as a final gate — that is what would have caught
  B1–B4 early.

**Workflow discipline (S264 lessons —
`docs/specs/workflow-evaluation/feedback-dossier-S264.md` §2; ID-48 formalises):**
validate contracts/APIs against the INSTALLED code before spec'ing or implementing — if
the spec contradicts reality, ESCALATE, don't execute it blindly (ID-32 B4 + ID-28
`bind_target` were specs against assumptions); run the real-corpus/integration probe
CONTINUOUSLY, not as a final gate; keep ACs non-vacuous (lint-delta paired with
tsc/no-undef); `bun run format` before every commit.

**Merge cadence — WORKER-BRANCH-ONLY (S262 pivot, ratified):** commit to YOUR worker
branch (`cmux-worker-<name>-<sha>`) only; cherry-pick your Executor subagents' work onto
it. **Do NOT push to `main`.** The parent O-of-O integrates your branch at teardown. Raise
OQ via the `OQ-pending.md` sentinel for any decision needing Liam.
