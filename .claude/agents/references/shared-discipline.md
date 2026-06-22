# Shared discipline — canonical cross-role rules (WS-B2)

Canonical home for rules that previously lived duplicated across the workflow agent files
(`.claude/agents/*.md`) and skills (`.claude/skills/*`). Each consuming file carries a
ONE-LINE binding summary plus a pointer here; this file carries the elaboration. Edit rule
semantics HERE, never re-elaborate in a consumer.

Sections: §Code-intelligence discipline · §KH quality bars · §Spec-chain right-sizing ·
§Subtask dependency constraints · §State machine · §Empirical verification · §Escalation
rule · §Friction register · §Ledger-write invariant · §Spec-tier budget.

## Code-intelligence discipline

Applies to every code-touching dispatch (allowlist: `.ts/.tsx/.js/.jsx/.mjs/.cjs` and
`app/ lib/ components/ hooks/ contexts/ types/ scripts/`; `.md`, ledger `.json`, `.py`,
`.sql` are exempt — full allowlist in `.claude/skills/workflow-orchestration/SKILL.md`
§Code-touching file allowlist). Full tool reference: `.gitnexus/CLAUDE.md` "Always Do" +
`.ast-dataflow/CLAUDE.md`.

**Executor — pre-edit impact analysis.** Before editing any function, class, or method,
run `gitnexus_impact({target: '<symbolName>', direction: 'upstream'})` and record in the
journal block: verdict level (LOW / MEDIUM / HIGH / CRITICAL), caller count, and the names
of the top-3 affected execution flows — for EACH symbol you intend to modify. **If the
verdict is HIGH or CRITICAL: STOP and escalate to the Orchestrator** before proceeding —
callers or execution flows outside your file-ownership boundary are at risk, and the
Checker will FAIL the scope-containment audit on unreviewed regressions.

**Executor — pre-commit detect-changes.** Before committing, run
`gitnexus_detect_changes()` and verify the affected symbol set is contained within the
Subtask's file-ownership boundary. Symbols outside the boundary → STOP and escalate — that
is scope creep and the Checker will FAIL the scope-containment audit.

**Worktree-dispatch caveats** (`isolation: "worktree"`): (a) `gitnexus_detect_changes()`
is unrunnable in agent worktrees — they inherit no `.gitnexus` index ("last indexed:
never"); use `git diff --name-only` as the authoritative scope-containment fallback.
`gitnexus_impact` (primary-tree symbol index) stays reliable. (b) pytest MUST run from the
worktree CWD — main-repo-CWD invocations resolve `scripts.*` to the MAIN tree's modules
(namespace-package hazard; spurious results against stale code).

**Planner — pre-spec-write orientation** (mandatory for `{N.1}`–`{N.4}`):

1. `gitnexus_query({query: '<domain vocabulary from the spec title>'})` — identifies
   existing execution flows and symbols overlapping the spec's domain.
2. `gitnexus_context({name: '<symbol>'})` — for each symbol the spec mandates be modified,
   record verdict level, caller count, and top-3 affected execution flows.
3. **ccc fallback (greenfield / unfamiliar domain):** if `gitnexus_query` returns no
   matching execution flows, invoke `ccc search <concept>` and cite any `[summary]` /
   `[guide]` hits. The greenfield disclaimer ("no existing symbols match — greenfield
   surface") is the fallback only when `ccc search` also returns nothing relevant.

Cite the `gitnexus_query` / `gitnexus_context` outputs verbatim — not paraphrased — in the
spec's Context (TECH) or Problem (PRODUCT) section so the Checker can verify the
orientation step was completed.

**Checker.** Run `gitnexus_detect_changes` on the Executor's commit to audit scope
containment; a missing `gitnexus_impact` verdict in the Executor's journal block is a
`scope-containment: FAIL`.

**Curator.** Caller-count pre-grep before triage: `gitnexus_context` +
`bun run ast-dataflow callers <symbolName>`; ≥10 callers across ≥3 modules
signals roadmap (Branch B), fewer/narrower signals backlog (Branch C).

## KH quality bars

Non-negotiable on every change; the Checker FAILs violations. (Superset — folds in the
formerly Executor-only and implement-subtask-only items.)

- **Semantic tokens only** — no raw Tailwind colours in components; new tokens in
  `app/globals.css` per
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/design/warm-meridian-implementation-spec.md`.
- **UK English** — "colour", "organisation", "behaviour"; DD/MM/YYYY dates.
- **Auth patterns** — `getAuthorisedClient()` returns a discriminated union with
  `{ success }` (not `{ authorised }`); always route failure reasons via the
  `authFailureResponse(auth)` helper to the correct HTTP status.
- **No silent Supabase failures** — `sb()` (fail-fast) or `tryQuery()` (Result-returning)
  from `@/lib/supabase/safe`; composite responses via `warningsEnvelope()`. Never raw
  `.from().select()` with unchecked `error` — ESLint `local/no-unchecked-supabase-error`
  blocks it.
- **No barrel re-exports** — direct file imports (`@/lib/bid/helpers`), never `index.ts`
  re-exports.
- **TanStack Query exclusively** for data fetching — keys in `lib/query/query-keys.ts`,
  fetchers in `lib/query/fetchers.ts`; no SWR, no raw fetch in hooks.
- **Public routes need the `proxy.ts` allowlist** — new non-API public endpoints silently
  redirect to `/login` otherwise.
- **`bun run test`**, never `bun test` — the latter runs Bun's built-in runner, not
  Vitest.
- **Test philosophy** — tests verify real behaviour, never implementation. Read
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/test-philosophy.md` before writing or
  remediating tests.
- **Stable empty defaults** — module-level `const EMPTY_X: T[] = [];` + `useMemo` for hook
  returns that may be empty; inline `?? []` creates new references and breaks downstream
  deps.
- **Function `search_path`** — new PL/pgSQL functions in migrations MUST include
  `SET search_path = public, extensions`, plus an explicit `REVOKE EXECUTE ... FROM anon`.

## Spec-chain right-sizing

Right-size the spec chain to the task shape via the four named tiers. The Orchestrator
decides the tier at Task open; the Planner may recommend an upgrade mid-`{N.1}` if
RESEARCH surfaces compound invariants:

- **Full chain** (RESEARCH + PRODUCT + TECH + PLAN) — compound invariants / multiple
  migrations / chain-dependent slices / >2h effort.
- **PRODUCT + PLAN** (skip TECH) — behaviourally rich, implementation-shallow.
- **TECH + PLAN** (skip PRODUCT) — unambiguous behaviour, non-trivial implementation.
- **Spec-free** — trivial / operational.

The chosen tier is recorded in the Task `status_note` as a one-line marker (e.g.
`spec tier: PRODUCT+PLAN`) within the §Spec-tier budget. The light tier is a _recorded_
decision: an under-specified Task that later reveals compound invariants ESCALATES to a
heavier tier (a `status_note` update), never silently proceeds.

## Subtask dependency constraints

- **Sibling-only Subtask dependencies (§3.3 / A6 — forcing function).** Implementation
  Subtasks within a Task may depend on other Subtasks OF THE SAME TASK only. Cross-Task
  dependencies live at the Task level (`Task.dependencies[]`), never the Subtask level.
  Wanting "ID-15.7 depends on ID-22.4" means the Task boundary is wrong — either **split**
  the other Task so the dependency surfaces at Task level, or **merge** the two Tasks so
  it becomes sibling-level. Escalate to the Orchestrator; never bend the constraint
  silently.
- **25-Subtask soft ceiling (§3.4 / A7).** A decomposition approaching 25 Subtasks within
  one Task is a strong Task-boundary signal — propose a Task split. It is a planning
  signal, not a hard cap (empirical TM data §7: 5/7 example Tasks at exactly 25).

## State machine

**Canonical:** `.claude/skills/workflow-orchestration/references/state-machines.md` — full
Subtask + Task state tables (states, who sets them, trigger conditions) and the
`SubtaskStatus.exclude(...)` schema-enforcement note. Binding summary: the Planner sets
the initial `pending`; the Executor moves `pending → in_progress` ONLY; the Checker is the
ONLY role that sets a Subtask `done` (PASS verdict, zero further-action findings); the
Orchestrator owns `deferred` / `cancelled` and is the ONLY role that closes a Task.

## Empirical verification (OQ-3 — Q-EX2 forcing function)

**Rule:** Before returning any spec ({N.1} RESEARCH / {N.2} PRODUCT / {N.3} TECH / {N.4}
PLAN) that cites external-library APIs (cocoindex symbols, anthropic SDK shapes, supabase
client methods, third-party Pydantic models, ts-morph / Zod / TanStack methods on
non-pinned-major-version, etc.), run a **pre-ratification empirical import-and-call
check** against the version pinned in `requirements.txt` (Python) / `package.json`
(TypeScript) and record the result in the spec.

**Why this is a forcing function (Q-EX2 — S252 cocoindex precedent):** Specs that cite
external-library APIs without empirical verification drift silently. The Q-EX2 cocoindex
extraction-contract spec cited `cocoindex.ExtractByLlm` / `LlmSpec` / `LlmApiType` from a
phase-B doc that surveyed cocoindex 0.3.x; the 1.0.0 restructure removed those symbols and
the drift propagated unchecked from S242 RESEARCH → S252 TECH → S253 PLAN → S256 Executor
escalation. The fix cost two sessions; an empirical check at spec-ratification time would
have caught it on day one. Canonical record:
`knowledge-hub-archive (sibling checkout) audits/cocoindex-1.0.3-extractbyllm-spec-reality-investigation.md`.

**What to verify:**

1. **Identify cited external symbols.** Grep the spec for module names (`import X from`
   patterns in code blocks; "uses `pkg.foo()`" in prose; SDK / API references). List per
   `module.symbol`.
2. **Look up the pinned version.** Python: `grep '^<package>' requirements.txt`.
   TypeScript: `jq -r '.dependencies["<package>"]' package.json` (also check
   `devDependencies`).
3. **Run the import-and-call check** (sandbox-disabled where needed for cocoindex or other
   LMDB-touching packages):
   ```
   python3 -c "from <module> import <symbol>; print(<symbol>)"
   ```
   TypeScript symbols — use ast-dataflow `references` or `tsc --noEmit` against a
   throwaway file that imports the symbol; runtime `bun --print` may not surface type-only
   export mismatches.
4. **Record verification in the spec** (a `## Verification` section, or a footnote near
   each citation): date (DD/MM/YYYY), pinned version (`<package>==<version>`), symbol path
   checked, and result — `PRESENT` / `ABSENT` / `SIGNATURE_DRIFT` (signature differs from
   cited shape) / `BEHAVIOUR_DRIFT` (signature matches but runtime behaviour differs from
   spec assumption).

**Escalation on failure:**

- `ABSENT` or `SIGNATURE_DRIFT` → STOP. Do not return the spec for ratification. Escalate
  to the Orchestrator with verification evidence and recommend either (a) spec revision to
  use the actual installed API, or (b) version-pin upgrade if the cited shape exists in a
  newer release.
- `BEHAVIOUR_DRIFT` (signature OK, runtime semantics changed) → record the drift inline
  and either revise the spec or surface to the Orchestrator for amend-in-place.
  Orchestrator's call.

**Scope:** applies to external-library symbols in RESEARCH / PRODUCT / TECH / PLAN
artefacts and any Subtask `details` referencing external library calls — including
externally-sourced claims gathered during `{N.1}` research (never accepted from prose).
Does NOT apply to internal KH symbols (covered by ast-dataflow + gitnexus + Knip),
test-internal helpers, or standard-library / framework built-ins (Next.js, React, Node,
Python stdlib).

**Checker cross-check:** the Checker re-runs a fresh import-and-call check at audit time
and verifies the recorded block matches the current pin (see `task-checker.md`
`empirical-grounding` axis for the severity mapping).

## Escalation rule

Any sub-agent that encounters unexpected production behaviour contradicting its spec slice
or dispatch brief — wrong renders, dead code the brief assumed live, tests that pass
without testing real logic, missing assumed infrastructure, or a spec-vs-reality mismatch
the commit does not reconcile — MUST **STOP and escalate to the Orchestrator with
evidence** (file:line, observed vs expected behaviour), never silently work around. The
outcome is scope renegotiation, spec amendment, or re-engaging a Planner — not a
workaround. Escalation is a feature, not a failure mode: it keeps the
spec-as-source-of-truth honest. Corollary (per `.ast-dataflow/CLAUDE.md` Propagation
discipline): a code-touching dispatch brief that omits the mandated tool-discipline
instructions is itself an escalation — a brief-composition defect, not a sub-agent
failure.

## Friction register

Register-mandated operational rules (canonical register:
`knowledge-hub-docs-site/src/content/docs/workflow-evaluation/friction-register.md`;
verbatim brief-template lines for dispatch-brief composition:
`.claude/skills/workflow-orchestration/references/dispatch-primitives.md` §Friction-guard
convention lines):

- **FR-001 (cd-to-repo-root hook-block):** NEVER prefix a Bash command with
  `cd /Users/.../knowledge-hub` (or any absolute cd into the repo root) — applies to the
  MAIN session and worktree agents alike. You are already in your CWD; use paths relative
  to CWD, or `git -C <path>` flags, and never absolute repo paths in Edit/Write/Read from
  a worktree. A PreToolUse guard hard-blocks `cd <repo-root>` to stop wrong-branch commit
  leakage; each `BLOCKED:` message costs a full retry round-trip.
- **FR-002 (Edit/Write before Read):** Before any Edit/Write/MultiEdit to a file not Read
  this session, Read it first (the harness hard-errors "File has not been read yet",
  costing a retry). Batch the Read with sibling Reads in the same turn to avoid serial
  round-trips.
- **FR-004 (`.git/index.lock`):** If a git command fails with
  `.git/index.lock: File exists`, do NOT blindly `rm` the lock — first confirm no sibling
  git process is running, then `rm -f .git/index.lock` and retry once.
- **FR-005 (MCP `-32000 Internal tool error`):** usually transient; retry once. If it
  persists for a given MCP tool, fall back to the non-MCP equivalent (e.g. raw CLI) and
  note the tool name in your report for the friction register.

## Ledger-write invariant

**ONE invariant: all workflow-ledger writes route through `bun scripts/ledger-cli.ts` on
the MAIN checkout only** — never raw `Edit` on the JSON ledgers (task-list,
product-backlog, product-roadmap, product-retros, or their markdown mirrors), and never an
in-branch write or commit from a worktree. The ID-90 daemon serialises behind one mutex
per main-checkout ledger directory, so an in-branch `chore(ledger)` commit bypasses it
entirely (the bl-287/288 3-way id collision). Worktree workers RETURN ledger-write intents
(status flips, journal appends, item creates) in their report; the Orchestrator — or the
Curator via `update-roadmap-backlog`, which wraps the CLI — applies every write on MAIN,
where id allocation happens under the mutex. The worktree pre-commit guard hard-blocks
staged ledger paths by design. As of ID-90.22 the enforcement point (serialisation,
budget + record-set gates, mirror regen) is server-side in the task-view patch-server
substrate; the CLI is the operator surface (invariant 57). Canonical full protocol:
`.claude/skills/workflow-orchestration/SKILL.md` §Ledger field-discipline.

## Spec-tier budget

The Task `status_note` is budget-gated at **≤300 characters (invariant 57)** — keep the
spec-tier marker (e.g. `spec tier: PRODUCT+PLAN`) terse. Related HARD-enforced write-time
budgets: Subtask `description` ≤250, Subtask `testStrategy` ≤300, Task `description` ≤1500
— over-budget records are REJECTED at write time; author within budget first-pass and
relocate overflow into the unbudgeted `details` field. Canonical field-discipline
reference: `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/task-list-discipline.md`
§2/§3.
