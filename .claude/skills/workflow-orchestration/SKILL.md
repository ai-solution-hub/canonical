---
name: workflow-orchestration
description:
  Operationalises the Knowledge Hub SDLC workflow (kh-sdlc-workflow.md §3+§4+§6+§9.4)
  for the main session, which IS the Orchestrator (§2 session-entry option ii — no
  separate orchestrator agent). Loaded at session start to drive the ID-N Task /
  ID-N.M Subtask lifecycle: decomposes work, dispatches Planner / Executor / Checker /
  Curator sub-agents, gates each subtask behind verification, routes findings, owns
  sequential cherry-pick merges. Use whenever the main session needs to orchestrate
  Knowledge Hub work — triggering phrases include "orchestrate", "workflow
  orchestration", "dispatch agents", "session bootstrap entry pattern", "kick off
  Task ID-N", "run the SDLC workflow", "fan out a wave", "merge the wave".
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

This skill is intentionally **load-bearing**: the merge-cadence procedure (§6.4
of kh-sdlc-workflow.md) lives in this body, not in a separate skill. There is
no `coordinate-merge` skill — that consolidation was ratified during S49 (open
resolution N2). Same for the binary in-scope-ness predicate (§6.2) and the
state-machine boundaries (§6.3) — they live here because the Orchestrator
evaluates them in-conversation.

---

## When to invoke

The Orchestrator skill triggers in three situations:

1. **Session start** — `start-session` chains to this skill once the
   continuation prompt is read and the wave plan is presented.
2. **New Task spawn** — Liam (or the previous session's handoff) names a new
   ID-N Task to begin. The Orchestrator reads the Task from
   `docs/reference/task-list.json` and walks the lifecycle (§3 below).
3. **Mid-session phase boundary** — between subtask groups, between waves,
   between Tasks, or when a Checker returns findings that need routing.

The skill stays loaded for the duration of the session. It is not re-invoked
per Task.

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

**Orchestrator-direct** (S60 ratification): the Promote operation is driven by
the Orchestrator, not the workflow-curator. The curator handles triage and
create; the Orchestrator handles the backlog → task-list lifecycle transition.

After Promote completes, the new Task or Subtask appears on `task-list.json`
with the correct status (`done` for already-shipped items, or the appropriate
in-flight status). The standard ID-N lifecycle phases ({N.1}–{N.5+}) then
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
│   ├── Subtask {N.1} RESEARCH.md              (Executor or Planner; conditional)
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
└── update-docs → handoff                       (skills — close)
```

### Phase summary

- **Spec-authoring ({N.1}–{N.4})** — `spec-driven-implementation` chain:
  RESEARCH.md (conditional), PRODUCT.md, TECH.md, PLAN.md (conditional). One
  fresh Planner per subtask, Checker gates each output, Liam ratifies before
  implementation.
- **Implementation ({N.5+})** — one Executor per **logical subtask group**
  (not per subtask). Parallel when groups touch disjoint file sets;
  sequential when they share files / schema / produced inputs.
- **Closing** — Executor `code-simplification` pass, then Checker
  `quality-review` pass, then Orchestrator gates Task → `done` only after
  Curator triage complete and roadmap/backlog implications recorded.

**Task-list ingress:** read `docs/reference/task-list.json` via
`parseTaskListWithWarnings` from `lib/validation/task-list-schema.ts`, never
`JSON.parse` directly. The helper surfaces 25-Subtask soft-ceiling warnings
(PRODUCT inv 20) — present them to Liam at session start as a Task-boundary
problem, not an error.

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
| Parallel wave of long-running Executors (1 orchestrator → N leaf workers) | `session-driver-cmux` per Executor |
| Parallel ID-N Tasks, each running its own full workflow lifecycle (orchestrator-of-orchestrators) | `session-driver-cmux` per Task (sub-orchestrator pattern) |
| Single short Executor on one subtask group     | Built-in `Agent` tool with `isolation: "worktree"` |
| Multi-turn worker reused across subtasks       | `session-driver-cmux` (cmux preserves state) |
| Checker on one subtask group                   | Built-in `Agent` tool (single-turn, no fleet) |
| Curator on one finding                         | Built-in `Agent` tool (no isolation; ledger writes in main repo) |

The orchestrator-of-orchestrators row is structurally distinct from the
"parallel wave of leaf Executors" row above it. A sub-orchestrator dispatched
via `session-driver-cmux` loads `workflow-orchestration` itself and runs the
full planner / executor / checker / curator lifecycle on its own ID-N Task in
its own worktree — it is not a leaf worker. Use it when multiple ID-N Tasks
can progress in parallel without serialising through the main session's
dispatch loop. Empirically validated S61 (launch → converse → stop full
lifecycle PASS).

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

### Merge cadence (load-bearing — §6.4)

After every subtask-group PASS (or PASS_WITH_NOTES with all notes resolved),
the Orchestrator owns the merge. Executors invoke `commit-commands` per
subtask and do **not** have `git-workflow-and-versioning` available (per B9).
That is the Orchestrator's skill.

**The cherry-pick-vs-merge choice is CONDITIONAL on top-level worktree
structural state.** KH is currently in the multi-top-level-worktree state
(`knowledge-hub` primary + `knowledge-hub-production-readiness` secondary).
Anthropic's default worktree-creation primitives (`Agent` tool
`isolation: "worktree"`, `claude --worktree`, `EnterWorktree`) place sub-agent
worktrees under the PRIMARY worktree's `.claude/worktrees/` regardless of
the orchestrator's CWD, and resolve `worktree.baseRef: "head"` against the
PRIMARY's HEAD. This is the structural root cause of the "Worktree agents
start stale" gotcha — not just a `baseRef: "fresh"` semantics issue
(S61 empirical finding; see `docs/research/worktree-isolation-synthesis-and-action-plan.md`).

**Current state (multi-top-level-worktree) — cherry-pick is canonical:**

1. **Cherry-pick parallel agent branches sequentially onto the track branch.**
   Never merge; never parallel. Sub-agent worktrees branched from the PRIMARY
   tree's HEAD at launch — merging would drag stale parent state from a
   different tree onto the orchestrator's track branch.
2. **After each cherry-pick**: run `git status` to check for leaked files
   (CLAUDE.md "After merging worktree branches, run `git status` on main and
   clean with `git checkout -- .` and `git clean -fd` (merges leak files)").
   If leakage appears, `git clean -fd` and re-verify the merge produced the
   expected files.
3. **After each cherry-pick**: run `bun run test` for full regression. If
   tests regress, halt the wave and dispatch a fix-Executor with the test
   output as the finding packet.
4. **On conflict**: invoke the `resolve-merge-conflicts` skill. Do not hand-
   resolve from memory.
5. **After the final merge of the wave**: `bun run knip` if files were
   added or removed. The knip baseline is the canonical guard for unused
   files / exports / dependencies (see `docs/runbooks/ci.md`).

Sequential, never parallel — under the current state, this is the only way
to keep the track branch deterministic when multiple worktree branches
touched adjacent areas.

**Future state (single-top-level-worktree, Path A) — merge becomes canonical.**
Once `production-readiness` is consolidated back into `main` and KH runs as a
single top-level worktree, Anthropic primitives work as documented:
sub-agent worktrees branch from the correct HEAD, the `cleanupPeriodDays`
orphan sweep handles worktree cleanup, and the cherry-pick-only constraint
can relax to merge. The verbose pre-action `git fetch` ritual (see
"Worktree isolation discipline" below) becomes unnecessary.

**Consolidation — deferred decision.** Path A is the documented long-term
direction (S61 synthesis): consolidate to a single top-level worktree at
`main`, merge production-readiness back, then `session-driver-cmux` remains
viable but Anthropic-default primitives also become reliable. The
consolidation itself is deferred until the production-readiness track's
remaining Tasks land — flagged here so future orchestrators know the
current cherry-pick + verbose-fetch posture is a structural workaround, not
a permanent invariant.

The Orchestrator's `git-workflow-and-versioning` skill carries the broader
branch-hygiene rules (no `--amend`, no force-push to `main`, etc.) — those
apply throughout under either structural state.

---

## Worktree isolation discipline

### Critical first action — verification gate

**⚠ Multi-top-level-worktree workaround (S61).** The ritual below is
necessary BECAUSE KH currently runs two top-level worktrees
(`knowledge-hub` primary + `knowledge-hub-production-readiness` secondary)
and the Anthropic `Agent` tool `isolation: "worktree"` (and `claude
--worktree` / `EnterWorktree`) places sub-agent worktrees under the PRIMARY
tree's `.claude/worktrees/` and resolves `baseRef: "head"` against the
PRIMARY's HEAD — regardless of the orchestrator's CWD. The agent's worktree
HEAD can therefore be hours or days behind the orchestrator's track branch
(CLAUDE.md "Worktree agents start stale"). Once Path A consolidates to a
single top-level worktree (see "Consolidation — deferred decision" under
Merge cadence above), this ritual becomes unnecessary and should be removed.

Until then, every dispatch brief's first instruction must be (verbatim — do
NOT prefix with `cd`):

```bash
pwd
git branch --show-current
git fetch origin <track-branch>
git reset --hard origin/<track-branch>
git branch --show-current   # MUST still equal worktree-agent-<id>
git status
```

For sub-agent briefs: name the branch explicitly so the sub-agent doesn't
have to guess. The second `git branch --show-current` is the verification
gate — if it returns the parent branch (e.g. `production-readiness`), the
agent is leaking and must STOP and escalate.

**Why `session-driver-cmux` is the structurally-correct primitive in the
multi-tree state.** `launch-worker.sh` issues an explicit `git worktree add`
from the orchestrator's CWD, so sub-cmux workers land in the orchestrator's
tree and branch from its HEAD — not the primary tree's HEAD. The verbose
pre-action ritual is still recommended for defense-in-depth but the
structural root cause does not apply. Empirical validation S61: launch →
converse → stop full lifecycle PASS.

---

## Finding routing

When a Checker returns PASS_WITH_NOTES or FAIL, or an Executor escalates
mid-task, each finding routes through a **binary in-scope-ness rule**. The
Orchestrator evaluates the rule directly — there is no separate routing
skill. The predicate (per B10):

> A finding is **in-scope** if and only if its `location` (file path) falls
> within the file-ownership set of the current subtask brief, **OR** the
> finding's `axis` is `spec-compliance` against the subtask's spec slice.

If the Orchestrator cannot decide in-scope vs out-of-scope (ambiguity),
the finding goes to the Curator. Ambiguity is a Curator decision input, not
an Orchestrator routing input.

**In-scope** findings go to a fix-Executor (three fix-flows per N1).
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

The Orchestrator's baseline skill catalogue (loaded with this skill, no
per-Task selection): `start-session`, `context-engineering`,
`session-driver-cmux`, `spec-driven-implementation`,
`diagnose-ci-failures`, `update-docs`, `handoff`.

Task-specific skills are added on demand by Liam (per Q-PLANNER-SKILLS-1
ratification) — consult `docs/reference/skill-routing-map.md` to look up
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
   or `git -C <relative>`; PreToolUse hooks enforce.

For the full per-pattern Orchestrator response (CLAUDE.md anchors,
git-safety rules, when to re-engage a Planner vs a Curator), see [references/failure-modes.md](references/failure-modes.md).

---

## Decision framework

**Parallelise a wave** when:

- Multiple subtask groups own disjoint file sets.
- No shared mutable schema or migration ordering between them.
- Each is independently testable.

**Serialise** when:

- Subtask groups share files or types.
- Schema migrations have ordering dependencies.
- One group produces inputs another consumes.

**Escalate to Liam** when:

- Spec is ambiguous on a decision that materially affects scope.
- Cycle detected in subtask-group dependencies.
- Checker FAILs three times on the same group (spec/plan defect).
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
- Roadmap / backlog implications recorded.

The Orchestrator does not declare a session `done` without:

- All in-scope Tasks `done` or explicitly `deferred` with reason.
- `update-docs` invoked.
- `handoff` invoked.

---

## Ledger field-discipline

The Orchestrator owns ledger writes for status transitions, journal-block
appends, Subtask additions, and Task opens. Per-field discipline (ID-34
canonical scope) — write the right shape into the right field:

| Field | Shape | Load-bearing for |
|---|---|---|
| `last_updated` (file-level) | Single-line `kh-{track}-S{N} {wave} close-out — {short marker}` (max 200 chars; Zod-enforced on `task-list.json`) | Freshness guard only. NEVER narrative — see `update-roadmap-backlog/SKILL.md` §`last_updated` field-discipline. |
| Subtask `details` `<info added on …>` blocks | Multi-line narrative permitted; structured journal blocks per PRODUCT inv 13 | Per-Subtask traceability. THE canonical home for session-by-session narrative (commits, test counts, OQ ratifications, Checker verdicts, Curator decisions). |
| Task `description` | One-paragraph human-readable purpose; updated only on scope amendment | Cross-doc cross-reference target. NOT a journal. |
| Task `status_note` | Short rationale for current status (`blocked: waiting on X`); ≤300 chars | Status-line context only. Bump on status flip. |
| `testStrategy` (Subtask) | One-line acceptance criterion the Checker verifies against | Checker contract. |
| `cross_doc_links` | Repo-relative path + anchor + raw text per `DocLinkSchema` | Doc-graph traversal. |
| Commit messages | Body + bullets per `commit-commands` convention | Per-commit immutable audit. |
| Continuation prompts (`docs/continuation-prompts/`) | Multi-section session handoff | Session-to-session context transfer. |
| Mempalace diary (`mempalace_diary_write`) | AAAK pipe-delimited per-WP segments | Cross-session recall. |

**Anti-pattern: diary-style append into `last_updated`** (S64 W0 root cause).
The `{summary}` placeholder previously in the curator skill format strings
invited unbounded prose; cherry-pick conflict resolution by concatenation
entrenched the convention. The Zod schema now rejects multi-session-id values
on `task-list.json`. Apply the same discipline manually on
`product-roadmap.json` + `product-backlog.json` (no schema-level enforcement
there yet — track for ID-34 follow-up).

**When in doubt about which field carries which content**: per-Subtask
`details` journal block is the catch-all. `last_updated` is ONLY the
session/wave freshness stamp.

---

## What this skill is NOT

- Not an executor. The Orchestrator never writes production code itself
  — always dispatches.
- Not a checker. The Orchestrator never audits commits itself — always
  dispatches.
- Not a curator. The Orchestrator never edits roadmap or backlog itself
  — always dispatches the `workflow-curator` agent. Exception: the Orchestrator
  directly invokes `update-roadmap-backlog` Promote mode when picking up a
  backlog item (this is Orchestrator-direct per S60 ratification, not via the
  curator).
- Not Taskmaster-coupled. KH adopts the TM JSON **shape** (per §7 of the
  canonical doc) but not the TM CLI or MCP tool. The Orchestrator does
  not invoke `mcp__task-master-ai__*` tools or `task-master` CLI
  commands.
- Not a separate agent file. The S47 v1 `workflow-orchestrator.md` agent
  was deleted in S51 (per §9.4 ratification). The role lives in this
  skill body, loaded by the main session at session start.

---

## References

For the canonical SDLC doc, sibling agent files, dispatch-primitive skills,
schema + validation modules, side skills the Orchestrator invokes,
Curator-side skills, and project-rule anchors, see [references/external-references.md](references/external-references.md).
