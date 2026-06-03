# Session: 53d48579-13d4-432f-8e94-b6d07bcb6367

## Turn 1 — User [Initial Prompt]

Base directory for this skill: /Users/liamj/Documents/development/knowledge-hub/.claude/skills/start-session

# start-session

Ensures a clean working environment, loads critical context, presents the session plan, then hands off to `workflow-orchestration` for SDLC execution.

---

## Step 1: Git Hygiene (parallel)

Run these commands to clean up stale worktrees and branches from previous
sessions:

```bash
# Prune orphaned worktrees
git worktree prune

# Delete merged worktree branches
git branch --merged main | grep worktree | xargs -r git branch -d

# Count remaining worktree branches (informational)
git branch | grep worktree | wc -l

# Verify clean working tree
git status
```

If unmerged branches exist, deploy an agent to investigate whether they should be merged or
deleted.

---

## Step 1b: GitNexus Baseline

Refresh the code-intelligence index at session start so the sub-orchestrator(s) — and any
in-tree (non-isolation) sub-agents — query a current graph rather than the
previous session's:

```bash
npx gitnexus analyze    # minutes; rebuilds .gitnexus/lbug for the primary tree
```

Notes:

- A stale-index warning on every commit is expected (the post-commit hook
  compares the index to the new HEAD). Re-run `analyze` only before a genuinely
  code-heavy wave — not per doc/ledger commit.

---

## Step 2: Read Critical Documents (parallel with Step 1)

Read these documents in parallel to load context:

### 2a: Memory recall

Call `mempalace_diary_read` (`agent_name: claude`, `last_n: 2`) for the most recent diary entries. For recall during the session, use `mempalace_search` and `mempalace_kg_query`; any errors are transient and should resolve on retry.

### 2b: Task-list state inspection

Read `docs/reference/task-list.json` at session start where a task whose `session_refs[]` includes the previous
  session — these are recently-closed records; their `<info added on …>`
  journal blocks (PRODUCT inv 13) surface what shipped, commit SHAs, and any
  in-flight discoveries the previous Executor / Checker left behind that may
  have been omitted from the continuation prompt.

---

## Step 3: Review Continuation Prompt and Confirm Session Plan

```bash
ls -1 docs/continuation-prompts/continuation-prompt-kh-*.md 2>/dev/null | sort -V | tail -2
```

1. Read the continuation prompt thoroughly
2. Read any referenced tasks to gain an understanding of current state
3. Identify the session objectives
4. Present a summary to the user:

> ## Session {NNN} Plan
>
> **Objectives:** {summarise from continuation prompt}
>
> **Execution strategy:** {terminal sessions, parallel subagents (conditional), dependencies}

5. Proceed with outlined plan - if any adjustments are required, user will
   notify you.

---

## Step 4: Chain to workflow-orchestration

Once the session plan is presented, invoke the `workflow-orchestration` skill via the Skill tool, to begin session orchestration.

---

## Critical Reminders

- **ALL verification gaps must be fixed** — even minor ones



ARGUMENTS: Good to go when required.

---

## Turn 2 — Assistant

Caveman mode active. Starting session bootstrap. Running Step 1 (git hygiene), Step 1b (gitnexus baseline, background), Step 2 (docs) in parallel.

Git hygiene OK — 3 unmerged worktree branches remain (investigate later). Latest continuation prompt: **s302**. Reading diary + continuation prompt now.

Diary + continuation absorbed. **S302 primary = ID-80** (productionise cocoindex form-write path / Path-B). Path-A GREEN on prod; Path-B RED at bl-224. Reading ID-80 ledger detail + bl-224 code site + staged-change scope in parallel.

Hook blocks `cd` to working dir. CWD already there. Dropping cd prefix.

ID-80 confirmed: pending, 4 subtasks — only {80.1} (bl-224) has details; {80.2}/{80.3}/{80.4} are empty stubs needing specs. Staged changes are leftover from concurrent id68-relocation session (gitnexus block reformat + that session's eval files) — not mine, leave untouched. flow.py isn't at the expected path. Locating it.

flow.py at `scripts/cocoindex_pipeline/flow.py`. Reading bl-224 site + DB_CTX definition + how other DB ops get the pool.

Found bl-224 site (line 2069). Reading `_trim_stale_form_fields` body + the `use_context(DB_CTX)` pattern (line 2375) + pool provisioning to characterise the fix.

bl-224 fully characterised. `DB_CTX.get()` is wrong — cocoindex `ContextKey` has no `.get()`. Correct accessor in-file is `coco.use_context(DB_CTX)` (line 2375, 2196+). The pool is provisioned env-scope by `kh_pipeline_lifespan`. The fix is small but needs the right resolution idiom inside a plain `async def` helper — executor work with the cocoindex skill + impact analysis.

Quick worktree check before I present plan.

GitNexus index refreshed (exit 0, fresh). Worktree tips `e716cb6b`/`95533fff`/`7e358f3c` are all in main's history (S301 executors, prunable); `id68-impl` is the concurrent cmux-worker session — leave it.

Enough context. Presenting plan.

---

## Session 302 Plan

**Headline state:** Path-A (content datapath) **GREEN** end-to-end, proven on prod (`sha-7e358f3c`). Path-B (forms) **RED** at bl-224 — form-write path never run live.

**Objectives** (from S301 handoff):

**PRIMARY — ID-80: productionise the form-write path (Path-B).** Ordered:
1. **{80.1} fix bl-224** — `flow.py:2069` `_trim_stale_form_fields` calls `DB_CTX.get()`; cocoindex `ContextKey` has no `.get()` → `AttributeError` → `component build failed` → all-or-nothing abort. Fix = resolve the asyncpg pool via the in-file idiom (`coco.use_context(DB_CTX)`, env-scope pool from `kh_pipeline_lifespan`). Executor + cocoindex skill + impact analysis → checker gate.
2. **Restore charnwood + Path-B re-smoke** (burn) — `mv _held_forms/charnwood corpus/`, wipe lmdb, bump tag, redeploy, SSH log-grab, verify **by op_id**. **Expect more form-path bugs past bl-224** (never-live path) → feeds {80.4} audit.
3. **{80.3} install pandoc** — charnwood docx Track Changes → fidelity.
4. **{80.2} separate forms from content** — architecture, needs spec; also addresses all-or-nothing / per-doc isolation.

**SECONDARY / open:** {66.13} webhook-401 (persists; Vercel deploy-protection?), ID-77/bl-219 workspace_resolution fatality (unconfirmed, important given all-or-nothing), ID-66 close-out wave ({66.12/14/15}), ID-75 PullMD remote-source, bl-216 integration-test staging leak.

**Execution strategy:** Liam + me direct for live-ops/burn (Coolify MCP + SSH, sandbox-off) per S299/S301 pattern. Subagents for the {80.1} code fix (worktree-isolated executor → checker), {80.2} spec, {80.4} audit. **Burn re-smoke gated on your GO** once {80.1} is green (per handoff pre-req). {80.1} is sibling-independent — no blockers.

**Housekeeping:** 3 S301 executor worktrees (`a128d5`/`ad10d8`/`ae206f41`) are FF'd into main — prunable. `id68-impl` is your concurrent session — leaving it. Staged AGENTS.md/CLAUDE.md/id68 eval files belong to the id68-relocation session — not touching.

Chaining to workflow-orchestration.

---

## Turn 3 — User

Base directory for this skill: /Users/liamj/Documents/development/knowledge-hub/.claude/skills/workflow-orchestration

# workflow-orchestration

The Orchestrator does not write production code, audit commits, or edit the
roadmap/backlog. Its job is decomposition, dispatch, gating, merge sequencing,
and finding routing. It disptaches the four other roles (Task Planner, Task Executor, Task
Checker, Workflow Curator) via the built-in `Agent` tool or `session-driver-cmux` (fleet).

If the continuation prompt includes usage of cmux terminals, chain from this `workflow-orchestration` to the `session-driver-cmux` skill to prepare and deploy sub-orchestrators.

---

## ID-N lifecycle

Every Task follows the same six-phase shape. ID-N (Task) and ID-N.M (Subtask)
are the universal terminology — every cross-doc reference, every dispatch
brief, every state transition uses this convention.

```
SESSION
├── start-session                               (skill — bootstrap)
│
├── TASK ID-N
│   ├── Subtask {N.1} RESEARCH.md              (Planner; conditional)
│   ├── Subtask {N.2} PRODUCT.md               (Planner → Checker → fix-Planner loop)
│   ├── Subtask {N.3} TECH.md                  (Planner → Checker → fix-Planner loop)
│   ├── Subtask {N.4} PLAN.md                  (Planner via planning-and-task-breakdown; conditional)
│   │                                          ── ratification gate ──
│   ├── Subtask {N.5+} implementation          (Executor → Checker per subtask group)
│   ├── code-simplification pass               (Executor, end-of-task)
│   ├── quality-review pass                    (Checker, end-of-task)
│   └── Task close                             (Orchestrator gates → done)
│
├── ...
│
└── handoff                       (skill — close)
```

### Phase summary

- **Spec-authoring ({N.1}–{N.4})** — `spec-driven-implementation` chain:
  RESEARCH.md (conditional), PRODUCT.md, TECH.md, PLAN.md (conditional). One
  fresh Planner per subtask, Checker gates each output, Liam ratifies before
  implementation.
- **Implementation ({N.2-5+})** — one Executor per subtask. Parallel when groups touch disjoint file sets;
  sequential when they share files / schema / produced inputs.
- **Closing** — Executor `code-simplification` pass, then Checker
  `quality-review` pass, then Orchestrator gates Task → `done` only after
  Curator triage complete and roadmap/backlog implications recorded.

**Task-list ingress:** read `docs/reference/task-list.json` via
`parseTaskListWithWarnings` from `lib/validation/task-list-schema.ts`, never
`JSON.parse` directly.

For full per-phase detail (Planner-model rules, subtask `details`/`testStrategy`
structure, end-of-task gates, the helper's call-shape with ts example), see [references/lifecycle-detail.md](references/lifecycle-detail.md).

---

## Dispatch protocol

The Orchestrator never invokes a sub-agent inline in the main session's
conversation buffer. Every Planner / Executor / Checker / Curator is
dispatched via one of three layered primitives. Pick the right one for the
shape of the work:

| Scenario                                       | Primitive |
|------------------------------------------------|-----------|
| Parallel ID-N Tasks, each running its own full workflow lifecycle (orchestrator-of-orchestrators) | `session-driver-cmux` per Task (sub-orchestrator pattern, fleet) |
| Single short Executor on one subtask     | Built-in `Agent` tool with `isolation: "worktree"` |
| Multi-turn worker reused across subtasks       | `session-driver-cmux` (cmux preserves state) |
| Checker on one subtask group                   | Built-in `Agent` tool (single-turn, no fleet) |
| Curator on one finding                         | Built-in `Agent` tool (no isolation; ledger writes in main repo) |

Orchestrator-of-orchestrators - sub-orchestrator dispatched
via `session-driver-cmux` loads `workflow-orchestration` itself and runs the
full planner / executor / checker / curator lifecycle on its own ID-N Task in
its own worktree.

For details on how the three primitives compose and what every dispatch brief must carry, see [references/dispatch-primitives.md](references/dispatch-primitives.md).

### Merge cadence

After every subtask PASS (or PASS_WITH_NOTES with all notes resolved),
the Orchestrator owns the merge. Executors invoke `commit-commands` per
subtask. **On conflict**: invoke the `resolve-merge-conflicts` skill.

---

## Finding routing

When a Checker returns PASS_WITH_NOTES or FAIL, or an Executor escalates
mid-task, each finding routes through a **binary in-scope-ness rule**. The
Orchestrator evaluates the rule directly - the predicate:

> A finding is **in-scope** if its `location` (file path) falls
> within the file-ownership set of the current subtask brief, **OR** the
> finding's `axis` is `spec-compliance` against the subtask's spec slice.

**In-scope** findings go to a fix-Executor.
**Out-of-scope** findings go to the `workflow-curator` agent, which runs
`triage-finding` then writes to roadmap / backlog / subtask via
`update-roadmap-backlog`.

For the full Checker JSON output schema, verdict mapping, the three fix-flows, and Curator routing detail, see [references/checker-output-schema.md](references/checker-output-schema.md).

---

## State machine

Who sets which status is part of the role boundary. The Checker is the only
role that can mark a Subtask `done`; the Orchestrator is the only role that
can mark a Task `done`. The Executor never sets either.

For the full Subtask + Task state-machine tables (states, who sets them,
trigger conditions) and the schema-enforcement note for
`SubtaskStatus.exclude(...)`, see [references/state-machines.md](references/state-machines.md).

---

## Skill routing

The Orchestrator's baseline skill catalogue: `start-session`, `context-engineering`,
`session-driver-cmux`, `spec-driven-implementation`,
`diagnose-ci-failures`, `handoff`.

Task-specific skills are added on demand — consult `docs/reference/skill-routing-map.md` to look up
which skills fit the Task's tilt (AI, CI, Supabase, Frontend,
Data-pipeline, etc.). The Orchestrator names skills in the dispatch brief;
sub-agents do not auto-discover skills.

For the full baseline catalogue with per-skill descriptions and the Task-tilt
lookup rule, see [references/skill-routing.md](references/skill-routing.md).

---

## Code-intelligence baseline

Every Subtask brief the Orchestrator authors for a code-touching dispatch MUST incorporate
the code-intelligence tool matrix below. A dispatch is "code-touching" if it modifies any
file matching the allowlist in the fourth sub-section. Non-code-touching dispatches
(docs-only, ledger writes, spec authoring) are exempt.

### Tool matrix per role

<!-- code-intel:baseline-start -->

The Knowledge Hub codebase is indexed by three complementary code-intelligence tools.
Each role in the SDLC workflow has a defined set of obligations:

**Orchestrator (this skill)**

- Consult `gitnexus_query` when composing a Planner brief to identify relevant existing
  execution flows and symbols the spec will touch. This finding lands in the spec's
  Context / Problem section so the Planner has grounded orientation before writing.
- Consult `gitnexus_context` on key symbols when the dispatch scope is ambiguous —
  the call-graph context resolves whether a change is isolated or cross-cutting.
- Where `ast-dataflow` provides finer-grained call-chain precision (e.g. wrong-argument
  suspects, barrel-chain tracing), cite the query and its output in the dispatch brief.
- Consult `ccc` for semantic search across the codebase when gitnexus or ast-dataflow
  has not already surfaced the relevant symbols.

**Planner (task-planner agent)**

- Run `gitnexus_query` on the spec's domain vocabulary before authoring PRODUCT.md or
  TECH.md — this surfaces existing execution flows so the spec does not re-invent
  covered behaviour.
- Run `gitnexus_context` on any symbol the spec mandates be modified — record the verdict
  level (LOW / MEDIUM / HIGH / CRITICAL) and the names of the top-3 affected execution
  flows in the spec's Context section.
- Where ast-dataflow Q1 / Q2 / Q3 sweeps are appropriate (rename verification,
  import-path correctness, string-literal site inventory), cite the sweep output.

**Executor (task-executor agent)**

- Before editing any symbol: run `gitnexus_impact({target: '<symbolName>', direction: 'upstream'})`.
  Record the verdict level, caller count, and top-3 affected execution flows in the
  Subtask journal block. If the verdict is HIGH or CRITICAL, STOP and escalate to the
  Orchestrator before proceeding.
- Before committing: run `gitnexus_detect_changes()` to verify the affected symbol set
  matches the Subtask's expected file-ownership boundary. Scope creep surfaces here.
- Use `ast-dataflow` for call-chain precision when gitnexus does not give file:line
  granularity — especially for wrong-argument suspects or barrel-chain regressions.

**Checker (task-checker agent)**

- Run `gitnexus_detect_changes` on the Executor's commit to audit scope containment.
- If the Executor's journal block is missing a `gitnexus_impact` verdict, flag
  `scope-containment: FAIL` in the audit output.

**Curator (workflow-curator agent)**

- Run `gitnexus_context({name: '<symbolName>'})` on finding symbols to count callers.
  Ten or more callers across three or more modules → roadmap-level finding. Fewer →
  backlog item. This is the deterministic caller-count signal for routing decisions.
- Supplement with `ast-dataflow callers <symbolName>` for TypeScript-corpus precision
  when the gitnexus count is ambiguous.

See `.gitnexus/CLAUDE.md` "Always Do" for canonical `gitnexus_impact` + `gitnexus_query`
+ `gitnexus_detect_changes` + `gitnexus_context` call patterns. See
`.ast-dataflow/CLAUDE.md` for the 12 available queries and 9 cross-tool patterns. The
`ccc` skill body at `~/.agents/skills/ccc/SKILL.md` documents `ccc search`, `ccc describe`,
and `ccc guide`.

<!-- code-intel:baseline-end -->

### Orchestrator Planner-brief block

<!-- code-intel:planner-block-start -->

When composing a Planner dispatch brief, include the following code-intelligence
orientation in the brief's "Context" or "Problem" section. The Planner must have this
grounding before writing the spec:

> **Code-intelligence orientation for this Planner brief:**
>
> Before writing PRODUCT.md or TECH.md, run the following:
>
> 1. `gitnexus_query({query: '<domain vocabulary from the spec title>'})` — identifies
>    existing execution flows and symbols in the Knowledge Hub codebase that overlap with
>    the spec's domain. Cite findings in the spec's Context / Problem section, or note
>    "gitnexus orientation: no existing symbols match — greenfield surface" if the query
>    returns no relevant results.
>
> 2. `gitnexus_context({name: '<symbol>'})` — for each symbol the spec mandates be
>    modified, record the full call-graph context: verdict level (LOW / MEDIUM / HIGH /
>    CRITICAL), caller count, and the names of the top-3 affected execution flows. These
>    go into the spec's Context section alongside the symbol reference.
>
> The Planner cites the gitnexus_query and gitnexus_context outputs explicitly — not
> paraphrased — so the Checker can verify the orientation step was completed.

<!-- code-intel:planner-block-end -->

### Orchestrator Executor-brief block

<!-- code-intel:executor-block-start -->

When composing an Executor dispatch brief, include the following code-intelligence
discipline in the brief's "Operating instructions" section. The Executor must follow
this discipline on every code-touching Subtask:

> **Code-intelligence discipline for this Executor brief:**
>
> Before editing any function, class, or method named in this brief:
>
> 1. Run `gitnexus_impact({target: '<symbolName>', direction: 'upstream'})` and record
>    in your journal block: the verdict level (LOW / MEDIUM / HIGH / CRITICAL), caller
>    count, and the names of the top-3 affected execution flows.
>
> 2. **If the verdict is HIGH or CRITICAL: STOP and escalate to the Orchestrator.**
>    Do not proceed with edits until the Orchestrator has reviewed the blast radius.
>
> 3. Before committing: run `gitnexus_detect_changes()` to verify the affected symbol
>    set is contained within this Subtask's file-ownership boundary. If detect_changes
>    reports symbols outside the boundary, STOP and escalate — this is scope creep and
>    the Checker will FAIL the scope-containment audit.

<!-- code-intel:executor-block-end -->

### Code-touching file allowlist

<!-- code-intel:allowlist-start -->

A dispatch is classified as "code-touching" (and therefore subject to the code-intelligence
tool discipline above) when it modifies files matching any of the following:

**In-scope file extensions** (TypeScript / JavaScript corpus):

- `.ts` — TypeScript source files
- `.tsx` — TypeScript + JSX source files
- `.js` — JavaScript source files
- `.jsx` — JavaScript + JSX source files
- `.mjs` — ES module JavaScript
- `.cjs` — CommonJS JavaScript

**In-scope directories** (regardless of extension):

- `app/` — Next.js App Router pages and API routes
- `lib/` — core library modules
- `components/` — React component implementations
- `hooks/` — custom React hooks
- `contexts/` — React context providers
- `types/` — TypeScript type definitions
- `scripts/` — ingestion CLIs, batch scripts, Python pipeline

**Out-of-scope** (code-intelligence tool discipline does NOT apply):

- `.md` / `.mdx` — documentation and spec files
- `.json` (ledger files in `docs/reference/`) — workflow ledger files
- `.py` — Python pipeline scripts (ast-dataflow covers TypeScript only; use grep for Python)
- `.sql` — Supabase migration files (use grep for SQL)

**Mixed-dispatch rule:** When a Subtask modifies both in-scope and out-of-scope files,
the TypeScript corpus portion governs — the code-intelligence discipline applies to the
`.ts` / `.tsx` files, and the out-of-scope files (e.g. accompanying `.md` spec updates)
are exempt.

<!-- code-intel:allowlist-end -->

---

## Failure handling

Six recurring failure patterns, each with a fixed Orchestrator response:

1. **Executor commits but produces failing tests** — fix-Executor with test
   output as finding packet; new commit (never `--amend`).
2. **Executor exits mid-commit** — `git status` in the worktree first;
   rescue uncommitted work with a manual commit.
3. **Checker FAILs three times on same group** — escalate to Liam; spec/plan
   defect, re-engage a Planner.
4. **Worktree leakage on merge** — `git clean -fd`; do not proceed until
   working tree is clean.
5. **Sub-agent escalation on production behaviour** — scope renegotiation,
   not workaround.
6. **Worktree-CWD drift** — never `cd /Users/liamj/...`; use relative paths
   or `git -C <relative>`.

For the full per-pattern Orchestrator response (CLAUDE.md anchors,
git-safety rules, when to re-engage a Planner vs a Curator), see [references/failure-modes.md](references/failure-modes.md).

---

## Decision framework

**Parallelise a wave** when:

- Multiple subtasks own disjoint file sets.
- No shared mutable schema or migration ordering between them.
- Each is independently testable.

**Serialise** when:

- Subtasks share files or types.
- Schema migrations have ordering dependencies.
- One subtask produces inputs another consumes.

**Escalate to Liam** when:

- Spec is ambiguous on a decision that materially affects scope.
- An Executor escalates with the production-behaviour rule and the
  underlying issue needs scope renegotiation.

---

## Quality gates

The Orchestrator does not declare a subtask group `done` without:

- Checker verdict of PASS, or PASS_WITH_NOTES with all notes either fixed
  or curated.
- All subtask commits cherry-picked to the track branch.
- `bun run test` green after each cherry-pick.
- `bun run knip` clean (or baseline acknowledged) after the final
  cherry-pick of the wave.
- Out-of-scope findings either curated or recorded.

**Run `/verify`**: For user-facing or runtime-behaviour Subtasks, run `/verify` after the
Checker returns PASS, as an additive runtime gate that actually launches the
app and observes that the change runs.

The Orchestrator does not declare a Task `done` without:

- All Subtasks `done`.
- `code-simplification` Executor pass complete.
- `quality-review` Checker pass complete (verdict PASS or
  PASS_WITH_NOTES with all notes resolved).
- Curator triage complete on every out-of-scope finding surfaced during
  the Task.
- task-list / backlog implications recorded.

---

## Ledger field-discipline

The Orchestrator owns ledger writes for status transitions, journal-block
appends, Subtask additions, and Task opens. Per-field discipline - **Canonical
reference:** [`docs/reference/task-list-discipline.md`](../../../docs/reference/task-list-discipline.md)

| Field | Shape | Load-bearing for |
|---|---|---|
| `last_updated` (roadmap file-level) | Single-line `kh-{track}-S{N} {wave} close-out — {short marker}` | Freshness guard on roadmap only. |
| Subtask `details` `<info added on …>` blocks | Multi-line narrative permitted; structured journal blocks per PRODUCT inv 13 | Per-Subtask traceability. THE canonical home for session-by-session narrative (commits, test counts, OQ ratifications, Checker verdicts, Curator decisions). |
| Task `description` | One paragraph: compact what+why, ≤1500 chars; rationale → `docs/` + `cross_doc_links` pointer, not inlined; updated only on scope amendment | Cross-doc cross-reference target. NOT a journal. |
| Subtask `description` | One-sentence summary, ≤250 chars; not a copy of `details` | Subtask scan label. |
| Task `status_note` | Short rationale for current status (`blocked: waiting on X`); ≤300 chars | Status-line context only. Bump on status flip. |
| `testStrategy` (Subtask) | One-line acceptance criterion the Checker verifies against | Checker contract. |
| `cross_doc_links` | Repo-relative path + anchor + raw text per `DocLinkSchema` | Doc-graph traversal. |
| Commit messages | Body + bullets per `commit-commands` convention | Per-commit immutable audit. |
| Continuation prompts (`docs/continuation-prompts/`) | Multi-section session handoff | Session-to-session context transfer. |
| Mempalace diary (`mempalace_diary_write`) | AAAK pipe-delimited per-WP segments | Cross-session recall. |

**Budget gate is HARD for Subtask `description` (≤250) and `testStrategy` (≤300):** Records MUST be authored within budget on the first pass; relocate any overflow into the unbudgeted `details` field.

---

## Backlog pickup → Promote

When the Orchestrator or Liam selects a backlog item from
`docs/reference/product-backlog.json` to implement, the **first action is to
invoke `bun scripts/ledger-cli.ts promote <backlogId> <taskJson>`**.

**Canonical invocation:**

```bash
bun scripts/ledger-cli.ts promote <backlogId> <taskJson>
# Optional: bind the new Task to a roadmap theme (ID-35.39 Item A).
bun scripts/ledger-cli.ts promote <backlogId> <taskJson> \
  --capability-theme <themeId>
```

**Orchestrator-direct:** The curator handles triage and create; the
Orchestrator handles the backlog → task-list lifecycle transition via the
CLI above.

---

## Escalation

If you are a sub-orchestrators and you hit an Open Question that cannot be resolved in-scope, you must NOT silently proceed or block indefinitely. Use the OQ-escalation channel: `.claude/skills/session-driver-cmux/oq-brief-fragment.md`

The OQ protocol is implemented as a durable file-per-record mailbox under each worker's
`.claude/cmux-events/<sid>/oq/` directory. The helper scripts sit beside the five
dispatch scripts:

| Script | Side | Functions |
| --- | --- | --- |
| `scripts/oq-core.sh` | shared | `atomic_publish`, `verify_record`, `list_records`, `derive_oq_id`, `next_seq`, record builders/validators |
| `scripts/oq-worker.sh` | worker | `oq_emit`, `oq_cancel`, `oq_poll_decision`, `oq_check_decision`, `oq_restart_classify` |
| `scripts/oq-parent.sh` | parent | `oq_list_open`, `oq_decide`, `oq_scan_fleet` |
| `scripts/oq-canonical.py` | shared | canonical-JSON + SHA-256 checksum (stdlib only) |

---

## References

For the canonical SDLC doc, sibling agent files, dispatch-primitive skills,
schema + validation modules, side skills the Orchestrator invokes,
Curator-side skills, and project-rule anchors, see [references/external-references.md](references/external-references.md).

---

## Turn 4 — Assistant

In orchestrator mode. S302 primary is ID-80; {80.1} bl-224 is the unblocking fix. Before I dispatch the executor I need a precise brief — gathering the pool-resolution idiom (lifespan provisioning + the `use_context` analogue) and the test seam so the fix preserves testability.

Fix is now crisp. bl-224 root: `DB_CTX.get()` (line 2069) — `ContextKey` has no `.get()`; correct idiom is `coco.use_context(DB_CTX)` (verified live at line 2375, documented 2494). Only that one site misuses it (other `.get()` calls are real `contextvars`). **Coverage gap:** every flow test patches `_trim_stale_form_fields` with `_fake_trim` (lines 1166, 1599) — the real body never ran in tests, which is why bl-224 shipped. Fix must add a direct regression test.

Checking {80.3} pandoc feasibility (could ride the same image rebuild) + the test structure before dispatch.

Good signals. GitNexus surfaced `_check_pandoc_available` in `scripts/docx_utils.py` (Track-Changes path) — but the cocoindex adapter uses **Docling** (`_docling_to_markdown`), not docx_utils. So {80.3} pandoc is under-scoped: the right fix (apt-install vs wiring docx_utils into the adapter) depends on the actual re-smoke warning, which only appears after {80.1} lands + burn. No Dockerfile under `deploy/` yet either. **Decision: {80.1} solo — keep the burn clean.** {80.2/3/4} scope from re-smoke evidence per handoff order.

Dispatching the {80.1} executor (background, worktree-isolated) so I can prep secondary items + prune worktrees meanwhile. Setting up session tracking too.

Brief composed. One adjustment to match this project's actual pattern (per diary: "ledgers enacted at close" by orchestrator): the executor will NOT touch `task-list.json` — it returns the journal content and I enact the ledger at merge, avoiding cross-worktree ledger conflicts.

Creating session tracking + dispatching the {80.1} executor (background, worktree).

Executor running (background, agent `a240bde…`). Marking task #1 in_progress. Using the time for safe housekeeping — pruning the 3 FF'd S301 worktrees (checking each `git status` first per the rule). Leaving the executor's new worktree + `id68-impl` untouched.

All 3 clean. Removing with an ancestor-of-main guard (only delete the branch if its tip is in main's history).

Worktree admin refs + branches deleted (3 gone from `worktree list`). The "Operation not permitted" was the sandbox blocking the physical dir removal under `.claude/worktrees/` — git still de-registered them. Leftover empty dirs are harmless. Cleaning with sandbox off (small, scoped to the 3 known-stale dirs).

Cleaned the 3 targets. Note: `git worktree prune` also cleared a **dangling** `id68-impl` admin ref — its directory was already gone from disk (the concurrent session removed it; its durable output is the staged `docs/workflow-evaluation/...` files, not the worktree). Prune only removes entries whose dir is already invalid, so nothing live was harmed. But I see 3 **orphan** dirs not registered with git (a61d77/a865c4/a8c2a1) from earlier sessions. Checking for uncommitted work before removing.

Broken orphans — their git admin dirs are already gone (residue of the same sandbox-blocked-rm problem prior sessions hit). No recoverable state. Removing all 3.

Worktree hygiene done — only the live executor worktree + main remain. Marking housekeeping complete.

**S302 underway.** Status:

**Critical path — ID-80.1 (bl-224):**
- Root cause pinned: `flow.py:2069` `DB_CTX.get()` on a cocoindex `ContextKey` (no `.get()`). Fix = `coco.use_context(DB_CTX)` — the verified single-arg read idiom (live at line 2375, documented 2494). Only that one site is wrong.
- Coverage gap found: every flow test patches `_trim_stale_form_fields` with a fake, so the real body never ran — that's why bl-224 shipped. Executor brief includes a mandatory regression test (real body, `use_context` patched).
- **Executor dispatched** (background, worktree-isolated, cocoindex skill + impact discipline). Awaiting commit.

**Housekeeping done:** pruned 3 FF'd S301 worktrees + 3 orphan dirs (sandbox blocked the dir-rm, cleared with sandbox-off). `id68-impl` admin ref was already dangling (concurrent session's dir gone, output staged) — prune cleaned it; nothing live harmed. Tree clean: main + live executor only.

**Held for re-smoke prep (your GO):** {80.3} pandoc deferred — Docling vs docx_utils path unclear; right fix needs the actual re-smoke warning. {66.13} webhook-401 + staging in_progress-migration verify = secondary live-ops, fold into burn prep.

**Next:** executor returns → checker gate (read-only) → cherry-pick to `canonical-pipeline-setup` + `pytest` → then I bring you the **GO-gate** for the Path-B burn (restore charnwood, wipe lmdb, bump tag, redeploy, verify by op_id). Expect more form-path bugs past bl-224 → feeds {80.4} audit.

Holding for the executor completion notification (harness-tracked — no polling).

---

## Turn 5 — User

<task-notification>
<task-id>a240bde0168492478</task-id>
<tool-use-id>toolu_01CNxqQ6DYo2VUXocJrkMkFP</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-liamj-Documents-development-knowledge-hub/53d48579-13d4-432f-8e94-b6d07bcb6367/tasks/a240bde0168492478.output</output-file>
<status>completed</status>
<summary>Agent "Fix bl-224 DB_CTX accessor (ID-80.1)" completed</summary>
<result>Commit `7002b259` contains exactly my two boundary files. Branch is `worktree-agent-a240bde0168492478`. The pipeline test file passes (38/38).

The journal block goes to the Orchestrator (per dispatch: "do not write the ledger — return it"), so I will not edit `task-list.json`. My work is complete and committed.

---

## SUBTASK COMPLETE — ID-80.1

**BRANCH:** `worktree-agent-a240bde0168492478`
**COMMIT:** `7002b259` (parent `e52e3e72`, track branch `canonical-pipeline-setup`)

**FILES TOUCHED (absolute):**
- `/Users/liamj/Documents/development/knowledge-hub/.claude/worktrees/agent-a240bde0168492478/scripts/cocoindex_pipeline/flow.py` — one-line accessor fix at line 2069
- `/Users/liamj/Documents/development/knowledge-hub/.claude/worktrees/agent-a240bde0168492478/scripts/tests/test_cocoindex_flow_write_path.py` — new regression test

**THE FIX (flow.py:2069):** `pool = DB_CTX.get()` → `pool = coco.use_context(DB_CTX)`. Confirmed via the `cocoindex` skill and in-file evidence: `DB_CTX` is a `coco.ContextKey[asyncpg.Pool]` (built 760), provided env-scope by `builder.provide(DB_CTX, pool)` in `@coco.lifespan kh_pipeline_lifespan` (2551), and read with the single-arg `coco.use_context(DB_CTX)` — the same idiom live at flow.py:2375 and documented at 2494-2510. `mount_table_target(DB_CTX, …)` (2196+) resolves the same key at row-processing scope, so the pool is available where `_trim_stale_form_fields` runs. No contradiction with the skill — proceeded as briefed.

**CODE-INTELLIGENCE DISCIPLINE:**
- `gitnexus_impact(_trim_stale_form_fields, upstream)`: **risk LOW**, **1 direct caller** (`_ingest_file_body`), **0 processes affected**. Top affected symbols by depth: d1 `_ingest_file_body` → d2 `ingest_file` → d3 `bound_ingest_file` (single linear form-path chain). As expected (LOW) — no escalation.
- ContextKey `.get()` sweep: `grep -n 'DB_CTX.get()' scripts/cocoindex_pipeline/*.py` returned **only 2069**. The `.get()` calls elsewhere (flow.py:438/2488, flow_context.py) are on real `contextvars.ContextVar`s — left untouched.
- `gitnexus_detect_changes()`: `affected_processes` empty; my `git diff --stat` confirms exactly the two boundary files changed (the AGENTS.md/CLAUDE.md/continuation-prompt entries in the `all`-scope result are pre-existing worktree state from prior orchestrator commits, NOT mine). **No scope creep.**

**ACCEPTANCE (per testStrategy):** MET. New test reproduces `AttributeError: 'StubContextKey' object has no attribute 'get'` before the fix (TDD red), and asserts after the fix: (a) pool resolved via `coco.use_context(flow.DB_CTX)`; (b) `conn.execute` received `DELETE FROM public.form_template_fields WHERE template_id = $1 AND sequence &gt; $2` with params `(template_id, new_max_sequence)`.

**TESTS RUN:** `python3 -m pytest scripts/tests/test_cocoindex_flow_write_path.py -q` → **38 passed** (37 existing + 1 new), no regressions.

**JOURNAL APPENDED:** No — per dispatch ("do not write the ledger — return it"). Block text below for you to write at merge.

**JOURNAL-BLOCK TEXT (append to ID-80.1 `details`):**
```
&lt;info added on 2026-06-03 (S302)&gt;
**Shipped:** bl-224 fix — `_trim_stale_form_fields` (flow.py:2069) now resolves the
env-scope asyncpg pool via the canonical single-arg `coco.use_context(DB_CTX)` instead
of the invalid `DB_CTX.get()` (ContextKey has no `.get()`; the live form-write path
aborted with AttributeError, zeroing the whole all-or-nothing cocoindex batch). DB_CTX is
provided env-scope by `@coco.lifespan kh_pipeline_lifespan` (builder.provide) and the same
key is resolved at row-processing time by `mount_table_target(DB_CTX, …)`, so the provision
is live where the trim runs.
**Commit:** 7002b259 (branch worktree-agent-a240bde0168492478, off canonical-pipeline-setup @ e52e3e72).
**Files touched:** scripts/cocoindex_pipeline/flow.py, scripts/tests/test_cocoindex_flow_write_path.py
**Acceptance:** new test `test_trim_resolves_pool_via_use_context_and_issues_shrink_delete`
exercises the UNPATCHED real body (no `_spy_trim`/`_fake_trim` seam) with `coco.use_context`
monkeypatched to a fake pool; asserts (a) pool resolved via `coco.use_context(DB_CTX)` and
(b) the shrink DELETE `DELETE FROM public.form_template_fields WHERE template_id = $1 AND
sequence &gt; $2` with params `(template_id, new_max_sequence)`. Reproduces the AttributeError
before the fix; green after. Full file: 38 passed.
**Blast radius:** LOW (1 direct caller `_ingest_file_body`; 0 processes affected).
**Scope verified:** gitnexus_detect_changes + git diff --stat show only the two boundary
files changed; ContextKey `.get()` sweep confirms 2069 was the sole cocoindex-ContextKey
misuse (438/2488 + flow_context.py `.get()` are real contextvars — left intact).
**Coverage-gap closure:** root cause was that every flow-level form test patched the
`_trim_stale_form_fields` seam, so the real body never executed in CI. New test removes that
seam for the trim body specifically.
**Deviations:** none.
**Out-of-scope observations:** see form-path fragility notes below (feeds {80.4}).
&lt;/info added on 2026-06-03 (S302)&gt;
```

**FORM-PATH FRAGILITY OBSERVED (feeds the {80.4} audit — NOT fixed here):**
- **Seam-patching hides the real form-write body from CI.** `_spy_trim`/`_fake_trim` is applied across every flow-level form test (test file ~1166, 1599), which is precisely why the `.get()` bug shipped. {80.4} should sweep for *other* form-path seams patched uniformly and add at least one real-body exercise per seam (the same class of gap likely exists for the `form_templates` declare path and `extract_form_structure`).
- **No live/integration coverage of the form-write DB path at all.** The fix is unit-proven against a fake pool; the *real* asyncpg `use_context(DB_CTX)` resolution at row-processing scope has still never run in a test (only on the live burn). The burn re-smoke remains the only oracle that the env-provided pool is actually resolvable from inside `_trim_stale_form_fields` at runtime — worth an integration test or an explicit note in {80.4} that Path-B has zero automated DB-path coverage.
- **`_trim_stale_form_fields` issues a raw `conn.execute` outside the cocoindex declare/target model** (it's the one imperative DELETE the shrink case needs). It bypasses the jsonb-codec/`ManagedBy.USER` machinery the row targets use; not a defect, but it's a hand-rolled SQL site that future schema/column renames on `form_template_fields` won't catch via the declare_row path — flag for {80.4} as a maintenance hazard.

**ESCALATIONS:** None. Subtask left at `in_progress` (Checker owns `done`). Nothing pushed to `main`; no burn/Coolify/staging/`supabase db push` touched.</result>
<usage><subagent_tokens>95033</subagent_tokens><tool_uses>28</tool_uses><duration_ms>186710</duration_ms></usage>
<worktree><worktreePath>/Users/liamj/Documents/development/knowledge-hub/.claude/worktrees/agent-a240bde0168492478</worktreePath><worktreeBranch>worktree-agent-a240bde0168492478</worktreeBranch></worktree>
</task-notification>

---

## Turn 6 — Assistant

Executor PASS-quality result: commit `7002b259`, fix is the correct `coco.use_context(DB_CTX)` idiom, impact LOW (1 caller, 0 processes), sweep confirms 2069 was the sole misuse, TDD red→green, **38 passed**. Plus three substantive form-path fragility notes for {80.4}.

Gate before merge. Dispatching the **checker** (read-only, standard variant) — scrutinising the fix idiom, scope containment, and especially the regression test (the load-bearing part — it must exercise the *real* body without the seam patch that let bl-224 ship).

**Checker verdict: PASS** — zero findings, scope contained, 38 passed, test quality called "exemplary" (asserts observable SQL+params, not mock-call shape). ID-80.1 cleared to merge.

Merging now. 7002b259's parent is the current branch tip (e52e3e72) → clean fast-forward, no cherry-pick needed. Verifying state first (branch + that the concurrent session's staged files stay untouched, per the worktree-drift rule).

⚠️ **Worktree-CWD drift** — exactly the gotcha the handoff flagged. My shell is now inside the executor's worktree (`branch: worktree-agent-a240bde0168492478`, HEAD 7002b259, staged files invisible). The checker's `cd` into the worktree drifted my main shell. Must recover to repo root before any merge — using relative `cd` (hook blocks the literal abs path).

Confirmed 3 levels deep. Recovering with relative `cd ../../..`, then verifying I'm back on `canonical-pipeline-setup` with the staged files restored to view.

Recovered cleanly — repo root, `canonical-pipeline-setup` @ e52e3e72, staged files restored. Now the fast-forward merge (disjoint from the staged files).

Fast-forward clean — `canonical-pipeline-setup` @ 7002b259, `flow.py:2069 = coco.use_context(DB_CTX)`, all 6 concurrent-session staged files preserved (uncommitted, won't ride the push). GitNexus stale now (1-line change) — deferring re-analyze per the "code-heavy wave only" rule.

Running the pytest gate on the merged branch to confirm green.

**ID-80.1 fully landed:** merged to `canonical-pipeline-setup` @ 7002b259, checker PASS, **38 passed**. Updating tracking; enacting the {80.1} ledger now (durable journal + status), then I'll bring you the GO-gate.

Checking the ledger-cli interface for the subtask journal + status commands.

ID-80.1 fix+gate+merge complete. Holding the **ledger enactment** deliberately — the executor flagged it, and it matches this project's hard lesson: the fix is *unit-proven* but **not live-proven**. `coco.use_context(DB_CTX)` resolving the pool at row-processing scope inside `_trim_stale_form_fields` has never run live — the burn re-smoke is the only oracle. Per S301's pattern (tasks marked done only with "SHAs+live-proof"), {80.1} stays in_progress until the burn confirms it. I'll write one enriched journal block covering fix + live-proof after the burn.

So: **{80.1} is green and ready, not pushed.** This is your GO-gate (the pre-req you flagged in the handoff).

**The burn (live-ops, hard-to-reverse — confirming before I touch prod):**
1. `git push origin canonical-pipeline-setup` + `…:main` → `onprem-deploy` builds the `sha-7002b259` image, bumps the PROD Coolify tag, redeploys prod idle.
2. Staging re-smoke: bump staging `COCOINDEX_IMAGE_TAG` (env `p85lcabjurrjuncswa88vcpi`, PATCH) to the new sha → restore `_held_forms/charnwood` → `corpus/charnwood` → wipe `lmdb/mdb/*.mdb` (preserve corpus) → Coolify deploy `ljurtiab99kb6dst38k76419` → SSH log-grab → **verify `form_templates`/`form_template_fields` by op_id**.

**Expect more form-path bugs past bl-224** — the path has never run live; each fix has been a layered oracle. This burn likely surfaces the next form-path blocker → feeds {80.4}.

I'll keep the burn **clean (bl-224 only)** to isolate the form-write proof — {80.3} pandoc and {66.13} webhook stay out of this cycle.

**GO — clean bl-224 burn.** Noted on the concurrent session: its commits are safe, I won't touch its staged files. To fully decouple my deploy from any concurrent commit, I'll push the **explicit object `7002b259`** to both refs (not the local branch ref) — that pins the prod image to `sha-7002b259` regardless of branch-HEAD races.

First, fetch + verify clean fast-forward on the remote before I touch prod (network → sandbox off).

Both clean fast-forwards, no concurrent commit on origin yet. Pushing the explicit object `7002b259` to both refs — `:main` triggers `onprem-deploy` (prod image rebuild). This is the prod step you GO'd.

Both refs at **7002b259** — prod main updated (`7e358f3c → 7002b259`), `onprem-deploy` triggered. (The dependabot vuln notice is GitHub's standard banner, unrelated to this push — noting for later, not a burn blocker.)

Watching the image build — that's the gating dependency before the staging re-smoke.

`onprem-deploy` run `26854131039` building `sha-7002b259` (in_progress). Using the build window to prep the staging corpus (independent of the image). SSH inspecting the staging volume first — read-only — to confirm paths before restoring charnwood.

Volume confirmed: `corpus/path-a/short-clause.md` present, `_held_forms/charnwood/itt-services.docx` held, `lmdb/mdb/*.mdb` present (wipe just before redeploy). The `.kh-workspace-map.json` is a dotfile — hidden in plain `ls -R`; I'll confirm it with `-a` during the restore (critical — without it, workspace_resolution throws per ID-77).

Restoring charnwood + verifying the manifest dotfile.

Corpus prepped for Path-B: `charnwood/itt-services.docx` + `path-a/short-clause.md` both present, manifest maps both prefixes → CI Test Workspace. `_held_forms` empty.

Checking the image build progress.

Build just started — the buildpacks image build (6.2GB) is the long pole; downstream steps (Inv-9 pullmd assertion, size check) are pending. Launching a background watch on the run so I'm notified the moment it finishes, and using the window to nail the exact image-tag format + load the Coolify deploy tools.

Key facts locked:
- **Image tag** (from `onprem-deploy.yml:85`): `TAG: sha-${{ github.sha }}` → staging must be bumped to **`sha-7002b259d5aaf30cdae3c7e8483307fa6c05dd72`** (full SHA), image `ghcr.io/ai-solution-hub/kh-cocoindex-pipeline:sha-7002b259…`.
- The workflow's deploy job bumps **prod**; **staging is my manual bump** (env_uuid `p85lcabjurrjuncswa88vcpi`, `is_buildtime+is_runtime`).
- Coolify deploy tools loaded.

Build is the gate (background watch will re-invoke me on completion). Marking the burn in-progress.

**Burn in flight.** Status:
- **Pushed to prod:** `origin/main` `7e358f3c → 7002b259`. `onprem-deploy` building `sha-7002b259…` image (background watch armed — I'm notified on completion). CI + docs-site also running on the new sha (informational).
- **Staging corpus prepped:** `charnwood/itt-services.docx` restored to `corpus/`, `path-a/short-clause.md` intact, manifest confirmed (maps both prefixes → CI Test Workspace). `_held_forms` empty.
- **Next (on build-complete):** bump staging `COCOINDEX_IMAGE_TAG` → `sha-7002b259…` → wipe lmdb → Coolify deploy `ljurtiab99kb6dst38k76419` → SSH log-grab → verify `form_templates`/`form_template_fields` **by op_id**.

Holding for the image build (the long pole — 6.2GB buildpacks). Expect the next form-path bug to surface past bl-224 → {80.4}.

---

## Turn 7 — User

<task-notification>
<task-id>b3u763bhz</task-id>
<tool-use-id>toolu_015C1txKL5CGXXZCD9uxvWyp</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-liamj-Documents-development-knowledge-hub/53d48579-13d4-432f-8e94-b6d07bcb6367/tasks/b3u763bhz.output</output-file>
<status>completed</status>
<summary>Background command "Watch onprem-deploy run until completion (background)" completed (exit code 0)</summary>
</task-notification>

---

## Turn 8 — Assistant

Build complete — `gh run watch` exited 0 (run succeeded). Confirming the conclusion + image push, then starting the staging bump.

**Build + prod deploy both succeeded** — `sha-7002b259…` image is in ghcr, prod redeployed. Now the staging re-smoke. Bumping the staging image tag + wiping lmdb (cold start) in parallel — app is stopped so the wipe is safe.

Tag confirmed `sha-7002b259…`, lmdb wiped clean, corpus intact (charnwood + path-a + manifest). Triggering the staging deploy — pulls the new image cold.

Staging deploy queued (`erqohjf0rnrn7y84e9v7rm6a`). The `sha-7002b259…` image is already on-box (prod just pulled it) → fast boot. Quick check: is the container up yet?

Container not up yet — deploy still pulling/starting. Backgrounding a waiter that polls for the container (by image ancestor) then grabs the boot+ingest logs. The ingest runs automatically on boot (cocoindex walks the corpus → charnwood Path-B + short-clause Path-A).

Log-grab backgrounded (`byz11mdei`, ~2-6 min). Prepping the SQL verification meanwhile — checking whether `form_templates` stamps `op_id` (so I key verification correctly; the handoff's lesson #2 was "verify by op_id, not created_at" since PKs are deterministic + upserted).

`form_templates` has **no `op_id`** — it keys on `storage_path` (deterministic `id` = uuid5 of rel_path, upserted). So Path-B verification keys: `form_templates.storage_path LIKE '%charnwood%'` (+ `field_count > 0`), `form_template_fields.template_id` = that row. Path-A content still keys by op_id (from logs). Critically: before the fix, the bl-224 abort prevented the *whole export*, so charnwood had **zero** form rows — any charnwood `form_templates` row now = the fix worked at runtime.

Log-grab running (120s ingest buffer; charnwood = Docling + 3 streaming LLM calls, may need a re-grab if mid-flight). Holding for it.

---

## Turn 9 — User

<task-notification>
<task-id>byz11mdei</task-id>
<tool-use-id>toolu_01J9jWcC95KcWQoTKSMtXpRf</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-liamj-Documents-development-knowledge-hub/53d48579-13d4-432f-8e94-b6d07bcb6367/tasks/byz11mdei.output</output-file>
<status>completed</status>
<summary>Background command "Wait for staging container + grab boot/ingest logs (background)" completed (exit code 0)</summary>
</task-notification>

---

## Turn 10 — Assistant

Log-grab done. Reading the re-smoke output.

Re-smoke is **running** and progressing well past the old bugs:
- **op_id `7af673af-e53f-4d76-becc-7a3a822c2d9f`**
- Docling converted charnwood `itt-services.docx` in 4.64s ✓ (S299 bytes-bug stays fixed)
- Anthropic **streaming** calls all 200 OK ✓ (bl-222 holds)
- **No AttributeError yet** — but logs end at 23:37:57, *before* the `_trim` call. Ingest still mid-flight (only 30 log lines; the trim + form-write + export haven't logged yet).
- **{66.13} webhook-401 confirmed = Vercel deploy-protection** (body is an "Authentication Required" HTML wall, not a code fault).
- **{80.3} correction:** the docx-fidelity warning is **LibreOffice** (`DOCLING_LIBREOFFICE_CMD` for DrawingML elements), *not pandoc*. The handoff mis-named it.

Grabbing fresh logs to see the `_trim`/form-write/export outcome (the bl-224 moment of truth).

Charnwood is deep into processing — **past every prior blocker**:
- classification + qa_form + entity streaming all 200 OK ✓
- embedding truncated 30171→8000 ✓ (bl-223 holds)
- **{80.3} clarified — it's BOTH:** `docx_utils` wants **pandoc** (Track Changes: "Extracted text may include deleted content") AND Docling wants **LibreOffice** (DrawingML). Two distinct docx-fidelity gaps.
- faiss AVX2 fallback (benign, loaded OK)
- **Still no `_trim` AttributeError** — but the walk hasn't reached form-write/export yet (slow: big 30k-tok doc, multi-stage). Container healthy, progressing.

cocoindex exports all-or-nothing at walk-end, so DB writes appear only after completion. Backgrounding a waiter that polls for the terminal marker (form-write / export / or a new error).

Waiter backgrounded (`bjpgdz3jb`). Capturing the confirmed secondary finding while it runs.

Waiter returned. Reading the terminal-marker outcome.

**The layered oracle strikes again — and bl-224 is PROVEN fixed.** The walk got *past* `_trim` (no AttributeError — the bl-224 failure mode is gone), through classification, embedding, form extraction, all the way to the **entity-resolution stage**, where it hit a NEW blocker:

```
asyncpg.exceptions.UniqueViolationError: duplicate key value violates unique constraint
  "entity_mentions_canonical_name_entity_type_content_item_id_key"
DETAIL: Key (canonical_name, entity_type, content_item_id)=
  (environmental information regulations 2004, regulation, 077b27e7-...) already exists.
→ flow.py:2379 _EntityResolutionStageError → all-or-nothing abort
```

This is **bl-225** — a *content/entity-path* bug (not the form path): charnwood mentions "Environmental Information Regulations 2004" multiple times → two `entity_mentions` rows share `(canonical_name, entity_type, content_item_id)` → the writer INSERTs both → collision on the unique key. It would hit any entity-rich doc (Path-A too), and the all-or-nothing abort zeroes the batch again.

Characterizing the fix site + confirming the DB abort in parallel.

Critical context: flow.py:1790-1800 references **`{66.16}/BUG-F (S297)`** — this exact unique-constraint collision was *known* and supposedly fixed, with an explicit dedup intent ("Each distinct (canonical_name, entity_type) becomes ONE row"). So bl-225 is an **incomplete/regressed fix of BUG-F**, not virgin territory. And psql isn't in the container (need another DB-verify path). Reading the dedup + id-derivation logic — the actual fix site.

bl-225 root cause is now clear from the code: flow.py:1790-1838 has the `{66.16}/BUG-F` dedup (one row per `(per_doc_canonical, entity_type)`, deterministic PK on the natural key) — but cocoindex's upsert conflicts on **`id`** while the DB enforces a **separate** unique constraint on `(canonical_name, entity_type, content_item_id)`. When the deterministic PK and the stored natural key diverge (LLM non-determinism in `entity_name`→canonical, Stage-5 canonical rewrites, or **stale staging rows**), the upsert misses → INSERT → natural-key collision. **There's no stale-cleanup for entity_mentions** (the form path has `_trim_stale_form_fields`; the entity path has no equivalent).

The stale-vs-logic distinction changes the fix, and it's quick to check. psql isn't in the container, so I'll pipe an asyncpg probe through `docker exec` stdin (DSN stays in-container = guaranteed staging).

Buildpack image — `python3` isn't on PATH (it's under `/layers/google.python.runtime/`). Resolving the interpreter path then piping the probe.

asyncpg lives in the pip layer, not on the base interpreter's path. Adding it via `PYTHONPATH` (final probe attempt — the log evidence is already decisive for the decision; this just confirms stale-vs-logic).

**This is a much bigger win than the abort suggested — and bl-224 is PROVEN LIVE.** The DB tells the real story (op `7af673af`, all `created_at` = this burn):

| Table | Count | Meaning |
|---|---|---|
| `form_templates` (charnwood) | **1** | Path-B form header wrote ✓ |
| `form_template_fields` (charnwood) | **58** | **The form-write path ran end-to-end — `_trim` executed, 58 fields declared+exported. bl-224 PROVEN at runtime.** |
| `content_items` @op | 2 | charnwood + short-clause content ✓ |
| `source_documents` @op | 2 | ✓ |
| `entity_mentions` @op | 39 | ✓ |

The earlier "abort" was **not** all-or-nothing — the per-doc exports committed first. The crash is a **later** stage.

**bl-225 (new, characterized):** the failure is in **Stage-5 cross-document entity resolution** (`flow.py:2379`), *after* the writes commit. Its canonical-rewrite UPDATE collapses **two distinct per-doc canonicals into the same resolved `canonical_name` within one content_item** (charnwood/077b27e7 — e.g. "EIR 2004" + "Environmental Information Regulations 2004" → same canonical), violating the `(canonical_name, entity_type, content_item_id)` unique constraint → `_EntityResolutionStageError` → kills the cocoindex update thread. The per-doc dedup at flow.py:1799 only dedups *pre-resolution* canonicals, so it can't catch this. Committed rows survive, but the update cycle ends in error and live-watch dies — so it blocks a *clean* cutover.

Distinct from bl-224: that was an in-walk build failure (zeroes the batch); bl-225 is post-export (writes survive).

**Net: the session's primary goal is achieved — bl-224 is proven live, the form-write path works end-to-end (58 fields).** bl-225 is the next layer (Stage-5 resolution), and it blocks a *clean* run but not the writes. Prod is on `sha-7002b259` but idle (not ingesting), so no prod exposure. Staging's update thread crashed (disposable — fine).

This is your call on appetite:

---

## Turn 11 — User

[Request interrupted by user for tool use]

---

## Session Summary

- **User turns:** 6
- **Assistant turns:** 5
- **Total content:** 56,317 chars, 14,424 tokens

### Files Read

- `/Users/liamj/Documents/development/knowledge-hub/docs/continuation-prompts/continuation-prompt-kh-s302-pathA-green-pathB-formpath-bl224.md`
- `/Users/liamj/Documents/development/knowledge-hub/scripts/cocoindex_pipeline/flow.py`
- `/Users/liamj/Documents/development/knowledge-hub/scripts/tests/test_cocoindex_flow_write_path.py`
- `/private/tmp/claude-501/-Users-liamj-Documents-development-knowledge-hub/53d48579-13d4-432f-8e94-b6d07bcb6367/tasks/byz11mdei.output`
- `/private/tmp/claude-501/-Users-liamj-Documents-development-knowledge-hub/53d48579-13d4-432f-8e94-b6d07bcb6367/tasks/bjpgdz3jb.output`

### Files Written

- `/private/tmp/claude/emcheck.py`
