---
name: workflow-orchestration
description:
  Operationalises the Knowledge Hub SDLC workflow (kh-sdlc-workflow.md §3+§4+§6+§9.4)
  for the main session, which IS the Orchestrator. Loaded at session start to drive the ID-N Task /
  ID-N.M Subtask lifecycle: decomposes work, dispatches Planner / Executor / Checker /
  Curator sub-agents, gates each subtask behind verification, routes findings, owns
  sequential cherry-pick merges. Use whenever the main session needs to orchestrate
  Knowledge Hub work.
allowed-tools: Read, Bash, Grep, Glob, Edit, Write, Skill, Agent
---

# workflow-orchestration

The main session loads this skill at session start. The main session — Claude in
conversation with Liam — **is** the Workflow Orchestrator.

The Orchestrator does not write production code, audit commits, or edit the
roadmap/backlog. Its job is decomposition, dispatch, gating, merge sequencing,
and finding routing. The four other roles (Task Planner, Task Executor, Task
Checker, Workflow Curator) live in `.claude/agents/` and are dispatched via the
built-in `Agent` tool or `session-driver-cmux` (fleet).

If the continuation prompt includes usage of cmux terminals, chain from this `workflow-orchestration` to the `session-driver-cmux` skill to prepare and deploy sub-orchestrators.

---

## Backlog pickup → Promote

When the Orchestrator or Liam selects a backlog item from
`docs/reference/product-backlog.json` to implement, the **first action is to
invoke `bun scripts/ledger-cli.ts promote <backlogId> <taskJson>`**. The CLI
is the only sanctioned write path for this lifecycle transition — it owns the
record-set gate, the budget gate, the atomic two-rename commit, and
(optionally) the roadmap back-link binding. Hand-rolled writes via the Edit
tool against any of the three workflow ledger files are forbidden.

Promote is the canonical path because:

- It is **atomic**: backlog entry removed and task-list record created in one
  operation, preserving the provenance trail on both surfaces. With
  `--capability-theme <themeId>` the roadmap theme's `linked_tasks[]` is
  patched in the same atomic transaction.
- It enforces the **idempotency check**: rejects re-promotion if the source id
  is already absent from the backlog (prevents duplicate Task/Subtask records).
- It enforces the **record-set gate** and **budget gate**: a serialise-side
  drop / duplicate / over-budget field is rejected before any bytes are
  written.
- It writes the **provenance journal block** (`<info added on …>`) linking the
  source backlog id into the task-list `details` field automatically.

**Canonical invocation:**

```bash
bun scripts/ledger-cli.ts promote <backlogId> <taskJson>
# Optional: bind the new Task to a roadmap theme (ID-35.39 Item A).
bun scripts/ledger-cli.ts promote <backlogId> <taskJson> \
  --capability-theme <themeId>
```

`<taskJson>` can be assembled inline or via the standard input plumbing
documented in `bun scripts/ledger-cli.ts promote --help` (positional JSON
| `--file <path>` (`-` reads stdin) | named flags). For the roadmap-bind
form: validate the `themeId` exists in `product-roadmap.json#/themes[]/id`
before invoking — the CLI rejects with `unknown-theme` before any bytes
are touched if it does not.

**Orchestrator-direct:** The curator handles triage and create; the
Orchestrator handles the backlog → task-list lifecycle transition via the
CLI above.

After Promote completes, the new Task or Subtask appears on `task-list.json`
with the appropriate status. The standard ID-N lifecycle phases ({N.1}–{N.5+}) then
proceed from that record as normal.

---

## ID-N lifecycle (§3)

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
- **Implementation ({N.5+})** — one Executor per subtask. Parallel when groups touch disjoint file sets;
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
shape of the work (§5.4 of the canonical doc):

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
its own worktree — it is not a leaf worker. Use it when multiple ID-N Tasks
can progress in parallel without serialising through the main session's
dispatch loop.

For details on how the three primitives compose and what every dispatch brief must carry, see [references/dispatch-primitives.md](references/dispatch-primitives.md).

### Open-Question escalation from sub-orchestrators

Sub-orchestrators (cmux workers running `workflow-orchestration` on their own
ID-N Task) cannot resolve Open Questions inline — the parent session owns the
roadmap/backlog and cross-Task scope decisions. The OQ-escalation channel
defines the mechanism by which a sub-orchestrator surfaces an Open Question
back to the parent for decision: spec at
`docs/specs/id-43-oq-escalation/PRODUCT.md` (authored in parallel with this skill
update under S61). Sub-orchestrators MUST NOT make cross-Task scope decisions
without using the channel.

### Merge cadence

After every subtask PASS (or PASS_WITH_NOTES with all notes resolved),
the Orchestrator owns the merge. Executors invoke `commit-commands` per
subtask.

**Current state (multi-top-level-worktree) — cherry-pick is canonical:**

1. **Cherry-pick parallel agent branches sequentially onto the track branch.**
   Never merge; never parallel. Sub-agent worktrees branched from the PRIMARY
   tree's HEAD at launch — merging would drag stale parent state from a
   different tree onto the orchestrator's track branch.
2. **On conflict**: invoke the `resolve-merge-conflicts` skill.

---

## Finding routing

When a Checker returns PASS_WITH_NOTES or FAIL, or an Executor escalates
mid-task, each finding routes through a **binary in-scope-ness rule**. The
Orchestrator evaluates the rule directly - the predicate:

> A finding is **in-scope** if its `location` (file path) falls
> within the file-ownership set of the current subtask brief, **OR** the
> finding's `axis` is `spec-compliance` against the subtask's spec slice.

If the Orchestrator cannot decide in-scope vs out-of-scope (ambiguity),
the finding goes to the Curator. Ambiguity is a Curator decision input, not
an Orchestrator routing input.

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
appends, Subtask additions, and Task opens. Per-field discipline (ID-34
canonical scope) — write the right shape into the right field. **Canonical
reference:** [`docs/reference/task-list-discipline.md`](../../../docs/reference/task-list-discipline.md)
(full per-field table + the canonical-ref-vs-traceability boundary rule;
over-budget fields surface as soft warnings from `parseTaskListWithWarnings`,
never schema rejections).

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

**Budget gate is HARD for Subtask `description` (≤250) and `testStrategy` (≤300):** these
two budgets are HARD-enforced by the ledger CLI budget gate — over-budget records are
REJECTED at `add-subtask`/`update-subtask` time, not merely surfaced as a soft
`parseTaskListWithWarnings` warning. Records MUST be authored within budget on the first
pass; relocate any overflow into the unbudgeted `details` field. (S281 lesson:
pre-authoring over-budget JSON caused a costly re-trim loop.)

**When in doubt about which field carries which content**: per-Subtask
`details` journal block is the catch-all.

---

## References

For the canonical SDLC doc, sibling agent files, dispatch-primitive skills,
schema + validation modules, side skills the Orchestrator invokes,
Curator-side skills, and project-rule anchors, see [references/external-references.md](references/external-references.md).
