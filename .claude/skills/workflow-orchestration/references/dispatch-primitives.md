# Dispatch primitives composition

How the three dispatch primitives (`dispatching-parallel-agents`,
`using-git-worktrees`, `session-driver-cmux`) layer, and how to compose a
dispatch brief for any sub-agent.

## How the primitives compose

The three primitives are layered, not interchangeable. They were harmonised so that whichever you pick, the worktree contract is the same:

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

## Composing a dispatch brief

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
- **Worktree directive** — verification gate as first action (`pwd && git branch --show-current && git fetch origin <track> && git reset --hard origin/<track> && git branch --show-current` — verbatim, no `cd` prefix). Use relative paths throughout. Commit before finishing. **Never `cd` to absolute knowledge-hub paths.**
- **Escalation rule** — if the sub-agent finds unexpected production
  behaviour, STOP and escalate. Do not silently work around (CLAUDE.md
  "Agent escalation rule").

### Curator-brief composition

When dispatching the `workflow-curator`, the Orchestrator MUST supply a
structured **docket** — the session-validated brief shape that eliminated
curator stalls. The docket = finding packet + task context + the specific
decision requested + the candidate routes (subtask / roadmap / backlog /
no-action) + the ledger-write owner. The canonical docket shape is defined in
`.claude/agents/workflow-curator.md` — author the brief against that section.

## cmux vs `/workflows` decision boundary

A fourth surface exists alongside the three dispatch primitives above:
Claude Code's **`/workflows` dynamic workflows** (saved JS scripts under
`.claude/workflows/`, runtime-executed, fanning out up to 16 concurrent /
1000 total background subagents; intermediate results stay in script
variables rather than in the orchestrator's context). It is **not** a
replacement for cmux — it occupies a different point on the stateful ↔
stateless axis. Pick the surface by the nature of the work, not by habit:

| Dimension | **cmux** (`session-driver-cmux`) | **`/workflows`** (saved JS) |
|---|---|---|
| Work shape | **Stateful lifecycle** | **Stateless read-only fan-out** |
| Worktrees / commits / cherry-pick | Yes — owns the worktree lifecycle | No — script has no fs/shell; spawned agents read via their own tools |
| Ledger writes (`task-list.json`) | Yes | No |
| Mid-session OQ-escalation | Yes — durable attachable terminals, multi-turn workers | No mid-run input; not durable across CLI exit |
| Per-tool gating | Yes (JSONL event stream + gate hook) | No |
| Context cost | Plan + intermediate state live in the orchestrator's context | Intermediate results stay in script vars → **context-offload** |
| Best for | Subtask implementation, the SDLC `{N.5+}` lane, anything that commits | Read-only corpus sweeps / audits / deep-research where context-offload is the win |

**Rule of thumb:** if the work needs a worktree, a commit, a ledger
write, mid-session escalation, or a durable attachable terminal →
**cmux**. If it is a read-only fan-out whose only output is a synthesised
report, and the value is keeping the per-item intermediate reads OUT of
the orchestrator's context → **`/workflows`**.

### ID-48.21 pilot (scope + constraints)

One workflow is piloted on `/workflows`: the **workflow-evaluator
efficiency sweep** (the `evaluate-workflow` lane, {48.5}), saved as
`.claude/workflows/evaluator-efficiency-sweep.js`. It fans out the
read-only RESEARCH §7 corpus sweep so the per-session metric reads are
offloaded from the O-of-O context. This is a deliberate fit: the sweep is
read-only + stateless (no worktree lifecycle), which is exactly the
`/workflows` sweet spot.

Hard constraints on this pilot:

- **ONE workflow only.** This does **not** migrate the SDLC lifecycle to
  `/workflows`. The cmux SDLC lifecycle (Planner → Executor → Checker →
  Curator over worktrees + ledger) is unchanged.
- **`ultracode` OFF, auto-workflow OFF.** The workflow is a **manual**
  saved command (`/evaluator-efficiency-sweep`), never autonomous.
  Autonomous / `ultracode` orchestration conflicts with KH's deliberate
  spec-gated, Liam-ratified cadence and stays OFF by default.
- **Read-only.** No worktree lifecycle, no commits, no ledger writes from
  the workflow. The spawned agents read the archived corpus; the script
  itself has no fs/shell access.

If a future candidate looks like a `/workflows` fit but needs any of the
cmux-only columns above (commits, ledger, mid-session escalation), it is a
cmux job — escalate rather than stretching `/workflows` past its boundary.
