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
invoke `update-roadmap-backlog` in Promote mode** — not a manual Edit of
`task-list.json` followed by a separate Delete on the backlog.

Promote is the canonical path because:

- It is **atomic**: backlog entry removed and task-list record created in one
  operation, preserving the provenance trail on both surfaces.
- It enforces the **idempotency check**: rejects re-promotion if the source id
  is already absent from the backlog (prevents duplicate Task/Subtask records).
- It writes the **provenance journal block** (`<info added on …>`) linking the
  source backlog id into the task-list `details` field automatically.

**Orchestrator-direct:** The curator handles triage and
create; the Orchestrator handles the backlog → task-list lifecycle transition.

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
`docs/specs/oq-escalation/PRODUCT.md` (authored in parallel with this skill
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
canonical scope) — write the right shape into the right field:

| Field | Shape | Load-bearing for |
|---|---|---|
| `last_updated` (roadmap file-level) | Single-line `kh-{track}-S{N} {wave} close-out — {short marker}` | Freshness guard on roadmap only. |
| Subtask `details` `<info added on …>` blocks | Multi-line narrative permitted; structured journal blocks per PRODUCT inv 13 | Per-Subtask traceability. THE canonical home for session-by-session narrative (commits, test counts, OQ ratifications, Checker verdicts, Curator decisions). |
| Task `description` | One-paragraph human-readable purpose; updated only on scope amendment | Cross-doc cross-reference target. NOT a journal. |
| Task `status_note` | Short rationale for current status (`blocked: waiting on X`); ≤300 chars | Status-line context only. Bump on status flip. |
| `testStrategy` (Subtask) | One-line acceptance criterion the Checker verifies against | Checker contract. |
| `cross_doc_links` | Repo-relative path + anchor + raw text per `DocLinkSchema` | Doc-graph traversal. |
| Commit messages | Body + bullets per `commit-commands` convention | Per-commit immutable audit. |
| Continuation prompts (`docs/continuation-prompts/`) | Multi-section session handoff | Session-to-session context transfer. |
| Mempalace diary (`mempalace_diary_write`) | AAAK pipe-delimited per-WP segments | Cross-session recall. |

**When in doubt about which field carries which content**: per-Subtask
`details` journal block is the catch-all.

---

## References

For the canonical SDLC doc, sibling agent files, dispatch-primitive skills,
schema + validation modules, side skills the Orchestrator invokes,
Curator-side skills, and project-rule anchors, see [references/external-references.md](references/external-references.md).
