# Dispatch primitives composition

How the three dispatch primitives (`dispatching-parallel-agents`, `using-git-worktrees`,
`session-driver-cmux`) layer, and how to compose a dispatch brief for any sub-agent.

## How the primitives compose

The three primitives are layered, not interchangeable. They were harmonised so that
whichever you pick, the worktree contract is the same:

- **`dispatching-parallel-agents`** — the abstract pattern. Identify independent task
  domains, compose focused sub-tasks, run in parallel, integrate results. This is what you
  reason with when planning a wave; it doesn't create worktrees itself.
- **`using-git-worktrees`** — the concrete worktree-creation primitive. Carries the safety
  contract: `git check-ignore` for the worktree path, baseline-test gate before the worker
  starts, post-merge cleanup hooks. Used directly for single-Executor worktree creation,
  or composed under `session-driver-cmux` for the fleet.
- **`session-driver-cmux`** — fleet dispatch implementation. cmux terminals
  - Claude sub-sessions + per-worker git worktree + JSONL event stream at
    `.claude/cmux-events/<session-id>/events.jsonl`. Used when you need durable attachable
    terminals, multi-turn workers, or per-worker tool gating.

## Composing a dispatch brief

Every dispatch produces a brief the sub-agent receives as its initial prompt. The brief
carries:

- **Subtask reference** — `ID-N.M` plus the Subtask object from `task-list.json`
  (slice-read the single Subtask with `bun scripts/ledger-cli.ts get task <N>.<M>` and
  pass it through verbatim — its `details` field is the load-bearing dispatch brief; do
  NOT source `details` from a bare `show`, which stubs journals on large tasks).
- **Spec-slice reference** — path + anchor to the section of PRODUCT.md / TECH.md the
  subtask references.
- **File-ownership boundaries** — explicit allow-list of files this dispatch may touch.
- **Skills to invoke** — list specific Canonical platform skills (e.g.
  `test-driven-development`, `incremental-implementation`).
- **Megafile navigation aid** — if the dispatch touches a file larger than the 2,000-line
  Read window (e.g. `scripts/ledger-cli.ts`, `scripts/cocoindex_pipeline/flow.py`),
  include a symbol→line index in the brief (`grep -n "def \|class \|function " <file>`)
  and instruct Grep-first navigation. Workers cannot hold such files and otherwise pay a
  heavy `Read@offset` paging tax. Do NOT pin whole-file excerpts for these.
- **Escalation rule** — Pointer to `.claude/agents/references/shared-discipline.md`
  §Escalation rule.
- **Friction guidance** — Pointer to `.claude/agents/references/shared-discipline.md`
  §Friction-guard conventions.
- **Grounding block** — Pointer to `.claude/agents/references/shared-discipline.md`
  §Grounding block.
- **Result-size discipline** — Pointer to `.claude/agents/references/shared-discipline.md`
  §Result-size discipline.

### Friction-guard convention lines (carry into EVERY brief)

The friction register
(`knowledge-hub-docs-site/src/content/docs/workflow-evaluation/friction-register.md`)
tracks recurring operational friction across the archived corpus which every worker /
sub-orchestrator MUST be made aware of — the dispatch brief must include a pointer to
these.

### Result-size discipline (carry into EVERY brief)

Sub-agents should keep tool-result and return-payload size **bounded**
(`.claude/agents/references/shared-discipline.md` §Result-size discipline) — an unbounded
tool result or inlined artefact body burns the dispatching agent's context window and can
stall the worker on its own output. The dispatch brief must include a pointer to these.

### Grounding-block convention lines (carry into EVERY brief)

The grounding block (canonical semantics: `.claude/agents/references/shared-discipline.md`
§Grounding block) is the THREE-part standing content every Planner / Executor / Checker /
Curator MUST adhere to — the dispatch brief must include a pointer to these.

### Curator-brief composition

When dispatching the `workflow-curator`, the Orchestrator MUST supply a structured
**docket** — the session-validated brief shape that eliminated curator stalls. The docket
= finding packet + task context + the specific decision requested + the candidate routes
(subtask / roadmap / backlog / no-action) + the ledger-write owner. The canonical docket
shape is defined in `.claude/agents/workflow-curator.md` — author the brief against that
section.
