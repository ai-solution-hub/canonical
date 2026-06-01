---
name: session-driver-cmux
description: Dispatches sub-orchestrators in isolated cmux terminals + git worktrees. Use when the orchestrator-of-orchestrators needs to fan out work to one or more independent Claude Code sessions, monitor their lifecycle through emitted events, and collect their output. Trigger phrases include "session-driver", "orchestrator-of-orchestrators".
allowed-tools: Bash, Read
---

# session-driver-cmux

Dispatch primitive that lets a Claude Code session act as an
"orchestrator-of-orchestrators": spawn sub-orchestrators, each pinned to its
own cmux terminal and git worktree, then converse with them programmatically.

Wraps every worker in its own git worktree, and adds a `wait-for-fleet` primitive for multi-worker
coordination.

---

## When to invoke

Use this skill when the main session needs to launch one or more independent sub-orchestrators in parallel, each in its own terminal and worktree, without blocking on interactive permission prompts.

- **Sub-orchestrator** is briefed to load the `workflow-orchestration` skill and drive a complete ID-N Task lifecycle (planning chain `{N.1–N.4}` → impl wave → checker → curator). The
  parent session dispatches one cmux sub-orchestrator per ID-N Task; each
  sub-orchestrator manages its own internal dispatch tree (including, if it
  wishes, further cmux workers of its own). The parent then cherry-picks /
  merges each sub-orchestrator's commits back onto the track branch.

---

## Prerequisites

- **cmux** CLI installed and a cmux daemon running. Bypass sandbox to ping.
- **jq** on `PATH` (event serialisation).
- **claude** CLI on `PATH` (the worker process).
- **Project worktree writable**: the skill writes events to
  `<project-root>/.claude/cmux-events/<worker-id>/events.jsonl` and creates
  worktrees under `<project-root>/.claude/worktrees/`.

---

## Setup

There are 10 scripts which live next to this SKILL.md. The orchestrator should set:

```bash
SD_SCRIPTS=".claude/skills/session-driver-cmux/scripts"
```

Use relative paths throughout.

The monitoring scripts (`wait-for-fleet.sh`, `converse.sh`, `stop-worker.sh`, `send-prompt.sh`)
resolve the events base from `git rev-parse --git-common-dir` (shared by every
linked worktree) via a `resolve_project_root()` helper, so they read the MAIN
root's `.claude/cmux-events/` regardless of the orchestrator shell's CWD.

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

### 2. Converse

```bash
RESPONSE=$("$SD_SCRIPTS/converse.sh" my-worker "$SESSION_ID" "Add the auth helper to lib/auth.ts" 300)
```

`converse.sh` sends the prompt, blocks until the worker emits a `stop` event
(or the timeout — default 120s), then prints the worker's final text response.
Tracks `--after-line` automatically so multi-turn conversations work without
extra bookkeeping.

For finer control, call `send-prompt.sh` directly and poll
`<events-dir>/<session-id>/events.jsonl` for specific events.

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
   leaves the worktree intact — manual intervention required.
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

---

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
| `watch-fleet.sh`     | `[env: IGNORE SEEN_OQ SEEN_FINAL SEEN_SEND INTERVAL MAX_POLLS QUIET_POLLS]`                      | Smart multi-signal watcher: exits (wakes parent) on any actionable fleet event (session_end / final_report.* / OQ-heading growth / AskUserQuestion stall / stop pause / fleet-quiet). Complements `wait-for-fleet.sh`. |

**`--brief <file>`**: copies the file into the worker worktree as
`.cmux-brief.md` and auto-sends "Read .cmux-brief.md before any work." after
`session_start`.

**`stop-worker.sh`**: runs the dirty-tree safety check BEFORE closing the cmux
workspace. Exit-2 (dirty tree, no `--force`) therefore leaves the cmux
workspace alive — operator can re-attach to inspect, then either commit the
work or re-run with `--force`. The dirty-tree check excludes
`.cmux-brief.md` (script-managed artefact placed by `--brief`).

**`--delete-branch`**: after worktree removal, deletes the worker branch
(`cmux-worker-<name>-<sha>`). Falls back to `git worktree list` lookup when
the meta file is missing (post-failure re-run scenario). Default OFF — the
parent orchestrator usually needs the branch alive long enough to
cherry-pick / merge. Pass once cherry-pick / merge is confirmed.

**`.worktreeinclude` honour**: if `<project-root>/.worktreeinclude` exists,
`launch-worker.sh` reads it as a list of literal file paths (one per line,
`#` comments skipped) and copies each existing source from project root into
the new worktree. Plain paths only — no glob expansion. Canonical case:
`.env.local`.

### Monitoring: `wait-for-fleet.sh` vs `watch-fleet.sh`

Two monitoring primitives:

- `wait-for-fleet.sh` — block-on-`stop` primitive: blocks until any-of / all-of a
  named session set emits `stop`. Use for race / first-to-finish gating.
- `watch-fleet.sh` — smart multi-signal watcher: scans every worker's
  `events.jsonl` + worktree and EXITS (waking the parent) on the FIRST actionable
  signal across the fleet — `session_end`, a `final_report.*` in the events dir,
  a new `## OQ` heading in a worker's root `OQ-pending.md`, an `AskUserQuestion`
  stall, a `stop` pause, or fleet-wide quiet. Exit 0 = tripped (report on stdout);
  exit 2 = max-poll timeout (re-arm).

Canonical orchestrator loop:

    launch-worker  ->  send-prompt  ->  watch-fleet.sh
                                          (exit 2: re-arm; exit 0: act on report)
                                       ->  stop-worker

Cross-reference: the OQ-escalation channel
(`docs/specs/id-43-oq-escalation/`) shares the events-dir transport but carries
worker->parent *decisions* (questions needing a ruling); `watch-fleet.sh` carries
*lifecycle / attention* signals. Distinct payloads, same directory.

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

---

## Common patterns

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

Caveats: each sub-orchestrator must be briefed with relative paths only.

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
parent expects to ratify partial progress before letting the worker continue.

### Final-report convention (sub-orchestrator stdout vs events_dir file)

**Sub-o brief convention.** Brief the sub-orchestrator to
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

### Handing off to a human

If the user wants to take over a running worker:

> Worker `<name>` is in cmux workspace `<ref>` (worktree
> `.claude/worktrees/<name>/`). Attach with `cmux attach --workspace <ref>`.
> Detach with the configured cmux detach key to return control to the
> orchestrator. Do NOT stop the worker on the orchestrator side while a human
> is attached.

---

## Important notes

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

Sub-orchestrators that hit an Open Question they cannot
resolve in-scope must NOT silently proceed or block indefinitely. Sub-orchestrators load
the OQ-escalation skill alongside `workflow-orchestration` when they need it.

The OQ protocol is implemented as a durable file-per-record mailbox under each worker's
`.claude/cmux-events/<sid>/oq/` directory. The helper scripts sit beside the five
dispatch scripts:

| Script | Side | Functions |
| --- | --- | --- |
| `scripts/oq-core.sh` | shared | `atomic_publish`, `verify_record`, `list_records`, `derive_oq_id`, `next_seq`, record builders/validators |
| `scripts/oq-worker.sh` | worker | `oq_emit`, `oq_cancel`, `oq_poll_decision`, `oq_check_decision`, `oq_restart_classify` |
| `scripts/oq-parent.sh` | parent | `oq_list_open`, `oq_decide`, `oq_scan_fleet` |
| `scripts/oq-canonical.py` | shared | canonical-JSON + SHA-256 checksum (stdlib only) |

The worker-facing usage contract a parent appends to a sub-orchestrator brief is
`oq-brief-fragment.md` (next to this SKILL.md).

Parent scan cadence: the parent's OQ-scan loop rides the canonical `watch-fleet.sh`
smart-watcher (not a bare `wait-for-fleet.sh` `stop`-poll): `watch-fleet.sh` wakes
on any actionable signal (incl. OQ-heading growth / a worker parked in
`awaiting-decision`) → `oq_scan_fleet` (read each `<sid>/oq/oq-state.json`, then the
blocked worker's open OQs in FIFO order) → `oq_decide` (write
`decisions/<oq_id>.json`). The decision **file** is always authoritative; the
optional `send-prompt.sh` nudge only wakes the worker's poll sooner and is never
correctness-bearing. Two-state contract (OQ-INV-24): a worker with an undecided
**blocking** OQ stays in `awaiting-decision` and does **not** `/exit` until the
decision lands.
