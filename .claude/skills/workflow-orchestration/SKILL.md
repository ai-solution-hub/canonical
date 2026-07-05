---
name: workflow-orchestration
description:
  Operationalises the Canonical Platform SDLC workflow for the main session, which IS the Orchestrator. Loaded at session start to drive the ID-N Task / ID-N.M Subtask lifecycle: decomposes work, dispatches Planner / Executor / Checker / Curator sub-agents, gates each subtask behind verification, routes findings, owns sequential cherry-pick merges. Use whenever the main session needs to orchestrate Canonical work.
allowed-tools: Read, Bash, Grep, Glob, Edit, Write, Skill, Agent
---

# workflow-orchestration

The Orchestrator does not write production code, audit commits, or edit the
roadmap/backlog. Its job is decomposition, dispatch, gating, merge sequencing,
and finding routing. It dispatches the four other roles (Task Planner, Task Executor, Task
Checker, Workflow Curator) via the built-in `Agent` tool or `session-driver-cmux` (fleet).

If the continuation prompt includes usage of cmux terminals, chain from this `workflow-orchestration` to the `session-driver-cmux` skill to prepare and deploy sub-orchestrators.

### Context economics

Cost scales with turn COUNT, not just per-turn work — every turn re-sends the entire
growing context, so inline executor-grade work on the orchestrator main thread is the
single most expensive shape: a long-lived thread whose context only grows. Self-diagnosis
signature: **peak context > 400K AND sub:main flat-token ratio < 0.2** (near-zero
spawning). If you see this shape, stop and delegate — a dispatched sub-agent pays its own
context, not yours.

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
│   ├── Subtask {N.2} PRODUCT.md               (Planner → Checker → fix-Planner loop; conditional)
│   ├── Subtask {N.3} TECH.md                  (Planner → Checker → fix-Planner loop; conditional)
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
  RESEARCH.md, PRODUCT.md, TECH.md, PLAN.md — **all four conditional**. One
  fresh Planner per subtask, Checker gates each output, Liam ratifies before
  implementation. Right-size the spec chain via the four named tiers (Full chain /
  PRODUCT+PLAN / TECH+PLAN / Spec-free) — the Orchestrator decides the tier at
  Task open, records it as a terse `status_note` marker (≤300-char budget),
  and an under-specified Task that later reveals compound
  invariants ESCALATES to a heavier tier, never silently proceeds. Full tier
  definitions: `.claude/agents/references/shared-discipline.md` §Spec-chain
  right-sizing and §Spec-tier budget.
- **Implementation ({N.2-5+})** — one Executor per subtask. Parallel when groups touch disjoint file sets;
  sequential when they share files / schema / produced inputs.
- **Closing** — Executor `code-simplification` pass, then Checker
  `quality-review` pass, then Orchestrator gates Task → `done` only after
  Curator triage complete and roadmap/backlog implications recorded.

**Task-list ingress:** SLICE READS ONLY — `bun scripts/ledger-cli.ts show task <id>`
/ `get task <id> <field>` / `get task <id>.<subId>` (single subtask) (ledgers live
in the docs-site; the CLI resolves the dir). A bare `show` is size-shaped to ≤48KB
and stubs subtask journals on large tasks — pass `--full` for the verbatim record,
or read a journal thread via `journal <id>.<subId>` when building a dispatch brief.
Never Read/`JSON.parse` the ledger JSONs wholesale — task-list.json is multi-MB. Programmatic full-list validation (rare) goes through
`parseTaskListWithWarnings` from `lib/validation/task-list-schema.ts`.

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

**Pre-integration preflight.** Before any
cherry-pick / merge batch:

1. **Stop competing watchers** — kill or pause background git-watchers
   (`watch-fleet.sh`, inline `git status` loops) for the duration of the
   integration; concurrent watchers recreate `.git/index.lock` mid-cherry-pick.
2. **Confirm CWD is the canonical checkout** (`git rev-parse --show-toplevel`),
   not a worktree — completing worktree agents can drag the session CWD.
3. **Check for concurrent sessions on the branch** (`git log origin/<branch>..HEAD`
   + recent reflog) before assuming local state is authoritative.

Resume watchers only after the final cherry-pick of the batch lands.

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
`triage-finding` then writes to roadmap / backlog / subtask / **decision-register**
via `update-roadmap-backlog` (the register write routes back through the Orchestrator —
see Decision-register wiring).

**Active-task-first (DR-021).** Out-of-scope for the current Subtask does NOT default to
backlog: a finding inside ANY active Task ID-N's scope routes to THAT task — as an
add-subtask or a `details` journal append, even when the work is next-session. The
backlog receives a finding only when no active task owns it; settled cross-cutting
rulings route to the decision register. The curator returns the owning-task intent; the
Orchestrator applies it via `ledger-cli.ts` on MAIN.

For the full Checker JSON output schema, verdict mapping, the three fix-flows, and Curator routing detail, see [references/checker-output-schema.md](references/checker-output-schema.md).

---

## Decision-register wiring

The decision register (`${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/decision-register.md`,
`DR-NNN`) is the durable, read-at-start store of settled cross-cutting rulings and
won't-fixes. It binds the Orchestrator at three moments:

- **Composing briefs.** Surface the relevant in-force (`accepted`) DRs in a Planner /
  Executor brief's Context section so the worker does not re-propose or re-implement a
  settled ruling — cite `DR-NNN`, don't restate the ruling.
- **Writing rulings.** A `DR-NNN` entry is written ONLY on the MAIN checkout — never in a
  worker branch (mirrors the ledger-write rule). Workers (Planner, Executor, Checker,
  Curator) return **DR-intents**; the Orchestrator allocates the `DR-NNN` id and appends
  the entry on `main` (or routes it to `handoff` for session-close write). An in-branch
  register edit bypasses id-allocation exactly as an in-branch ledger write does.
- **Disposing findings.** `DR` is the 5th finding disposition (beside subtask / roadmap /
  backlog / no-action): a finding that is a settled won't-fix ruling routes to the
  `workflow-curator`, which returns a DR-intent for the Orchestrator to write. See Finding
  routing.
- **Superseding a ruling → downstream doc drift.** When a new `DR-NNN` supersedes an
  existing one — or a Task/spec state that downstream docs assert changes — the docs that
  cited the old state go stale silently. Run the docs-site `sync-ledger-context` skill (docs
  opt in via a `kh_ledger_sources` frontmatter key) so those docs get an append-only
  *Ledger drift* stamp; if it can't run now, flag it in the handoff.

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

Task-specific skills are added on demand — consult `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/skill-routing-map.md` to look up
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

Per-role obligations are canonical in `.claude/agents/references/shared-discipline.md`
§Code-intelligence discipline. Binding summary per role:

- **Orchestrator (this skill)** — consult `gitnexus_query` when composing a Planner
  brief (findings land in the spec's Context / Problem section); `gitnexus_context` on
  key symbols when dispatch scope is ambiguous; cite `ast-dataflow` queries where
  call-chain precision is needed; consult `ccc` for semantic search when gitnexus /
  ast-dataflow have not surfaced the relevant symbols.
- **Planner** — `gitnexus_query` on domain vocabulary + `gitnexus_context` on mandated
  symbols before authoring; cite outputs in the spec.
- **Executor** — pre-edit `gitnexus_impact` (journal the verdict; HIGH/CRITICAL →
  escalate); pre-commit `gitnexus_detect_changes` (boundary containment).
- **Checker** — `gitnexus_detect_changes` on the Executor's commit; a missing
  `gitnexus_impact` journal verdict → `scope-containment: FAIL`.
- **Curator** — caller-count pre-grep (`gitnexus_context` + `ast-dataflow callers`;
  ≥10 callers / ≥3 modules → roadmap, fewer → backlog).

See `.gitnexus/CLAUDE.md` "Always Do" for canonical call patterns,
`.ast-dataflow/CLAUDE.md` for the 12 queries and 9 cross-tool patterns, and the `ccc`
skill body at `~/.agents/skills/ccc/SKILL.md` for `ccc search` / `describe` / `guide`.

<!-- code-intel:baseline-end -->

### Orchestrator Planner-brief block

<!-- code-intel:planner-block-start -->

When composing a Planner dispatch brief, include the following code-intelligence
orientation in the brief's "Context" or "Problem" section. The Planner must have this
grounding before writing the spec:

> **Code-intelligence orientation for this Planner brief:** Before writing PRODUCT.md or
> TECH.md, run `gitnexus_query({query: '<domain vocabulary from the spec title>'})` and
> `gitnexus_context({name: '<symbol>'})` for each symbol the spec mandates be modified,
> and cite the outputs explicitly — not paraphrased — in the spec's Context / Problem
> section so the Checker can verify the orientation step was completed (greenfield
> disclaimer only after the `ccc search` fallback also returns nothing). Full steps:
> `.claude/agents/references/shared-discipline.md` §Code-intelligence discipline.

<!-- code-intel:planner-block-end -->

### Orchestrator Executor-brief block

<!-- code-intel:executor-block-start -->

When composing an Executor dispatch brief, include the following code-intelligence
discipline in the brief's "Operating instructions" section. The Executor must follow
this discipline on every code-touching Subtask:

> **Code-intelligence discipline for this Executor brief:** Pre-edit, run
> `gitnexus_impact({target: '<symbolName>', direction: 'upstream'})` for each symbol you
> will modify and journal the verdict level, caller count, and top-3 affected execution
> flows — **if the verdict is HIGH or CRITICAL, STOP and escalate to the Orchestrator**
> before editing. Pre-commit, run `gitnexus_detect_changes()` and verify the affected
> symbol set is contained within this Subtask's file-ownership boundary (outside the
> boundary → STOP and escalate; the Checker FAILs the scope-containment audit). Full
> discipline incl. worktree-dispatch caveats (`gitnexus_detect_changes` is unrunnable in
> agent worktrees — use `git diff --name-only` fallback; pytest from the worktree CWD):
> `.claude/agents/references/shared-discipline.md` §Code-intelligence discipline.

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
- `.json` (ledger files in the docs-site `src/content/docs/ledgers/`) — workflow ledger files
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
appends, Subtask additions, and Task opens. All writes route through the
`bun scripts/ledger-cli.ts` façade — never raw `Edit` on the JSON ledgers. The CLI is the
**operator surface**; the **enforcement point** (serialisation, record-set + budget gates,
mirror regen) lives in the task-view patch-server substrate. Per-field discipline —
**Canonical reference:** `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/task-list-discipline.md`

**Ledger writes are MAIN-checkout-only — never in a worker branch.** This section
is the **canonical home** for the clash-free ledger-write protocol; the
`session-driver-cmux` and `task-executor` worker-side notes cross-reference it
rather than restate it. The daemon serialises behind **one mutex per ledger
directory**, so it only de-conflicts writers that all target the *same*
main-checkout ledger directory. Sub-orchestrators and executors dispatched into
their own worktrees (via `session-driver-cmux` or `Agent` `isolation: "worktree"`)
MUST NOT mutate or commit the ledger JSONs or their `ledgers/{tasks,backlog}/*.md`
mirrors (docs-site) in their branch — an in-branch `chore(ledger)` commit bypasses the mutex
entirely. Workers **return ledger-write intents** (flip {N.M} done with journal X,
create backlog item Y); **the Orchestrator applies every returned intent via
`ledger-cli.ts` on the MAIN checkout** — id allocation for creates happens here,
under the mutex, never in a worker.

| Field | Shape | Load-bearing for |
|---|---|---|
| `last_updated` (roadmap file-level) | Single-line `ca-{track}-S{N} {wave} close-out — {short marker}` | Freshness guard on roadmap only. |
| Subtask `details` `<info added on …>` blocks | Multi-line narrative permitted; structured journal blocks | Per-Subtask traceability. THE canonical home for session-by-session narrative (commits, test counts, OQ ratifications, Checker verdicts, Curator decisions). |
| Task `description` | One paragraph: compact what+why, ≤1500 chars; rationale → `docs/` + `cross_doc_links` pointer, not inlined; updated only on scope amendment | Cross-doc cross-reference target. NOT a journal. |
| Subtask `description` | One-sentence summary, ≤250 chars; not a copy of `details` | Subtask scan label. |
| Task `status_note` | Short rationale for current status (`blocked: waiting on X`); ≤300 chars | Status-line context only. Bump on status flip. |
| `testStrategy` (Subtask) | One-line acceptance criterion the Checker verifies against | Checker contract. |
| `cross_doc_links` | Repo-relative path + anchor + raw text per `DocLinkSchema` | Doc-graph traversal. |
| Commit messages | Body + bullets per `commit-commands` convention | Per-commit immutable audit. |
| Continuation prompts (`${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/`) | Multi-section session handoff | Session-to-session context transfer. |
| Mempalace diary (`mempalace_diary_write`) | AAAK pipe-delimited per-WP segments | Cross-session recall. |

**Budget gate is HARD for Subtask `description` (≤250) and `testStrategy` (≤300):** Records MUST be authored within budget on the first pass; relocate any overflow into the unbudgeted `details` field.

---

## Backlog pickup → Promote

When the Orchestrator or Liam selects a backlog item from
the backlog ledger (`bun scripts/ledger-cli.ts show backlog <id>`) to implement, the
**first action is the promote CLI**:

```bash
bun scripts/ledger-cli.ts promote <backlogId> <taskJson>
# Optional: bind the new Task to a roadmap theme.
bun scripts/ledger-cli.ts promote <backlogId> <taskJson> \
  --capability-theme <themeId>
```

A new top-level Task carries two orthogonal strategic groupings — its roadmap theme
(`--capability-theme` above) and its cross-Task **umbrella**. Add it to the umbrella via
`bun scripts/ledger-cli.ts update-umbrella <umbrellaId> --add-tasks <newTaskId>` (see
`update-roadmap-backlog` Step 6) so task pickup surfaces the strategic grouping, not just the
theme.

**Orchestrator-direct:** The curator handles triage and create; the
Orchestrator handles the backlog → task-list lifecycle transition via the
CLI above.

### In-flight Subtask carryover (session-close)

In-flight Subtasks survive session boundaries: a started-but-incomplete Subtask
remains an `in_progress` / `pending` Subtask record across session close — it is
NOT demoted to the backlog. Session-close triage must not use the backlog as a
parking lot for work already started; the backlog is for not-yet-committed ideas
only (consistent with the committed-work rule already in `triage-finding` — *have
we committed to doing this?* Yes → Task List; not yet → Backlog).

---

## Escalation

If you are a sub-orchestrator and you hit an Open Question that cannot be resolved in-scope, you must NOT silently proceed or block indefinitely. Use the OQ-escalation channel: `.claude/skills/session-driver-cmux/oq-brief-fragment.md`

The OQ protocol is implemented as a durable file-per-record mailbox under each worker's
`.claude/cmux-events/<sid>/oq/` directory. The helper scripts sit in
`.claude/skills/session-driver-cmux/scripts/`, beside the five dispatch scripts:

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