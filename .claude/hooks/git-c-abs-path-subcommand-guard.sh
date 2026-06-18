#!/usr/bin/env bash
# Tier 2.2 PreToolUse hook (ID-19.3 + FX-2 from ID-28.2 S62C).
#
# Blocks `git -C <abs canonical path>` for MUTATING subcommands.
# ALLOWS read-only subcommands (status, log, show, diff, branch --list,
# worktree list, etc.) so orchestrators can inspect sibling worktrees
# without working around the hook.
#
# Input: JSON on stdin from Claude Code PreToolUse, with .tool_input.command.
# Behaviour: exit 0 to allow tool call; exit 2 + stderr message to block.
#
# Rationale: op-agnostic block (pre-FX-2) was over-broad (S62B Test #5) — it
# blocked read-only inspection equally to mutating ops. Two-phase check now:
# (1) detect `git -C <abs path>`; (2) inspect subcommand for read-only vs
# mutating intent.

set -euo pipefail

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command' 2>/dev/null || true)

# Phase 1: detect `git -C <abs canonical path>` shape. If not matched,
# this hook has nothing to do.
# Boundary `(/|[[:space:]]|$)` so sibling repos (knowledge-hub-docs-site,
# knowledge-hub-archive) no longer false-positive (WS-A2 fix, 2026-06-12).
if ! echo "$CMD" | grep -qE 'git[[:space:]]+-C[[:space:]]+/Users/liamj/Documents/development/canonical(/[^[:space:]]*)?([[:space:]]|$)'; then
  exit 0
fi

# Phase 2: extract the subcommand following the path.
# Format: `git -C <path> <subcommand> [args...]`
SUBCMD=$(echo "$CMD" \
  | sed -nE 's|.*git[[:space:]]+-C[[:space:]]+/Users/liamj/Documents/development/canonical(/[^[:space:]]*)?[[:space:]]+([^[:space:]]+).*|\2|p' \
  | head -n1)

if [ -z "$SUBCMD" ]; then
  echo "BLOCKED: git -C with canonical absolute path but no parseable subcommand. Use a relative path or run git from the worktree CWD." >&2
  exit 2
fi

# Phase 3a: unconditional ALLOW — pure read-only verbs with no mutating subforms.
case "$SUBCMD" in
  status|log|show|diff|rev-parse|ls-files|ls-tree|fetch|tag|describe|reflog|blame|grep|shortlog|cat-file|symbolic-ref)
    exit 0
    ;;
esac

# Phase 3b: conditional ALLOW — verbs that have both read-only and mutating subforms.
MUTATING=0
case "$SUBCMD" in
  branch)
    # ALLOW: branch (no args), --list, -v, -a, -r, --show-current, --contains, etc.
    # BLOCK: -d / -D / -m / -M / -c / -C / --delete / --move / --copy / --set-upstream-to / --unset-upstream.
    if echo "$CMD" | grep -qE 'branch[[:space:]]+(-[dDmMcC]([[:space:]]|$)|--delete|--move|--copy|--set-upstream-to|--unset-upstream)'; then
      MUTATING=1
    fi
    ;;
  worktree)
    # ALLOW: worktree list. BLOCK: add, remove, move, prune, repair, lock, unlock.
    if ! echo "$CMD" | grep -qE 'worktree[[:space:]]+list([[:space:]]|$)'; then
      MUTATING=1
    fi
    ;;
  remote)
    # ALLOW: remote (no args), -v, get-url, show.
    # BLOCK: add, remove, rename, set-url, prune, update, set-head, set-branches.
    if echo "$CMD" | grep -qE 'remote[[:space:]]+(add|remove|rename|set-url|prune|update|set-head|set-branches)'; then
      MUTATING=1
    fi
    ;;
  config)
    # ALLOW: --get, --list, --get-all, --get-regexp, --get-urlmatch, -l.
    # BLOCK: bare config (set without flag), --add, --unset, --replace-all, --rename-section, etc.
    if ! echo "$CMD" | grep -qE 'config[[:space:]]+(--get|--list|--get-all|--get-regexp|--get-urlmatch|-l[[:space:]]|-l$)'; then
      MUTATING=1
    fi
    ;;
  stash)
    # ALLOW: stash list, stash show.
    # BLOCK: stash (no args = push), push, pop, apply, drop, clear, create, save.
    if ! echo "$CMD" | grep -qE 'stash[[:space:]]+(list|show)'; then
      MUTATING=1
    fi
    ;;
  *)
    # Default BLOCK for anything not enumerated above (push, commit, merge, rebase,
    # reset, checkout, switch, clean, gc, prune, am, apply, mv, rm, restore, etc.).
    MUTATING=1
    ;;
esac

if [ "$MUTATING" -eq 1 ]; then
  echo "BLOCKED: git -C with canonical absolute path and mutating subcommand '$SUBCMD'. Sub-agents must run mutating git from their worktree CWD, not via -C to the main repo (Tier 2.2 hook ID-19.3 + FX-2). Read-only subcommands (status, log, show, diff, branch --list, worktree list, remote -v, config --get, etc.) are allowed." >&2
  exit 2
fi

exit 0
