---
name: session-driver-cmux
description: Dispatches sub-Claude workers in isolated cmux terminals + git worktrees. Use when the orchestrator needs to fan out work to one or more independent Claude Code sessions, monitor their lifecycle through emitted events, optionally gate every tool call, and collect their output. Trigger phrases include "spawn worker", "fan out", "dispatch sub-Claude", "session-driver", "orchestrator-of-orchestrators".
allowed-tools: Bash, Read
---

# session-driver-cmux

Dispatch primitive that lets a Claude Code session act as an
"orchestrator-of-orchestrators": spawn sub-Claude workers, each pinned to its
own cmux terminal and git worktree, then converse with them programmatically.

Wraps every worker in its own git worktree, and adds a `wait-for-fleet` primitive for multi-worker
coordination.

---

## When to invoke

Use this skill when the orchestrator session needs to:

- Launch one or more independent Claude Code workers in parallel, each in its
  own terminal and worktree, without blocking on interactive permission prompts.
- Send prompts to workers and wait for their responses programmatically.
- Inspect or gate every tool call a worker makes (PreToolUse approval window).
- Coordinate a fleet: wait for any-of or all-of a worker set to finish.
- Hand a running worker off to a human operator.

**Worker roles — leaf executor OR sub-orchestrator.** A cmux worker is a full
Claude session and can play either role:

- **Leaf executor.** Worker receives a narrow brief and produces one commit
  (e.g. implement one ID-N.M Subtask). This is the historical default.
- **Sub-orchestrator ("orchestrator-of-orchestrators").** Worker is briefed to
  load the `workflow-orchestration` skill and drive a complete ID-N Task
  lifecycle (planning chain `{N.1–N.4}` → impl wave → checker → curator). The
  parent session dispatches one cmux sub-orchestrator per ID-N Task; each
  sub-orchestrator manages its own internal dispatch tree (including, if it
  wishes, further cmux workers of its own). The parent then cherry-picks /
  merges each sub-orchestrator's commits back onto the track branch.

The skill itself is identical in both cases — only the brief differs.

**Do not** use this for sub-agents already covered by Claude Code's built-in
`Agent` tool or `isolation: "worktree"` — those are simpler and don't need a
full Claude session per worker. Reach for cmux workers when you need:
durable, attachable terminals; per-worker tool gating; or workers that outlive
the orchestrator turn.

---

## Prerequisites

- **cmux** CLI installed and a cmux daemon running. The launch script will
  refuse to run if `cmux list-workspaces` errors.
- **jq** on `PATH` (event serialisation).
- **claude** CLI on `PATH` (the worker process).
- **Project worktree writable**: the skill writes events to
  `<project-root>/.claude/cmux-events/<worker-id>/events.jsonl` and creates
  worktrees under `<project-root>/.claude/worktrees/`. Both paths **must** be
  gitignored — `launch-worker.sh` enforces this with a `git check-ignore`
  safety gate (matches the contract used by the `using-git-worktrees` skill).
- **(Optional)** Upstream `read-turn.sh` for collecting a full worker turn as
  markdown — see "Reading worker output" below. The other upstream scripts
  (`read-events.sh`, `wait-for-event.sh`, controller-side `approve-tool.sh`)
  read the wrong path under KH layout and are **not** usable here.

---

## Setup

All five scripts live next to this SKILL.md. The orchestrator should set:

```bash
SD_SCRIPTS=".claude/skills/session-driver-cmux/scripts"
```

Use relative paths throughout (KH gotcha: "Sub-agent instructions must always
use relative paths").

---

## Lifecycle

```
launch-worker  →  send-prompt / converse  →  wait-for-fleet (optional)  →  stop-worker
```

### 1. Launch a worker

```bash
RESULT=$("$SD_SCRIPTS/launch-worker.sh" my-worker .)
SESSION_ID=$(echo "$RESULT" | jq -r '.session_id')
WORKTREE_PATH=$(echo "$RESULT" | jq -r '.worktree_path')
EVENTS_FILE=$(echo "$RESULT" | jq -r '.events_file')
```

The script:

1. Validates `cmux` is reachable.
2. Generates a `SESSION_ID` (uuid).
3. Creates a git worktree at `.claude/worktrees/<worker-name>/` branched from
   the current `HEAD` (or from `--branch <ref>` if passed). The branch name is
   `cmux-worker-<worker-name>-<short-sha>`.
4. Creates a new cmux workspace, renames it to `<worker-name>`.
5. Writes a `.meta` file to
   `.claude/cmux-events/<SESSION_ID>/meta.json` so the hooks can recognise this
   as a managed worker (analogous to upstream `/tmp/claude-workers/<id>.meta`).
6. Launches `claude --session-id <id> --plugin-dir <local skill dir>
   --dangerously-skip-permissions` inside the workspace, with
   `KH_CMUX_EVENTS_DIR` exported so the hooks (loaded from this skill's
   `hooks/` directory) emit into the correct directory.
7. Waits up to 30s for the `session_start` event by polling the KH events
   file directly (upstream `wait-for-event.sh` polls the wrong path).

Returns JSON: `{session_id, worker_name, cmux_workspace, worktree_path,
events_file, branch}`.

### 2. Converse (preferred)

```bash
RESPONSE=$("$SD_SCRIPTS/converse.sh" my-worker "$SESSION_ID" "Add the auth helper to lib/auth.ts" 300)
```

`converse.sh` sends the prompt, blocks until the worker emits a `stop` event
(or the timeout — default 120s), then prints the worker's final text response.
Tracks `--after-line` automatically so multi-turn conversations work without
extra bookkeeping.

For finer control, call `send-prompt.sh` directly and poll
`<events-dir>/<session-id>/events.jsonl` for the events you care about (see
"Events emitted" below for the line shape). A KH-local `wait-for-event.sh`
is a carry-forward (see "Known limitations").

### 3. Wait for a fleet

For multi-worker dispatch:

```bash
"$SD_SCRIPTS/wait-for-fleet.sh" --mode all --timeout 600 \
  "$SID1" "$SID2" "$SID3"
```

- `--mode all` blocks until every worker emits `stop`.
- `--mode any` returns as soon as one does.
- Exit 0 on success, 1 on timeout. Prints the matching session IDs on stdout.

`wait-for-fleet.sh` polls the per-worker events files directly (it does not
depend on upstream `wait-for-event.sh`).

### 4. Stop a worker

```bash
"$SD_SCRIPTS/stop-worker.sh" my-worker "$SESSION_ID"
```

The script:

1. Sends `/exit` to the cmux workspace.
2. Waits up to 10s for `session_end`.
3. Closes the cmux workspace.
4. **Runs `git status` inside the worker's worktree** before removing it. If
   the worktree has uncommitted changes, the script aborts with an error and
   leaves the worktree intact — manual intervention required. (See CLAUDE.md
   gotcha: "Sub-agents can blow their token budget before final `git
   commit`".)
5. Removes the worktree (`git worktree remove`) and event files.

Pass `--force` to remove a dirty worktree anyway (data loss risk; only use
when you have already inspected and don't need the changes).

---

## Events emitted

The local hooks (loaded into the worker via `--plugin-dir`) emit JSONL events
to `.claude/cmux-events/<SESSION_ID>/events.jsonl`:

| Event                | Source hook        | Extra fields           |
| -------------------- | ------------------ | ---------------------- |
| `session_start`      | `SessionStart`     | `cwd`                  |
| `user_prompt_submit` | `UserPromptSubmit` | —                      |
| `pre_tool_use`       | `PreToolUse`       | `tool`, `tool_input`   |
| `stop`               | `Stop`             | —                      |
| `session_end`        | `SessionEnd`       | —                      |

The `PreToolUse` hook gates tool calls only when the worker is launched
`--gated` (`CLAUDE_SESSION_DRIVER_APPROVAL_TIMEOUT > 0`): it then blocks the
worker for up to that many seconds waiting for the orchestrator to write a
decision to `<events-dir>/<SESSION_ID>/tool-decision`, auto-approving if none
arrives. The **default is ungated** (`APPROVAL_TIMEOUT=0`): the hook still
emits the `pre_tool_use` event for observability, then allows immediately —
no per-tool-call poll tax and no background auto-approver needed. An explicit
`CLAUDE_SESSION_DRIVER_APPROVAL_TIMEOUT` env var always wins over the
`--gated` default.

To actively gate tool calls, tail `<events-dir>/<SESSION_ID>/events.jsonl`
for `pre_tool_use` events and write `allow` or `deny` to the
`tool-decision` file directly. A controller-side `approve-tool.sh` helper is
a carry-forward (see "Known limitations") — the upstream version reads
`/tmp/claude-workers/<id>.tool-pending`, the wrong path under KH layout.

---

## Cross-worktree cherry-pick aliasing (S274 — OQ-S274-1)

When integrating executor commits from a sub-orchestrator's worktree back to
the sub-O branch (or from a sub-O branch back to main), `git cherry-pick
<SHA>` can **silently no-op** with `"nothing to commit; branch X"` if the
shell's CWD has drifted into a worktree where the SHA already lives at HEAD.
Observed S274 in T-48 integration (cherry-pick of 48.12 from
`worktree-agent-a07722bc0bec3e949` onto `cmux-worker-subo-id-48-f63aba0a`).
Probabilistic — same operation succeeded earlier the same session.

**Workaround — use `format-patch` + `am`:**

```bash
# Instead of `git cherry-pick <executor-sha>`
git -C <sub-o-or-target-worktree> format-patch -1 <executor-sha> --stdout | \
  git -C <sub-o-or-target-worktree> am
```

`format-patch` + `am` is CWD-immune: the source SHA is resolved against the
git object store (shared across worktrees) and the patch is applied to the
target worktree's HEAD. The cherry-pick alias bypass does not apply.

**When to reach for it:** any integration step where the source SHA may
already live at HEAD in a sibling worktree (executor → sub-O, sub-O → main,
or any agent-isolation worktree integration). The cost is one extra pipe; the
benefit is deterministic apply.

## Worktree isolation

The skill creates one worktree per worker under `.claude/worktrees/`. All the
KH "Worktree isolation rules" from CLAUDE.md apply unchanged:

- Two sessions on the same working tree destroy each other's files — workers
  always get their own worktree (this skill enforces it).
- Cherry-pick worker branches back to the parent branch sequentially. Merging
  parallel branches in random order produces stale state.
- After merging a worker branch, `git status` on the parent before continuing
  — merges leak files.
- Worker workspaces start at the orchestrator's HEAD; if the orchestrator
  advances before the worker finishes, the worker is implicitly stale (this
  is normal — the orchestrator decides whether to rebase or accept the
  divergence at merge time).

---

## Reference: script summary

| Script               | Usage                                                                                            | Description                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `launch-worker.sh`   | `<worker-name> <base-dir> [--branch <ref>] [--brief <file>] [extra-claude-args...]`              | Create worktree + cmux workspace, launch claude              |
| `send-prompt.sh`     | `<worker-name> <prompt-text>`                                                                    | Send text to a worker (no wait)                              |
| `converse.sh`        | `<worker-name> <session-id> <prompt> [timeout=120]`                                              | send-prompt + wait-for-stop + return last assistant text     |
| `wait-for-fleet.sh`  | `--mode any\|all [--timeout S] <session-id>...`                                                  | Wait for any-of or all-of a set of workers to emit `stop`    |
| `stop-worker.sh`     | `<worker-name> <session-id> [--force] [--delete-branch]`                                         | /exit, close workspace, verify clean tree, remove worktree; optionally delete worker branch |

**`--brief <file>`**: copies the file into the worker worktree as
`.cmux-brief.md` and auto-sends "Read .cmux-brief.md before any work." after
`session_start`. Mirrors the OQ-escalation channel shape: a known on-disk
file plus a structured pointer prompt.

**`--delete-branch`**: after worktree removal, deletes the worker branch
(`cmux-worker-<name>-<sha>`). Falls back to `git worktree list` lookup when
the meta file is missing (post-failure re-run scenario). Default OFF — the
parent orchestrator usually needs the branch alive long enough to
cherry-pick / merge. Pass once cherry-pick / merge is confirmed.

**Order of operations (post-FX-1 ratification, S62C ID-28.1)**:
`stop-worker.sh` runs the dirty-tree safety check BEFORE closing the cmux
workspace. Exit-2 (dirty tree, no `--force`) therefore leaves the cmux
workspace alive — operator can re-attach to inspect, then either commit the
work or re-run with `--force`. The dirty-tree check excludes
`.cmux-brief.md` (script-managed artefact placed by `--brief`).

**`.worktreeinclude` honour**: if `<project-root>/.worktreeinclude` exists,
`launch-worker.sh` reads it as a list of literal file paths (one per line,
`#` comments skipped) and copies each existing source from project root into
the new worktree. Plain paths only — no glob expansion. Canonical case:
`.env.local`.

### Reading worker output

`read-turn.sh` from the upstream session-driver plugin is the one upstream
script that works under KH layout (it honours the events-dir env var). If you
need to collect a full markdown turn:

```bash
KH_CMUX_EVENTS_DIR=".claude/cmux-events" \
  bash ~/.claude/plugins/cache/superpowers-marketplace/claude-session-driver/1.0.1/scripts/read-turn.sh "$SESSION_ID"
```

Or read the events JSONL directly:

```bash
jq -c '.' .claude/cmux-events/"$SESSION_ID"/events.jsonl
```

### Known limitations

The following helper scripts are **carry-forward** items — useful but not yet
implemented under KH layout:

| Helper                       | Status | Reason |
|------------------------------|--------|--------|
| `wait-for-event.sh`          | Missing locally | Upstream version polls `/tmp/claude-workers/<id>.events.jsonl`. KH path is `<project-root>/.claude/cmux-events/<id>/events.jsonl`. Workaround: poll the JSONL file directly. |
| `read-events.sh` (orchestrator-side) | Missing locally | Same wrong-path issue. Workaround: `jq -c '.' <events-file>`. |
| `approve-tool.sh` (orchestrator-side) | Missing locally | Upstream version writes to `/tmp/claude-workers/<id>.tool-decision`. Workaround: `echo allow > <events-dir>/<id>/tool-decision` (or `deny`). |
| `symlinkDirectories` not applied | Workers get full fresh checkouts | Anthropic's `worktree.symlinkDirectories` setting symlinks dirs like `node_modules`, `.venv`, `.bin` into Anthropic-managed worktrees. cmux workers don't get these. Pro: clean `git status` (no `??` artefacts blocking orphan-sweep). Con: more disk + workers needing JS/Python tooling must `bun install` / `pip install -r requirements.txt` per worker. Relevant when dispatching impl workers that compile or run tests. |

The first three are small re-implementations of upstream scripts against the
KH path layout — author when the workflow actually needs them. The last is
an open design choice (symlink vs full checkout) not yet acted on.

---

## Common patterns

### Fan-out: parallel research workers

```bash
SD_SCRIPTS=".claude/skills/session-driver-cmux/scripts"

# Launch three workers from the current branch
R1=$("$SD_SCRIPTS/launch-worker.sh" worker-api .)
R2=$("$SD_SCRIPTS/launch-worker.sh" worker-ui .)
R3=$("$SD_SCRIPTS/launch-worker.sh" worker-tests .)

S1=$(echo "$R1" | jq -r '.session_id')
S2=$(echo "$R2" | jq -r '.session_id')
S3=$(echo "$R3" | jq -r '.session_id')

# Dispatch tasks (non-blocking)
"$SD_SCRIPTS/send-prompt.sh" worker-api "Map the auth route handlers in app/api/auth"
"$SD_SCRIPTS/send-prompt.sh" worker-ui  "Inventory the auth components in components/auth"
"$SD_SCRIPTS/send-prompt.sh" worker-tests "List the existing auth test files"

# Wait for the whole fleet
"$SD_SCRIPTS/wait-for-fleet.sh" --mode all --timeout 600 "$S1" "$S2" "$S3"

# Collect (use upstream read-turn.sh for full markdown)
KH_CMUX_EVENTS_DIR=".claude/cmux-events" \
  bash ~/.claude/plugins/cache/superpowers-marketplace/claude-session-driver/1.0.1/scripts/read-turn.sh "$S1"

# Tear down
"$SD_SCRIPTS/stop-worker.sh" worker-api "$S1"
"$SD_SCRIPTS/stop-worker.sh" worker-ui  "$S2"
"$SD_SCRIPTS/stop-worker.sh" worker-tests "$S3"
```

### Mid-session interaction: monitor `stop`, not `session_end`

For long-running sub-orchestrators where the parent may want to converse mid-session
(send-prompt for follow-ups, OQ ratifications, scope amendments) before final teardown:

- **`stop` event** fires after EVERY assistant turn-end. Use this as the pause signal.
- **`session_end` event** fires ONLY when the worker hits `/exit`. Reserve this for
  definitive-teardown polling.

Anti-pattern (S62E observed): orchestrator-side custom watcher polling `grep -c
'"event":"session_end"'`. The watcher never fired despite the worker emitting many
`stop` events, because `session_end` requires `/exit` — workers that pause naturally
between turns don't emit it. Result: orchestrator missed every mid-session interaction
opportunity until the worker explicitly /exit'd.

Canonical loop using `wait-for-fleet.sh` (which already polls `stop` correctly):

```bash
SD_SCRIPTS=".claude/skills/session-driver-cmux/scripts"
SID="<session-id>"
LAST_STOP=0

while true; do
  # Block until worker emits `stop` (or timeout). Returns 0 if stop fired.
  "$SD_SCRIPTS/wait-for-fleet.sh" --mode all --timeout 1800 "$SID" || break

  # Worker paused. Inspect events since LAST_STOP to decide next action.
  NEW_LAST=$(jq -c 'select(.event=="stop")' .claude/cmux-events/$SID/events.jsonl | wc -l)

  # Decision: more work to send?
  if <orchestrator-decides-more-work>; then
    "$SD_SCRIPTS/send-prompt.sh" worker-name "Follow-up prompt..."
    LAST_STOP=$NEW_LAST
    continue
  fi

  # Otherwise teardown
  "$SD_SCRIPTS/stop-worker.sh" worker-name "$SID" --delete-branch
  break
done
```

Use this pattern when the brief explicitly allows mid-session OQ-escalation or when the
parent expects to ratify partial progress before letting the worker continue. For pure
fire-and-forget workers (single Subtask, no escalation expected), poll `session_end`
directly via the worker's own `/exit` at end of brief — simpler.

### Race: first-to-finish wins

```bash
R1=$("$SD_SCRIPTS/launch-worker.sh" candidate-a .)
R2=$("$SD_SCRIPTS/launch-worker.sh" candidate-b .)
S1=$(echo "$R1" | jq -r '.session_id'); S2=$(echo "$R2" | jq -r '.session_id')

"$SD_SCRIPTS/send-prompt.sh" candidate-a "Solve X using approach 1"
"$SD_SCRIPTS/send-prompt.sh" candidate-b "Solve X using approach 2"

WINNER=$("$SD_SCRIPTS/wait-for-fleet.sh" --mode any --timeout 600 "$S1" "$S2")

# Stop the losers
for s in "$S1" "$S2"; do
  [ "$s" != "$WINNER" ] && "$SD_SCRIPTS/stop-worker.sh" "$(jq -r ".session_id // empty" ".claude/cmux-events/$s/meta.json")" "$s" --force
done
```

### Orchestrator-of-orchestrators: parallel Task lifecycles

Dispatch one sub-orchestrator per ID-N Task. Each worker loads
`workflow-orchestration` and drives its own `{N.1–N.4}` planning chain plus
impl wave; the parent waits on the whole fleet, then cherry-picks each
sub-orchestrator's commits back onto the track branch.

```bash
SD_SCRIPTS=".claude/skills/session-driver-cmux/scripts"

R1=$("$SD_SCRIPTS/launch-worker.sh" subo-id-23 .)
R2=$("$SD_SCRIPTS/launch-worker.sh" subo-id-24 .)
R3=$("$SD_SCRIPTS/launch-worker.sh" subo-id-25 .)
S1=$(echo "$R1" | jq -r '.session_id')
S2=$(echo "$R2" | jq -r '.session_id')
S3=$(echo "$R3" | jq -r '.session_id')

# Each brief MUST carry the explicit dispatch cadence — a bare "load the skill"
# made S267 workers act as leaf executors (direct authoring, no Checker):
# "Load workflow-orchestration. You are a SUB-ORCHESTRATOR, not a leaf worker:
# for every Subtask DISPATCH a task-planner and/or task-executor via the Agent
# tool, then GATE each with a task-checker (FAIL→fix→PASS) BEFORE committing.
# Do NOT author specs/plans or edit code/docs directly as your own deliverable —
# this holds for doc-only / spec-only / ASSESS-only Tasks too (spec & plan
# authoring is the Planner's role). Commit on your worker branch; surface Open
# Questions via the OQ-escalation channel (see Escalation below)."
"$SD_SCRIPTS/send-prompt.sh" subo-id-23 "$(cat briefs/id-23.md)"
"$SD_SCRIPTS/send-prompt.sh" subo-id-24 "$(cat briefs/id-24.md)"
"$SD_SCRIPTS/send-prompt.sh" subo-id-25 "$(cat briefs/id-25.md)"

# Block until every sub-orchestrator has completed its Task lifecycle
"$SD_SCRIPTS/wait-for-fleet.sh" --mode all --timeout 7200 "$S1" "$S2" "$S3"

# Parent cherry-picks worker branches onto the track branch (sequential, per
# KH worktree-isolation rules), then stops each worker. Future Path A: merge.
for name in subo-id-23 subo-id-24 subo-id-25; do
  git cherry-pick "cmux-worker-${name}-*"  # resolve glob to actual SHA
done

"$SD_SCRIPTS/stop-worker.sh" subo-id-23 "$S1"
"$SD_SCRIPTS/stop-worker.sh" subo-id-24 "$S2"
"$SD_SCRIPTS/stop-worker.sh" subo-id-25 "$S3"
```

Caveats: each sub-orchestrator must be briefed with relative paths only
(CLAUDE.md primer-effect gotcha); branch cleanup is manual until the
`stop-worker.sh` gap (see Known limitations) is closed.

### Final-report convention (sub-orchestrator stdout vs events_dir file)

**Problem (S62C §7.2 obs 3 carry-forward).** When the parent orchestrator
reads a sub-orchestrator's final report via `cmux read-screen --workspace
<ref> --scrollback`, the captured output contains raw ANSI escape sequences
from the Claude TUI rendering (Bash tool-call boxes, thinking dots, etc.).
A structured YAML/JSON report embedded in that stream is parseable but
copy-paste fragile and brittle to grep over.

**Workaround — sub-o brief convention.** Brief the sub-orchestrator to
EMIT its final report to a structured file inside its events directory
*in addition to* (not instead of) the stdout summary:

```
Before /exit, write your final report to `<events_dir>/final_report.yaml`
(or `.json`). Schema: structured key/value with sections {summary, commits,
dispositions, OQs_for_parent, next_session_handoff}. Keep stdout summary
too (for human glance) but the YAML/JSON file is the canonical machine-read
surface.
```

In the brief, `<events_dir>` resolves to the worker's per-SID directory
at `.claude/cmux-events/<SID>/` (also discoverable from the launch script's
returned `events_dir` field). The parent then reads the report via
ordinary `cat` / `jq` / `yq` rather than scraping `cmux read-screen` output:

```bash
EVENTS_DIR=$(jq -r '.events_dir' <(echo "$R1"))
cat "$EVENTS_DIR/final_report.yaml"            # clean machine read
yq '.commits[]' "$EVENTS_DIR/final_report.yaml"
```

Path (b) workaround; path (a) (proper ANSI-strip at the `cmux read-screen`
layer) is tracked as upstream cmux scope and not blocking here. Adopted
S62E sub-o 2 triage — see `docs/research/cmux-hardening-triage-S62E.md` §4.

### Handing off to a human

If the user wants to take over a running worker:

> Worker `<name>` is in cmux workspace `<ref>` (worktree
> `.claude/worktrees/<name>/`). Attach with `cmux attach --workspace <ref>`.
> Detach with the configured cmux detach key to return control to the
> orchestrator. Do NOT stop the worker on the orchestrator side while a human
> is attached.

---

## Important notes

- **One orchestrator per worker.** Never have two orchestrator sessions
  sending prompts to the same cmux workspace — outputs interleave.
- **Clean up on failure.** If a script fails mid-flight, the worktree and
  events-dir may be partially populated. The recovery sequence:
  ```bash
  git worktree remove --force .claude/worktrees/<worker-name>
  rm -rf .claude/cmux-events/<session-id>
  cmux close-workspace --workspace <ws-ref>
  ```
- **Event files are append-only JSONL.** Treat each line as a self-contained
  JSON object.
- **Workers are full Claude sessions.** No shared state with the orchestrator
  except via files on disk and the event stream. Pass data through the
  worker's worktree (committed) or via `/tmp/...` (uncommitted scratch).
- **Phase B (interactive) verifies end-to-end.** This SKILL.md and the scripts
  are the dispatch contract — empirical validation against a live cmux
  daemon happens in a follow-up interactive session.

---

## Escalation

Sub-orchestrators (and leaf workers) that hit an Open Question they cannot
resolve in-scope must NOT silently proceed or block indefinitely. The formal
channel for surfacing Open Questions to the parent session is specified in
`docs/specs/oq-escalation/PRODUCT.md` (authored in parallel with this revision
— see that spec for the OQ packet shape, the parent's response contract, and
the per-track ledger location). The session-driver-cmux skill does not
re-specify the protocol; it is the dispatch primitive. Sub-orchestrators load
the OQ-escalation skill alongside `workflow-orchestration` when they need it.
