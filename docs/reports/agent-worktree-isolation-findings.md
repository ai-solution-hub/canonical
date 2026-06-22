---
title: "Agent worktree-isolation breakdown — findings"
status: OPEN — priority
session: S389 (2026-06-22)
---

# Agent worktree-isolation breakdown — findings

**Status:** OPEN, priority. A recurring regression across recent sessions ("didn't used to
happen"), root-caused this session (S389, investigation INV-A).

## TL;DR

When an orchestrator dispatches sub-agents with `isolation: "worktree"`, the agents' shells do
**not** relocate into the worktree that gets created — they run in the **parent session's**
worktree. Several "isolated" agents therefore share one working tree and **race**: each one's
startup `git reset --hard` reverts the others' edits. Native isolation is *not* broken; the
failure is a **two-layer interaction** — the parent session is itself a CWD-pinned worktree, and
a sub-agent spawned from a pinned parent inherits that pinned CWD.

## What we observed (S389)

- 8 executors dispatched intending per-finding isolation all landed in the single
  `jscpd-dupe-audit` worktree.
- Each agent's `git rev-parse --show-toplevel` returned the **parent** worktree path, not an
  `agent-*` one. Startup resets reverted each other's work; files were created then deleted
  mid-flight; commits stacked/interleaved on one branch.
- Recovery cost real wall-clock. **Zero work was ultimately lost** — diligent agents' commits
  survived as git objects and were cherry-picked; the rest were re-run serially — but this is a
  recurring tax, and the silent nature (no error, just a race) is the dangerous part.

## Root cause (INV-A)

1. The native Agent tool's `isolation: "worktree"` **does** work correctly in isolation — it
   creates, relocates, and commits (proven: a *different* session's agent worktree
   `agent-a7350c15…` held 3,101 tracked files + a real commit `bf2d4b07`, with a `CLAUDE_BASE`
   marker and a `logs/HEAD` showing reset→commit inside that tree).
2. The "created-but-not-relocated" symptom appears when the **parent session is itself a
   CWD-pinned worktree** (a cmux worker / sub-orchestrator — e.g. this session is pinned to
   `.claude/worktrees/jscpd-dupe-audit`). A sub-agent spawned from a pinned parent **inherits the
   parent's launch CWD** as its shell default.
3. Worktree **registration** (git plane — instant, `CLAUDE_BASE`-marked) and shell **chdir**
   (process plane — explicit) are **independent steps**. For an inherited-CWD dispatch only the
   registration happens; the chdir is skipped → the agent's git resolves to the parent's tree.

## Evidence (files of record)

- `.git/worktrees/agent-a7350c15023bd3196/CLAUDE_BASE` (native-agent marker) and `.../logs/HEAD`
  (relocation + commit proof).
- `.claude/cmux-events/<sid>/events.jsonl` (a sub-agent `Write` into the agent-worktree path; and
  worker `session_start cwd: .../worktrees/subo-*`).
- `.claude/cmux-events/<sid>/meta.json` (cmux pinned-CWD launch pattern).
- `~/.claude/settings.json` (`worktree.baseRef: "head"`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:
  "1"`); repo `.claude/settings.json` worktree block sets only `symlinkDirectories` — no
  cwd/isolation override that would force the chdir.

## Why it likely regressed ("didn't used to")

The breakage manifests only when the parent is *already* a pinned worktree. As sessions
increasingly run **inside** worktrees (cmux sub-orchestrators, `session-driver-cmux`, manual
worktrees), nested `isolation:"worktree"` dispatch from a pinned parent became the common case —
exactly the path where the shell-chdir is skipped. Earlier sessions dispatching from the **main
checkout** would not have hit it.

## Workarounds (in use now)

- **Serial execution in the shared tree** — one writer at a time, committing directly to the
  parent branch. Reliable; the S389 fallback. Cost: no parallelism.
- **Child calls `EnterWorktree({name})` as its first action** — per its contract this relocates
  *only that agent*, achieving true isolation even from a pinned parent. Enables safe parallel
  dispatch.
- **Explicit `cwd` on the dispatch** pointing at the intended worktree (a launch-pin source).

## Recommended fix (priority)

Make nested `isolation:"worktree"` from a pinned parent **auto-relocate** the sub-agent shell into
the worktree that was created (run the chdir step that is currently skipped), **or** make the
harness **fail loudly** when a worktree is registered for an agent that then operates in the
parent tree (so the race cannot happen silently). Until fixed, any dispatch brief needing parallel
isolation must instruct the child to call `EnterWorktree` first; otherwise use serial.

## References

- Investigation: S389 `audit-feedback-investigations` workflow, agent INV-A.
- Orchestration discipline: `.claude/skills/workflow-orchestration/SKILL.md`; CLAUDE.md
  "Orchestration & Sub-agents".
