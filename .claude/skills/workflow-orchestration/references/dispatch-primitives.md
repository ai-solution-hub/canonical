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
  `task-list.json` (slice-read the relevant Task with
  `bun scripts/ledger-cli.ts show task <N>` and pass the Subtask through
  verbatim — its `details` field is the load-bearing dispatch brief).
- **Spec-slice reference** — path + anchor to the section of PRODUCT.md /
  TECH.md the subtask references. The Executor reads only this slice.
- **File-ownership boundaries** — explicit allow-list of files this dispatch
  may touch. Everything else is off-limits.
- **Skills to invoke** — list specific KH skills (e.g.
  `test-driven-development`, `incremental-implementation`).
- **Megafile navigation aid** — if the dispatch touches a file larger than the
  2,000-line Read window (e.g. `scripts/ledger-cli.ts`,
  `scripts/cocoindex_pipeline/flow.py`), include a symbol→line index in the
  brief (`grep -n "def \|class \|function " <file>`) and instruct Grep-first
  navigation. Workers cannot hold such files and otherwise pay a heavy
  `Read@offset` paging tax (S337 dup-read root-cause: ~70% of the corpus
  "duplicated reads" were navigation paging on >2,000-line files). Do NOT pin
  whole-file excerpts for these.
- **Worktree directive** — verification gate as first action (`pwd && git branch --show-current && git fetch origin <track> && git reset --hard origin/<track> && git branch --show-current` — verbatim, no `cd` prefix). Use relative paths throughout. Commit before finishing. **Never `cd` to absolute knowledge-hub paths.**
- **Escalation rule** — if the sub-agent finds unexpected production
  behaviour, STOP and escalate. Do not silently work around (CLAUDE.md
  "Agent escalation rule").

### Friction-guard convention lines (carry into EVERY brief)

The friction register (`knowledge-hub-docs-site/src/content/docs/workflow-evaluation/friction-register.md`)
tracks recurring operational friction across the archived corpus. The following
convention lines are register-mandated brief content — include them verbatim in
every worker / sub-orchestrator dispatch brief:

- **FR-001 (cd-to-repo-root hook-block):** "NEVER prefix a Bash command with
  `cd /Users/.../knowledge-hub` (or any absolute cd into the repo root). You are
  already in your worktree CWD. Use paths relative to CWD, or `git -C <path>`
  flags. A PreToolUse guard hard-blocks `cd <repo-root>` to stop wrong-branch
  commit leakage; the block costs a full retry round-trip."
- **FR-002 (Edit/Write before Read):** "Before any Edit/Write/MultiEdit to a
  file you have not Read this session, Read it first (the harness hard-errors
  'File has not been read yet' otherwise, costing a retry). Batch the Read with
  sibling Reads in the same turn to avoid serial round-trips."
- **FR-004 (`.git/index.lock`):** "If a git command fails with
  `.git/index.lock: File exists`, do NOT blindly `rm` the lock — first confirm
  no sibling git process is running, then `rm -f .git/index.lock` and retry
  once. Prefer per-worktree git roots so the fleet never shares one index."
- **FR-005 (MCP `-32000`):** "An MCP call returning `-32000 Internal tool
  error` is usually transient; retry once. If it persists for a given MCP tool,
  fall back to the non-MCP equivalent (e.g. raw CLI) and note the tool name for
  the friction register."
- **GitHub ops (ID-92.12):** "Use `gh-axi` for every GitHub operation — it
  replaces raw `gh` (NOT git): pre-aggregated CI rollups, structured error
  translation; `gh-axi api` is the raw-API escape hatch. Fall back to raw `gh`
  only for subcommands `gh-axi` does not wrap. Never run `gh-axi setup hooks`."
  (Corpus measurement 2026-06-10: raw `gh` still outnumbered `gh-axi` 126:22 —
  carry this line until the adoption gap closes.)

### Result-size discipline (carry into EVERY brief)

Sub-agents should keep tool-result and return-payload size **bounded** — an
unbounded tool result or inlined artefact body burns the dispatching agent's
context window and can stall the worker on its own output. The discipline is a
**convention, not a programmatic block**: no tooling enforces a hard ceiling, so
the brief-carried convention IS the safeguard. Include these lines verbatim in
every worker / sub-orchestrator dispatch brief:

- **A1.1 (bound the payload):** "Keep every tool-result and return-payload
  bounded. Do not inline a large artefact body into your turn or final report —
  write it to a file and return the PATH, not the full contents."
- **A1.2 (named high-risk tools + at-source mitigation):** the following calls
  routinely emit unbounded output — bound each AT SOURCE, not after the fact:
  - `git diff` / `git show` — run `--stat` first to size the change; scope to
    explicit paths (`-- path/to/file`) rather than dumping the whole diff.
  - `mempalace_search` — pass a query that narrows the result set; do not request
    broad unfiltered sweeps whose body you then discard.
  - `gitnexus detect_changes` — read the summarised verdict, not a full
    per-symbol dump; scope follow-up queries to the affected set.
  - large `grep` — narrow the glob (`--include`, explicit path) and pipe through
    `head` when you only need the first hits, not the whole match set.
- **A1.3 (>64K → file-and-path):** "For any artefact larger than ~64K, write it
  to a file and return the path; never inline a body that size into a tool result
  or final report."
- **A1.6 (convention, not a block):** "This is a convention enforced by your own
  discipline — no PreToolUse guard or harness limit blocks an oversized result.
  Bounding the output is your responsibility on every call."

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
