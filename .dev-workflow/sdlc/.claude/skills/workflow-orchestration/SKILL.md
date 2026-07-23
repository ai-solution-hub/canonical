---
name: workflow-orchestration
description:
  ? Operationalises the Canonical Platform SDLC workflow for the main session, which IS
    the Orchestrator. Loaded at session start to drive the ID-N Task / ID-N.M Subtask
    lifecycle
  : decomposes work, dispatches Planner / Executor / Checker / Curator sub-agents, gates
    each subtask behind verification, routes findings, owns sequential cherry-pick merges.
    Use whenever the main session needs to orchestrate Canonical work.
allowed-tools: Read, Bash, Grep, Glob, Edit, Write, Skill, Agent
---

# workflow-orchestration

The Orchestrator does not write production code. Its job is decomposition, dispatch,
gating, and merge sequencing. It dispatches the four other roles (Task Planner, Task
Executor, Task Checker, Workflow Curator) via the built-in `Agent` tool or
`session-driver-cmux`.

If the continuation prompt includes usage of cmux terminals, chain to the
`session-driver-cmux` skill to prepare and deploy sub-orchestrators.

## Context economics

Cost scales with turn COUNT, not just per-turn work — every turn re-sends the entire
growing context, so inline executor-grade work on the orchestrator main thread is the
single most expensive shape: a long-lived thread whose context only grows.

---

## ID-N lifecycle

Every Task follows the same six-phase shape. ID-N (Task) and ID-N.M (Subtask) are the
universal terminology — every cross-doc reference, every dispatch brief, every state
transition uses this convention.

```
SESSION
├── start-session                               (skill — bootstrap)
│
├── TASK ID-N
│   ├── Subtask {N.1} RESEARCH.md              (Planner; conditional)
│   ├── Subtask {N.2} PRODUCT.md               (Planner → Checker → fix-Planner loop; conditional)
│   ├── Subtask {N.3} TECH.md                  (Planner → Checker → fix-Planner loop; conditional)
│   ├── Subtask {N.4} PLAN.md                  (Planner via planning-and-task-breakdown; conditional)
│   │                                          ── ratification gate ──
│   ├── Subtask {N.5+} implementation          (Executor → Checker per subtask group)
│   ├── /simplify pass                         (Executor, end-of-task)
│   ├── quality-review pass                    (Checker, end-of-task)
│   └── Task close                             (Orchestrator gates → done)
│
├── ...
│
└── handoff                       (skill — close)
```

### Phase summary

- **Spec-authoring ({N.1}–{N.4})** — `spec-driven-implementation` chain: RESEARCH.md,
  PRODUCT.md, TECH.md, PLAN.md — **all four conditional**. One fresh Planner per subtask,
  Checker gates each output, Liam ratifies before implementation. Right-size the spec
  chain via the four named tiers (Full chain / PRODUCT+PLAN / TECH+PLAN / Spec-free) — the
  Orchestrator decides the tier at Task open, records it as a terse `status_note` marker
  (≤300-char budget). Full tier definitions:
  [references/lifecycle-detail.md](references/lifecycle-detail.md) §Spec-authoring phase.
- **Implementation ({N.2-5+})** — one Executor per subtask. Parallel when groups touch
  disjoint file sets; sequential when they share files / schema / produced inputs.
- **Closing** — Executor `/simplify` pass, then Checker `quality-review` pass, then
  Orchestrator gates Task → `done` only after Curator triage complete and
  initiative/backlog implications recorded.

Inspect recently-active task records via the ledger CLI — **never Read the ledger JSON
files wholesale** (task-list.json is multi-MB; full reads burn context for nothing):

```bash
bun scripts/ledger-cli.ts show task <id>            # one task record (size-shaped ≤48KB; --full for verbatim)
bun scripts/ledger-cli.ts get task <id> <field>     # one field (e.g. status_note)
bun scripts/ledger-cli.ts get task <id>.<subId>     # one subtask directly (no whole-task fetch)
```

**Field-selection rule:** for a Subtask the continuation prompt names, read the field the
prompt points at first. Absent a pointer: `journal <id>.<sub>` for narrative state,
`get <id>.<sub> details` for the spec brief, `get <id> status_note` for the task-level
rollup. Skip `show task <id>` entirely when the prompt already summarises the task — go
straight to the named journal (`show`'s journal behaviour is size-dependent: stubbed on
large tasks, inlined on small ones — don't rely on it for the thread).

For full per-phase detail (Planner-model rules, subtask `details`/`testStrategy`
structure, end-of-task gates, the helper's call-shape with ts example), see
[references/lifecycle-detail.md](references/lifecycle-detail.md).

---

## Dispatch protocol

The Orchestrator never invokes a sub-agent inline in the main session's conversation
buffer. Every Planner / Executor / Checker / Curator is dispatched via one of three
layered primitives. Pick the right one for the shape of the work:

| Scenario                                                                                          | Primitive                                                        |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Parallel ID-N Tasks, each running its own full workflow lifecycle (orchestrator-of-orchestrators) | `session-driver-cmux` per Task (sub-orchestrator pattern, fleet) |
| Single short Executor on one subtask                                                              | Built-in `Agent` tool with `isolation: "worktree"`               |
| Multi-turn worker reused across subtasks                                                          | `session-driver-cmux` (cmux preserves state)                     |
| Checker on one subtask group                                                                      | Built-in `Agent` tool (single-turn, no fleet)                    |
| Curator on one finding                                                                            | Built-in `Agent` tool (no isolation; ledger writes in main repo) |

Orchestrator-of-orchestrators - sub-orchestrator dispatched via `session-driver-cmux`
loads `workflow-orchestration` itself and runs the full planner / executor / checker /
curator lifecycle on its own ID-N Task in its own worktree.

For details on how the three primitives compose and what every dispatch brief must carry,
see [references/dispatch-primitives.md](references/dispatch-primitives.md).

### Merge cadence

After every subtask PASS (or PASS_WITH_NOTES with all notes resolved), the Orchestrator
owns the merge. Executors invoke `commit-commands` per subtask. **On conflict**: invoke
the `resolve-merge-conflicts` skill.

---

## Finding routing

When a Checker returns PASS_WITH_NOTES or FAIL, or an Executor escalates mid-task, each
finding routes through a **binary in-scope-ness rule**. The Orchestrator evaluates the
rule directly - the predicate:

> A finding is **in-scope** if its `location` (file path) falls within the file-ownership
> set of the current subtask brief, **OR** the finding's `axis` is `spec-compliance`
> against the subtask's spec slice.

**In-scope** findings go to a fix-Executor. **Out-of-scope** findings go to the
`workflow-curator` agent, which runs `triage-finding` then writes to backlog / subtask /
**decision-register** via `update-roadmap-backlog`.

**Active-task-first.** Out-of-scope for the current Subtask does NOT default to backlog: a
finding inside ANY active Task ID-N's scope routes to THAT task — as an add-subtask or a
`details` journal append, even when the work is next-session. The backlog receives a
finding only when no active task owns it. The curator returns the owning-task intent; the
Orchestrator applies it via `ledger-cli.ts` on MAIN.

For the full Checker JSON output schema, verdict mapping, the three fix-flows, and Curator
routing detail, see
[references/checker-output-schema.md](references/checker-output-schema.md).

---

## Decision-register wiring

The decision register
(`${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/decision-register.md`, `DR-NNN`) is
the durable, read-at-start store of settled architectural decisions. It binds the
Orchestrator at three moments:

- **Writing rulings.** A `DR-NNN` entry is written ONLY on the MAIN checkout — never in a
  worker branch (mirrors the ledger-write rule). Workers (Planner, Executor, Checker,
  Curator) return **DR-intents**; the Orchestrator allocates the `DR-NNN` id and appends
  the entry on `main` (or routes it to `handoff` for session-close write). An in-branch
  register edit bypasses id-allocation exactly as an in-branch ledger write does.

---

## Decision-point recall

The Orchestrator — and, via the brief's grounding block, every briefed Planner / Executor
/ Checker / Curator — MUST run recall (mempalace search) BEFORE presenting any conclusion,
plan, ratification, spec, or verdict that cites a task id, a `DR-NNN`, prior-session
framing, or settled state — not only at session start.

**Cheap guard:** any brief or answer citing `id-N` / `DR-NNN` / `{N.M}` first confirms
that record's LIVE status — `bun scripts/ledger-cli.ts get task <id> status` — before
relying on it. Protocol home: the `recall-grounding` skill.

---

## State machine

Who sets which status is part of the role boundary. The Checker is the only role that can
mark a Subtask `done`; the Orchestrator is the only role that can mark a Task `done`. The
Executor never sets either.

For the full Subtask + Task state-machine tables (states, who sets them, trigger
conditions) and the schema-enforcement note for `SubtaskStatus.exclude(...)`, see
[references/state-machines.md](references/state-machines.md).

---

## Skill routing

The Orchestrator's baseline skill catalogue: `start-session`, `context-engineering`,
`session-driver-cmux`, `spec-driven-implementation`, `diagnose-ci-failures`, `handoff`.

Task-specific skills are added on demand — consult
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/skill-routing-map.md` to look up which
skills fit the Task's tilt (AI, CI, Supabase, Frontend, Data-pipeline, etc.). The
Orchestrator names skills in the dispatch brief; sub-agents do not auto-discover skills.

For the full baseline catalogue with per-skill descriptions and the Task-tilt lookup rule,
see [references/skill-routing.md](references/skill-routing.md).

---

## Failure handling

Six recurring failure patterns, each with a fixed Orchestrator response:

1. **Executor commits but produces failing tests** — fix-Executor with test output as
   finding packet; new commit (never `--amend`).
2. **Executor exits mid-commit** — `git status` in the worktree first; rescue uncommitted
   work with a manual commit.
3. **Checker FAILs three times on same group** — escalate to Liam; spec/plan defect,
   re-engage a Planner.
4. **Worktree leakage on merge** — `git clean -fd`; do not proceed until working tree is
   clean.
5. **Sub-agent escalation on production behaviour** — scope renegotiation, not workaround.
6. **Worktree-CWD drift** — never `cd /Users/liamj/...`; use relative paths or
   `git -C <relative>`.

For the full per-pattern Orchestrator response (CLAUDE.md anchors, git-safety rules, when
to re-engage a Planner vs a Curator), see
[references/failure-modes.md](references/failure-modes.md).

---

## Quality gates

The Orchestrator does not declare a subtask group `done` without:

- Checker verdict of PASS, or PASS_WITH_NOTES with all notes either fixed or curated.
- All subtask commits cherry-picked to the track branch.
- `bun run test` green after each cherry-pick.
- Out-of-scope findings either curated or recorded.

The Orchestrator does not declare a Task `done` without:

- All Subtasks `done`.
- `/simplify` Executor pass complete.
- `quality-review` Checker pass complete (verdict PASS or PASS_WITH_NOTES with all notes
  resolved).
- Curator triage complete on every out-of-scope finding surfaced during the Task.
- task-list / backlog implications recorded.

---

## Ledger field-discipline

The Orchestrator owns ledger writes for status transitions, journal-block appends, Subtask
additions, and Task opens. All writes route through the `bun scripts/ledger-cli.ts` façade
— never raw `Edit` on the JSON ledgers. The CLI is the **operator surface**; the
**enforcement point** (serialisation, record-set + budget gates, mirror regen) lives in
the task-view patch-server substrate. Per-field discipline — **Canonical reference:**
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/task-list-discipline.md`

| Field                                                                                  | Shape                                                                                                                                       | Load-bearing for                                                                                                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Subtask `details` `<info added on …>` blocks                                           | Multi-line narrative permitted; structured journal blocks                                                                                   | Per-Subtask traceability. THE canonical home for session-by-session narrative (commits, test counts, OQ ratifications, Checker verdicts, Curator decisions). |
| Task `description`                                                                     | One paragraph: compact what+why, ≤1200 chars; rationale → `docs/` + `cross_doc_links` pointer, not inlined; updated only on scope amendment | Cross-doc cross-reference target. NOT a journal.                                                                                                             |
| Subtask `description`                                                                  | One-sentence summary, ≤250 chars; not a copy of `details`                                                                                   | Subtask scan label.                                                                                                                                          |
| Task `status_note`                                                                     | Short rationale for current status (`blocked: waiting on X`); ≤300 chars                                                                    | Status-line context only. Bump on status flip.                                                                                                               |
| `testStrategy` (Subtask)                                                               | One-line acceptance criterion the Checker verifies against                                                                                  | Checker contract.                                                                                                                                            |
| `cross_doc_links`                                                                      | Repo-relative path + anchor + raw text per `DocLinkSchema`                                                                                  | Doc-graph traversal.                                                                                                                                         |
| Commit messages                                                                        | Body + bullets per `commit-commands` convention                                                                                             | Per-commit immutable audit.                                                                                                                                  |
| Continuation prompts (`${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/`) | Multi-section session handoff                                                                                                               | Session-to-session context transfer.                                                                                                                         |
| Mempalace diary (`mempalace_diary_write`)                                              | AAAK pipe-delimited per-WP segments                                                                                                         | Cross-session recall.                                                                                                                                        |

**Budget gate is HARD for Subtask `description` (≤250) and `testStrategy` (≤300):**
Records MUST be authored within budget on the first pass; relocate any overflow into the
unbudgeted `details` field.

---

## Backlog pickup → Promote

When the Orchestrator or Liam selects a backlog item from the backlog ledger
(`bun scripts/ledger-cli.ts show backlog <id>`) to implement, the **first action is the
promote CLI**:

```bash
bun scripts/ledger-cli.ts promote <backlogId> <taskJson>
```

> The topology is initiatives → sub-initiatives → projects (only **projects** carry
> `linked_tasks`/`linked_backlog`; linking a newly promoted Task's project into an
> initiative uses `link-tasks <slug> <taskId…>` — but only against an **existing** project
> (`create-project` requires an existing initiative/sub-initiative path;
> `create-initiative [<parentPath>] <initiativeJson | --title …>` now creates a brand-new
> top-level initiative when `parentPath` is omitted, or a sub-initiative under it when
> given).

**Orchestrator-direct:** The curator handles triage and create; the Orchestrator handles
the backlog → task-list lifecycle transition via the CLI above.

### In-flight Subtask carryover (session-close)

In-flight Subtasks survive session boundaries: a started-but-incomplete Subtask remains an
`in_progress` / `pending` Subtask record across session close — it is NOT demoted to the
backlog. Session-close triage must not use the backlog as a parking lot for work already
started; the backlog is for not-yet-committed ideas only (consistent with the
committed-work rule already in `triage-finding` — _have we committed to doing this?_ Yes →
Task List; not yet → Backlog).

---

## Escalation

If you are a sub-orchestrator and you hit an Open Question that cannot be resolved
in-scope, you must NOT silently proceed or block indefinitely. Use the OQ-escalation
channel: `.claude/skills/session-driver-cmux/oq-brief-fragment.md`

The OQ protocol is implemented as a durable file-per-record mailbox under each worker's
`.claude/cmux-events/<sid>/oq/` directory. The helper scripts sit in
`.claude/skills/session-driver-cmux/scripts/`, beside the five dispatch scripts:

| Script                    | Side   | Functions                                                                                                 |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `scripts/oq-core.sh`      | shared | `atomic_publish`, `verify_record`, `list_records`, `derive_oq_id`, `next_seq`, record builders/validators |
| `scripts/oq-worker.sh`    | worker | `oq_emit`, `oq_cancel`, `oq_poll_decision`, `oq_check_decision`, `oq_restart_classify`                    |
| `scripts/oq-parent.sh`    | parent | `oq_list_open`, `oq_decide`, `oq_scan_fleet`                                                              |
| `scripts/oq-canonical.py` | shared | canonical-JSON + SHA-256 checksum (stdlib only)                                                           |

---

## References

For the canonical SDLC doc, sibling agent files, dispatch-primitive skills, schema +
validation modules, side skills the Orchestrator invokes, Curator-side skills, and
project-rule anchors, see
[references/external-references.md](references/external-references.md).
