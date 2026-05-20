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

### Spec-authoring phase ({N.1}–{N.4})

When a Task lands with unspec'd surface area, the Orchestrator invokes
`spec-driven-implementation` to create the spec-authoring subtask chain:

- `{N.1}` RESEARCH.md — Planner, when warranted by domain complexity. Domain
  skills (`claude-api`, `supabase-postgres-best-practices`, etc.) are added
  to the Planner's loadout on demand by Liam (§4.4 below).
- `{N.2}` PRODUCT.md — Planner invokes `write-product-spec` directly. Output
  is numbered, testable Behaviour invariants per the skill's mandated
  structure.
- `{N.3}` TECH.md — A **fresh** Planner instance reviews the ratified
  PRODUCT.md and writes TECH.md via `write-tech-spec`. One Planner per
  subtask — Planners are not persistent across waves (per Q-PLANNER-2
  ratification).
- `{N.4}` PLAN.md — Conditional; only when `planning-and-task-breakdown`
  decomposition is needed to populate implementation subtasks.

Each Planner is opus-4-7 with `thinking: 'max'` per Q-PLANNER-1. The
Orchestrator dispatches each Planner with the ratified upstream artefact
(PRODUCT for the TECH Planner; both for the PLAN Planner) and a Checker
gates each output.

After the chain ratifies (Liam's go/no-go), the Planner populates
implementation subtasks `{N.5+}` in `task-list.json`. Each subtask gets:

- `details` — the load-bearing dispatch brief: file paths, function names,
  "verify X" lines, spec-slice references. This is what the Executor reads.
- `testStrategy` — one-line acceptance prose.

### Implementation phase ({N.5+})

One Executor per **logical subtask group** — a contiguous sequence of subtasks
that share file ownership and can be committed atomically (per A7). Not one
Executor per individual subtask.

The Orchestrator decides parallel-vs-serial dispatch based on file-ownership
boundaries between groups:

- **Parallel** when groups touch disjoint file sets. Dispatch concurrently
  in isolated worktrees via the dispatch primitives (§5 below).
- **Sequential** when groups share files, schema migrations have ordering
  dependencies, or one group produces inputs another consumes.

Each Executor reads only its subtask `details` and the spec slice the brief
references. Executors do **not** read the whole PRODUCT.md or TECH.md.

### Closing phases

After every implementation subtask group is `done`:

1. **`code-simplification` pass** — Executor (end-of-task) runs the
   `code-simplification` skill over the Task's commit set.
2. **`quality-review` pass** — Checker (end-of-task) runs the
   `quality-review` variant: invokes `security-and-hardening` /
   `performance-optimization` / `type-design-analyzer` based on Task kind
   and findings.
3. **Task close** — Orchestrator gates Task `in_progress` → `done` only
   after all subtasks are `done`, Curator triage is complete, and
   roadmap/backlog implications are recorded.

### Loading task-list.json (soft-ceiling surfacing)

When reading `docs/reference/task-list.json`, do **not** call `JSON.parse`
directly — invoke `parseTaskListWithWarnings` from
`lib/validation/task-list-schema.ts`:

```ts
import { parseTaskListWithWarnings } from '@/lib/validation/task-list-schema';

const raw = JSON.parse(await fs.readFile('docs/reference/task-list.json', 'utf8'));
const { value, warnings } = parseTaskListWithWarnings(raw);
```

The helper validates against `TaskListSchema` (throws ZodError on schema
violation) and surfaces a `TaskListWarning[]` for any Task with more than 25
Subtasks (PRODUCT inv 20). The 25-Subtask ceiling is a planning signal, not a
hard cap — present the warnings to Liam at session start and treat them as a
Task-boundary problem (split the Task) rather than an error.

This is the only ingress path for the Task list in the Orchestrator skill.
Skipping the helper means missing the soft-ceiling signal — that's the whole
reason the helper exists.

---

## Dispatch protocol

The Orchestrator never invokes a sub-agent inline in the main session's
conversation buffer. Every Planner / Executor / Checker / Curator is
dispatched via one of three layered primitives. Pick the right one for the
shape of the work (§5.4 of the canonical doc):

| Scenario                                       | Primitive |
|------------------------------------------------|-----------|
| Parallel wave of long-running Executors        | `session-driver-cmux` per Executor |
| Single short Executor on one subtask group     | Built-in `Agent` tool with `isolation: "worktree"` |
| Multi-turn worker reused across subtasks       | `session-driver-cmux` (cmux preserves state) |
| Checker on one subtask group                   | Built-in `Agent` tool (single-turn, no fleet) |
| Curator on one finding                         | Built-in `Agent` tool (no isolation; ledger writes in main repo) |

### How the primitives compose (§5)

The three primitives are layered, not interchangeable. They were harmonised
(per A4 ratification) so that whichever you pick, the worktree contract is
the same:

- **`dispatching-parallel-agents`** — the abstract pattern. Identify
  independent task domains, compose focused sub-tasks, run in parallel,
  integrate results. This is what you reason with when planning a wave; it
  doesn't create worktrees itself.
- **`using-git-worktrees`** — the concrete worktree-creation primitive.
  Carries the safety contract: `git check-ignore` for the worktree path,
  baseline-test gate before the worker starts, post-merge cleanup hooks.
  Used directly for single-Executor worktree creation, or composed under
  `session-driver-cmux` for the fleet.
- **`session-driver-cmux`** — fleet dispatch implementation. cmux terminals
  + Claude sub-sessions + per-worker git worktree + JSONL event stream at
  `.claude/cmux-events/<session-id>/events.jsonl`. Used when you need
  durable attachable terminals, multi-turn workers, or per-worker tool
  gating.

### Composing a dispatch brief

Every dispatch produces a brief the sub-agent receives as its initial
prompt. The brief carries:

- **Subtask reference** — `ID-N.M` plus the Subtask object from
  `task-list.json` (read the relevant Task with `parseTaskListWithWarnings`
  and pass the Subtask through verbatim — its `details` field is the
  load-bearing dispatch brief).
- **Spec-slice reference** — path + anchor to the section of PRODUCT.md /
  TECH.md the subtask references. The Executor reads only this slice.
- **File-ownership boundaries** — explicit allow-list of files this dispatch
  may touch. Everything else is off-limits.
- **Skills to invoke** — list specific KH skills (e.g.
  `test-driven-development`, `incremental-implementation`).
- **Worktree directive** — verification gate as first action (`pwd && git branch --show-current && git fetch origin <track> && git reset --hard origin/<track> && git branch --show-current` — verbatim, no `cd` prefix). Use relative paths throughout. Commit before finishing. **Never `cd` to absolute knowledge-hub paths** — PreToolUse hook blocks this mechanically; if briefs contain the legacy `cd $(git rev-parse --show-toplevel)` pattern they must be rewritten before dispatch.
- **Relevant gotchas** — copy specific CLAUDE.md bullets that apply; don't
  expect the sub-agent to re-read CLAUDE.md from scratch.
- **Escalation rule** — if the sub-agent finds unexpected production
  behaviour, STOP and escalate. Do not silently work around (CLAUDE.md
  "Agent escalation rule").

### Merge cadence (load-bearing — §6.4)

After every subtask-group PASS (or PASS_WITH_NOTES with all notes resolved),
the Orchestrator owns the merge. Executors invoke `commit-commands` per
subtask and do **not** have `git-workflow-and-versioning` available (per B9).
That is the Orchestrator's skill. Steps:

1. **Cherry-pick parallel agent branches sequentially onto the track branch.**
   Never merge; never parallel. Worktree branches always cherry-pick because
   parallel agents branched from main at launch time and the earlier merges
   make later agents stale (CLAUDE.md "Worktree isolation rules" — "Cherry-pick
   (not merge) parallel agent branches").
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

Sequential, never parallel. This is the only way to keep the track branch
deterministic when multiple worktree branches touched adjacent areas. The
Orchestrator's `git-workflow-and-versioning` skill carries the broader
branch-hygiene rules (no `--amend`, no force-push to `main`, etc.) — those
apply throughout.

---

## Worktree isolation discipline

### Critical first action — verification gate

`isolation: "worktree"` branches from a historical commit, not the current
track HEAD (CLAUDE.md "Worktree agents start stale"). The agent's worktree
HEAD may be hours or days behind. Every dispatch brief's first instruction
must be (verbatim — do NOT prefix with `cd`):

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

---

## Finding routing (§3.6 + §6.2)

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

### In-scope → fix-Executor

The Orchestrator dispatches a fix-Executor with the finding packet. Three
fix-flows (per N1):

- **Type (a) — missed-but-correctly-detailed**: fix-Executor implements the
  missing piece against the existing subtask brief. No spec change.
- **Type (b) — functionally incorrect**: fix-Executor re-implements against
  the spec slice. The original implementation diverged from the spec.
- **Type (c) — straightforward inline fix**: fix-Executor applies the
  Checker's `fix_recommendation` directly. No re-implementation.

If the finding reveals that the spec itself is wrong (implementation
discovery requires spec amendment), the Orchestrator does **not** dispatch
a fix-Executor — it re-engages a Planner to update PRODUCT.md / TECH.md,
re-runs the Checker on the amended spec, then re-decomposes implementation
subtasks.

### Out-of-scope → Curator

The Orchestrator dispatches the `workflow-curator` agent with the finding
packet. The Curator runs `triage-finding`, then — if the decision is
`roadmap` or `backlog` — invokes `update-roadmap-backlog` to write the
JSON ledger. If `subtask`, the Curator appends a subtask to the current
Task (or a future Task) and reports back. If `no-action`, the Curator logs
the justification.

The Orchestrator does **not** carry out-of-scope findings in working
memory. Curator dispatch keeps the main session's context lean across
multi-wave sessions.

### Checker output schema (§6.1)

Checker output is JSON-shaped so the routing logic is mechanical. The
Orchestrator does not re-read Checker prose; it routes from the JSON:

```json
{
  "subtaskId": "ID-15.7",
  "verdict": "PASS" | "PASS_WITH_NOTES" | "FAIL",
  "findings": [
    {
      "severity": "blocker" | "important" | "nit" | "fyi",
      "scope": "in-scope" | "out-of-scope",
      "axis": "spec-compliance" | "code-quality" | "test-quality" | "design-tokens" | "type-design" | "silent-failure" | "performance" | "security",
      "location": "path/to/file.ts:42",
      "description": "Free-text description.",
      "fix_recommendation": "Free-text or null if Curator-triage required."
    }
  ]
}
```

Verdict mapping:

- **PASS** — zero findings of any severity. Checker may set the subtask
  group's subtasks to `done`.
- **PASS_WITH_NOTES** — only `nit` / `fyi` findings; Orchestrator routes
  them but the subtask group is not blocked.
- **FAIL** — at least one `blocker` or `important` finding. Orchestrator
  must dispatch fix-Executor(s) before the subtask group closes.

The Checker may pre-populate `scope` in its output. The Orchestrator
re-evaluates against the binary rule (the Checker's view of "in-scope" can
differ from the Orchestrator's view of file-ownership, and the
Orchestrator's view wins).

---

## State machine (§6.3)

Who sets which status is part of the role boundary. Crossing these lines
breaks the workflow's evidence chain.

### Subtask state machine

| State        | Set by                  | Trigger |
|--------------|-------------------------|---------|
| `pending`    | Planner                 | Subtask creation |
| `in_progress`| Executor                | Executor accepts the dispatch brief |
| `done`       | **Checker only**        | PASS verdict with zero further-action findings |
| `deferred`   | Orchestrator            | Subtask parked (e.g. blocked on external precondition) |

The Executor moves `pending` → `in_progress` only. The Executor **never**
sets `done`. The Checker is the only role that can move a Subtask to
`done` — and only when the verdict is PASS with no findings requiring
Executor action. This is non-negotiable (per B12) because the Checker is
the audit layer; letting the Executor mark its own work `done` collapses
audit into implementation.

### Task state machine

| State          | Set by                | Trigger |
|----------------|-----------------------|---------|
| `pending`      | Orchestrator          | Task creation via `spec-driven-implementation` |
| `in_progress`  | Orchestrator          | First subtask moves to `in_progress` |
| `done`         | **Orchestrator only** | All subtasks `done` + Curator triage complete + roadmap/backlog implications recorded |
| `cancelled`    | Orchestrator          | Task abandoned (scope removed, deferred to later, etc.) |

The Orchestrator is the only role that closes a Task. Subtask-level
`done` does not propagate up — the Orchestrator runs a wider-context check
(open Curator triage decisions, roadmap/backlog promotions, sibling-Task
dependencies) before flipping Task status.

The schema enforces the subtask-status subset via
`SubtaskStatus = TaskListStatus.exclude(['cancelled', 'spec_needed', 'imp_deferred'])`
in `lib/validation/task-list-schema.ts`. Task-level-only states cannot be
written to subtasks at all — `parseTaskListWithWarnings` will throw if they
appear.

---

## Skill routing (§4.4)

The Orchestrator's baseline skill catalogue — these load with the skill
itself, no per-Task selection required:

- **`start-session`** — bootstrap: git hygiene, critical-doc read, session
  plan summary. Chains into this skill.
- **`context-engineering`** — loadout tuning when the session opens. Used
  when Liam wants to adjust which skills are loaded for the session ahead.
- **`session-driver-cmux`** — fleet dispatch primitive (§5.3). For every
  Executor / Checker / Curator dispatched in a wave > 1.
- **`spec-driven-implementation`** — invoked when a Task with unspec'd
  surface area lands. Creates the spec-authoring subtask chain.
- **`diagnose-ci-failures`** — when CI returns red on the Task's PR.
  Returns a fix plan; the Orchestrator dispatches a fix-Executor against
  it.
- **`update-docs`** — end-of-session: roadmap, state-of-the-product,
  generated stats, backlog updates.
- **`handoff`** — end-of-session: continuation-prompt for the next session.

**Task-specific skills added on demand by Liam (per Q-PLANNER-SKILLS-1
ratification):** the Orchestrator does not pre-load every potentially-useful
skill. Consult `docs/reference/skill-routing-map.md` to look up which skills
fit the Task's tilt (AI, CI, Supabase, Frontend, Data-pipeline, etc.) —
Required vs Conditional vs Anti-pattern columns tell you what to name in the
dispatch brief. This stays user-driven — the map is a lookup, not a forcing
function (Workflow Evaluator role deferred per §9.2 of the canonical doc).

When dispatching a Planner, Executor, or Checker, the Orchestrator names
the relevant skills in the dispatch brief. Sub-agents do not auto-discover
skills from the loaded catalogue — they invoke what they're told to invoke.

---

## Failure handling (§8)

Six recurring failure patterns. Encoded here so the Orchestrator's response
is consistent across sessions:

### Executor commits but produces failing tests

Dispatch a fix-Executor with the test output as the finding packet. New
commit, never `--amend` (CLAUDE.md "Git Safety Protocol"). The fix-Executor
re-runs `bun run test` before declaring complete.

### Executor exits mid-commit (token budget)

Run `git status` inside the worktree before tearing it down (CLAUDE.md
"Sub-agents can blow their token budget"). If uncommitted changes exist,
rescue them with a manual commit on the worker's branch. Then `git
worktree remove`. Never `--force` without inspecting first.

### Checker FAILs three times on the same subtask group

Escalate to Liam. Three consecutive FAILs on the same group indicates a
spec / plan defect, not an implementation defect. Re-engage a Planner to
amend PRODUCT.md / TECH.md — do not keep dispatching fix-Executors against
a broken spec.

### Worktree leakage on merge

If `git status` after a cherry-pick shows untracked files, run `git clean
-fd` and re-verify the merge produced the expected files (CLAUDE.md
"Worktree isolation rules"). Do not proceed with the next cherry-pick
until the working tree is clean.

### Sub-agent escalation

When an Executor finds production behaviour contradicting its brief, it
stops and reports. The Orchestrator treats this as a scope renegotiation,
not a workaround opportunity (CLAUDE.md "Agent escalation rule"). If the
discovery requires spec amendment, re-engage a Planner. If the discovery
reveals a pre-existing bug unrelated to the current Task, dispatch the
Curator — the bug becomes a backlog item, not a current-Task fix.

### Worktree-CWD drift in the Orchestrator (and sub-agents)

The previous mitigation (`cd <main-repo-path> &&`) was the LEAK VECTOR
itself per `docs/research/worktree-isolation-leak-investigation.md`. Bash
shell state does not persist between Bash tool calls, so every call already
starts in the harness's default cwd (which is your worktree). After any
`Read` on a worktree file from the Orchestrator's session, subsequent
git ops continue to run in the Orchestrator's worktree (the main-track
worktree) by default — no prefix needed. **If you find yourself wanting to
`cd /Users/liamj/...`, the answer is no. Use relative paths or `git -C
<relative-path>` instead.** PreToolUse hooks enforce this.

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

## What this skill is NOT

- Not an executor. The Orchestrator never writes production code itself
  — always dispatches.
- Not a checker. The Orchestrator never audits commits itself — always
  dispatches.
- Not a curator. The Orchestrator never edits roadmap or backlog itself
  — always dispatches the `workflow-curator` agent.
- Not Taskmaster-coupled. KH adopts the TM JSON **shape** (per §7 of the
  canonical doc) but not the TM CLI or MCP tool. The Orchestrator does
  not invoke `mcp__task-master-ai__*` tools or `task-master` CLI
  commands.
- Not a separate agent file. The S47 v1 `workflow-orchestrator.md` agent
  was deleted in S51 (per §9.4 ratification). The role lives in this
  skill body, loaded by the main session at session start.

---

## References

### Canonical SDLC doc

- `docs/plans/phase-0-investigation/kh-sdlc-workflow.md` — source of
  truth. If this skill body and the canonical doc disagree, the
  canonical doc loses (it documents intent; the skill is operational).
  Specifically: §2 (roles), §3 (lifecycle), §4 (skill routing), §5
  (dispatch primitives), §6 (gates), §8 (failure handling), §9.4
  (orchestrator-becomes-skill ratification).

### Sibling roles

- `.claude/agents/task-planner.md` — Planner agent (opus-4-7, `thinking: 'max'`).
- `.claude/agents/task-executor.md` — Executor agent (sonnet-4-6).
- `.claude/agents/task-checker.md` — Checker agent (sonnet-4-6, two
  variants).
- `.claude/agents/workflow-curator.md` — Curator agent.

### Dispatch primitives (§5)

- `.claude/skills/session-driver-cmux/SKILL.md` — fleet dispatch (cmux +
  worktrees + JSONL events).
- `using-git-worktrees` — worktree-creation primitive (Anthropic plugin).
- `dispatching-parallel-agents` — abstract parallel pattern (Anthropic
  plugin).
- `git-workflow-and-versioning` — Orchestrator-owned merge skill
  (Anthropic plugin).

### Schema + validation

- `lib/validation/task-list-schema.ts` — `TaskListSchema`,
  `parseTaskListWithWarnings` (inv 20 25-Subtask soft-ceiling).
- `docs/reference/task-list.json` — the live Task list.
- `docs/reference/taskmaster-schema-reference.md` — empirical TM shape.

### Side skills the Orchestrator invokes

- `start-session`, `context-engineering`, `spec-driven-implementation`,
  `diagnose-ci-failures`, `update-docs`, `handoff`, `code-simplification`,
  `resolve-merge-conflicts`.

### Curator-side skills

- `.claude/skills/triage-finding/SKILL.md` — Curator's decision skill.
- `.claude/skills/update-roadmap-backlog/SKILL.md` — Curator's write
  skill.

### Project rules

- `CLAUDE.md` — "Implementation Workflow", "Worktree isolation rules",
  "Sub-agents can blow their token budget", "Worktree agents start
  stale", "Bash CWD drifts into worktree dirs after `Read`",
  "Anthropic plugin files invisible to worktree agents", "Git Safety
  Protocol", "Agent escalation rule".
- `docs/reference/test-philosophy.md` — six audit criteria the Checker
  applies.
- `docs/design/warm-meridian-implementation-spec.md` — design tokens the
  Checker enforces.
