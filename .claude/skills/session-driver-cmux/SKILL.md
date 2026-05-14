---
name: session-driver-cmux
description: Dispatches sub-Claude workers in isolated cmux terminals + git worktrees. Use when the orchestrator needs to fan out work to one or more independent Claude Code sessions, monitor their lifecycle through emitted events, optionally gate every tool call, and collect their output. Project-local KH adaptation of superpowers/claude-session-driver. Trigger phrases include "spawn worker", "fan out", "dispatch sub-Claude", "session-driver", "orchestrator-of-orchestrators".
allowed-tools: Bash, Read
---

# session-driver-cmux

Dispatch primitive that lets a Claude Code session act as an
"orchestrator-of-orchestrators": spawn sub-Claude workers, each pinned to its
own cmux terminal and git worktree, then converse with them programmatically.

KH-adapted from upstream `superpowers/claude-session-driver` 1.0.1. The
adaptation swaps tmux for cmux, moves events out of `/tmp/claude-workers/` into
a per-worktree `.claude/cmux-events/<worker-id>/` directory (gitignored), and
adds a `wait-for-fleet` primitive for multi-worker coordination.

This skill is **taxonomy-agnostic**: it does not know about Taskmaster, work
packages, or KH-specific roles. Layer task-management concepts on top in a
separate skill or workflow.

---

## When to invoke

Use this skill when the orchestrator session needs to:

- Launch one or more independent Claude Code workers in parallel, each in its
  own terminal and worktree, without blocking on interactive permission prompts.
- Send prompts to workers and wait for their responses programmatically.
- Inspect or gate every tool call a worker makes (PreToolUse approval window).
- Coordinate a fleet: wait for any-of or all-of a worker set to finish.
- Hand a running worker off to a human operator.

**Do not** use this for sub-agents already covered by Claude Code's built-in
`Agent` tool or `isolation: "worktree"` — those are simpler and don't need a
full Claude session per worker. Reach for cmux workers when you need:
durable, attachable terminals; per-worker tool gating; or workers that outlive
the orchestrator turn.

---

## Prerequisites

- **cmux** CLI installed and a cmux daemon running. The launch script will
  refuse to run if `cmux list-workspaces` errors.
- **jq** (system-wide; same dependency as upstream).
- **claude** CLI on `PATH` (the worker process).
- **Upstream session-driver plugin installed** at
  `~/.claude/plugins/cache/superpowers-marketplace/claude-session-driver/1.0.1/`.
  The KH skill reuses the upstream plugin directory (passed to `claude
  --plugin-dir`) — only the orchestrator-side scripts are project-local.
- **Project worktree writable**: the skill writes events to
  `<project-root>/.claude/cmux-events/<worker-id>/events.jsonl` and creates
  worktrees under `<project-root>/.claude/worktrees/`. Both paths are
  gitignored.

---

## Setup

All five scripts live next to this SKILL.md. The orchestrator should set:

```bash
SD_SCRIPTS=".claude/skills/session-driver-cmux/scripts"
```

Use relative paths throughout (KH gotcha: "Sub-agent instructions must always
use relative paths"). Absolute paths resolve to the main repo, not the
worktree, when the orchestrator itself runs in a worktree.

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
6. Launches `claude --session-id <id> --plugin-dir <upstream-plugin>
   --dangerously-skip-permissions` inside the workspace, with
   `KH_CMUX_EVENTS_DIR` exported so the upstream hooks emit into the correct
   directory.
7. Waits up to 30s for the `session_start` event.

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

For finer control, call `send-prompt.sh` and `wait-for-event.sh` (upstream) directly.

### 3. Wait for a fleet

For multi-worker dispatch:

```bash
"$SD_SCRIPTS/wait-for-fleet.sh" --mode all --timeout 600 \
  "$SID1" "$SID2" "$SID3"
```

- `--mode all` blocks until every worker emits `stop`.
- `--mode any` returns as soon as one does.
- Exit 0 on success, 1 on timeout. Prints the matching session IDs on stdout.

Internally calls upstream `wait-for-event.sh` per worker — cmux-events dir
override is propagated via env.

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

The upstream session-driver plugin's hooks emit JSONL events to
`.claude/cmux-events/<SESSION_ID>/events.jsonl`:

| Event                | Source hook        | Extra fields           |
| -------------------- | ------------------ | ---------------------- |
| `session_start`      | `SessionStart`     | `cwd`                  |
| `user_prompt_submit` | `UserPromptSubmit` | —                      |
| `pre_tool_use`       | `PreToolUse`       | `tool`, `tool_input`   |
| `stop`               | `Stop`             | —                      |
| `session_end`        | `SessionEnd`       | —                      |

The `PreToolUse` hook also blocks the worker for up to
`CLAUDE_SESSION_DRIVER_APPROVAL_TIMEOUT` seconds (default: 30) waiting for the
orchestrator to write a decision to `<events-dir>/<SESSION_ID>/tool-decision`
via `approve-tool.sh` (upstream). If no decision arrives, the tool call
auto-approves.

To actively gate tool calls, run a `read-events.sh --follow` loop in the
background and respond to `pre_tool_use` events with `approve-tool.sh`.

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

The CLAUDE.md "Worktree isolation rules" section is the authoritative source.
This skill is the dispatch primitive — it does not reimplement those rules.

---

## Reference: script summary

| Script               | Usage                                                              | Description                                                  |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| `launch-worker.sh`   | `<worker-name> <base-dir> [--branch <ref>] [extra-claude-args...]` | Create worktree + cmux workspace, launch claude              |
| `send-prompt.sh`     | `<worker-name> <prompt-text>`                                      | Send text to a worker (no wait)                              |
| `converse.sh`        | `<worker-name> <session-id> <prompt> [timeout=120]`                | send-prompt + wait-for-stop + return last assistant text     |
| `wait-for-fleet.sh`  | `--mode any\|all [--timeout S] <session-id>...`                    | Wait for any-of or all-of a set of workers to emit `stop`    |
| `stop-worker.sh`     | `<worker-name> <session-id> [--force]`                             | /exit, close workspace, verify clean tree, remove worktree   |

Upstream-provided (in `~/.claude/plugins/cache/.../1.0.1/scripts/`, no KH
adaptation needed):

| Script               | Usage                                                              |
| -------------------- | ------------------------------------------------------------------ |
| `wait-for-event.sh`  | `<session-id> <event-type> [timeout] [--after-line N]`             |
| `read-events.sh`     | `<session-id> [--last N] [--type T] [--follow]`                    |
| `approve-tool.sh`    | `<session-id> <allow\|deny>`                                       |
| `read-turn.sh`       | `<session-id> [--full]`                                            |

The KH scripts pass the events-dir override to upstream scripts via the
`KH_CMUX_EVENTS_DIR` env var. Upstream scripts use `/tmp/claude-workers/` by
default; the wrapper detects the env var and rebases paths accordingly. (If a
future upstream version changes this contract, the KH wrappers will need
updating — pin the upstream version we tested against in
`docs/runbooks/`.)

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
