# session-driver-cmux — script reference

Full per-script argument tables, the two monitoring primitives compared, and how to read a
worker's output. The body's _Lifecycle_ section covers the common path; this is the
exhaustive reference.

## Script summary

| Script              | Usage                                                                               | Description                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `launch-worker.sh`  | `<worker-name> <base-dir> [--branch <ref>] [--brief <file>] [extra-claude-args...]` | Create worktree + cmux workspace, launch claude                                                                                                                                                                         |
| `send-prompt.sh`    | `<worker-name> <prompt-text>`                                                       | Send text to a worker (no wait)                                                                                                                                                                                         |
| `converse.sh`       | `<worker-name> <session-id> <prompt> [timeout=120]`                                 | send-prompt + wait-for-stop + return last assistant text                                                                                                                                                                |
| `read-turn.sh`      | `<session-id> [--full]`                                                             | Render a worker's last turn (thinking + tool_use + tool_result + text) as markdown. `--full` un-truncates tool_results (default 5 lines)                                                                                |
| `wait-for-fleet.sh` | `--mode any\|all [--timeout S] <session-id>...`                                     | Wait for any-of or all-of a set of workers to emit `stop`                                                                                                                                                               |
| `stop-worker.sh`    | `<worker-name> <session-id> [--force] [--delete-branch]`                            | /exit, close workspace, verify clean tree, remove worktree; optionally delete worker branch                                                                                                                             |
| `watch-fleet.sh`    | `[env: IGNORE SEEN_OQ SEEN_FINAL SEEN_SEND INTERVAL MAX_POLLS QUIET_POLLS]`         | Smart multi-signal watcher: exits (wakes parent) on any actionable fleet event (session_end / final_report.\* / OQ-heading growth / AskUserQuestion stall / stop pause / fleet-quiet). Complements `wait-for-fleet.sh`. |

**`--brief <file>`**: copies the file into the worker worktree as `.cmux-brief.md` and
auto-sends "Read .cmux-brief.md before any work." after `session_start`.

**`stop-worker.sh`**: runs the dirty-tree safety check BEFORE closing the cmux workspace.
Exit-2 (dirty tree, no `--force`) therefore leaves the cmux workspace alive — operator can
re-attach to inspect, then either commit the work or re-run with `--force`. The dirty-tree
check excludes `.cmux-brief.md` (script-managed artefact placed by `--brief`).

**`--delete-branch`**: after worktree removal, deletes the worker branch
(`cmux-worker-<name>-<sha>`). Falls back to `git worktree list` lookup when the meta file
is missing (post-failure re-run scenario). Default OFF — the parent orchestrator usually
needs the branch alive long enough to cherry-pick / merge. Pass once cherry-pick / merge
is confirmed.

**`.worktreeinclude` honour**: if `<project-root>/.worktreeinclude` exists,
`launch-worker.sh` reads it as a list of literal file paths (one per line, `#` comments
skipped) and copies each existing source from project root into the new worktree. Plain
paths only — no glob expansion. Canonical case: `.env.local`.

## Monitoring: `wait-for-fleet.sh` vs `watch-fleet.sh`

Two monitoring primitives:

- `wait-for-fleet.sh` — block-on-`stop` primitive: blocks until any-of / all-of a named
  session set emits `stop`. Use for race / first-to-finish gating.
- `watch-fleet.sh` — smart multi-signal watcher: scans every worker's `events.jsonl` +
  worktree and EXITS (waking the parent) on the FIRST actionable signal across the fleet —
  `session_end`, a `final_report.*` in the events dir, a new `## OQ` heading in a worker's
  root `OQ-pending.md`, an `AskUserQuestion` stall, a `stop` pause, or fleet-wide quiet.
  Exit 0 = tripped (report on stdout); exit 2 = max-poll timeout (re-arm).

Canonical orchestrator loop:

    launch-worker  ->  send-prompt  ->  watch-fleet.sh
                                          (exit 2: re-arm; exit 0: act on report)
                                       ->  stop-worker

Cross-reference: the OQ-escalation channel
(`${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/id-43-oq-escalation/`) shares the
events-dir transport but carries worker->parent _decisions_ (questions needing a ruling);
`watch-fleet.sh` carries _lifecycle / attention_ signals. Distinct payloads, same
directory.

## Reading worker output

`converse.sh` returns only the worker's final assistant text. To collect a worker's full
last turn — thinking blocks, `tool_use` calls, `tool_result`s, and assistant text — as
markdown, use the KH-local `read-turn.sh` (it resolves the worker cwd from
`<sid>/meta.json` and encodes the Claude projects dir name to match this layout; the
upstream superpowers script reads the wrong `/tmp/claude-workers/<id>.meta` path and
mis-encodes dotted worktree paths):

```bash
"$SD_SCRIPTS/read-turn.sh" "$SESSION_ID"          # tool_results truncated to 5 lines
"$SD_SCRIPTS/read-turn.sh" "$SESSION_ID" --full   # tool_results rendered in full
```

Or read the events JSONL directly:

```bash
jq -c '.' .claude/cmux-events/"$SESSION_ID"/events.jsonl
```
