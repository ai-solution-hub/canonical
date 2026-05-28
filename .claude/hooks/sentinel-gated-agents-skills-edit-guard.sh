#!/usr/bin/env bash
# PreToolUse hook (ID-48.11).
#
# Blocks Write/Edit/MultiEdit to files under .claude/agents/ or .claude/skills/
# UNLESS one of the authoring skills (create-skill / update-skill /
# agent-development) has been recently invoked. Invocation is signalled by a
# "sentinel" touch-file written by Step 0 of those skill bodies.
#
# Why sentinel-gated rather than transcript-gated:
# PreToolUse hooks receive only the tool input + cwd via stdin JSON — they do
# NOT see conversation history or which skills have been invoked. The skill
# bodies write a touch-file at invocation time; this hook checks whether any
# such file exists with a recent mtime.
#
# Sentinel files:
#   $HOME/.claude/.sentinels/create-skill.touch
#   $HOME/.claude/.sentinels/update-skill.touch
#   $HOME/.claude/.sentinels/agent-development.touch
#
# TTL: 10 minutes (600 s). After TTL the user must re-invoke the authoring
# skill before editing skill/agent files again.
#
# Platform: macOS-primary. Uses `stat -f %m` (BSD form). Linux fallback via
# `stat -c %Y` is attempted only if the BSD form fails — keeps the hook
# portable for CI / GitHub Actions where the same skill bodies may run.
#
# Input: JSON on stdin from Claude Code PreToolUse, with
#   .tool_input.file_path and .cwd.
# Behaviour: exit 0 to allow tool call; exit 2 + stderr message to block.
#
# Pairs with sandbox allowance ID-48.12.

set -euo pipefail

TTL_SECONDS=600

INPUT=$(cat)
FP=$(echo "$INPUT" | jq -r '.tool_input.file_path' 2>/dev/null || true)

# If no file_path (shouldn't happen for Write|Edit|MultiEdit), allow — the
# worktree-isolation hook upstream will block anything malformed.
if [ -z "$FP" ] || [ "$FP" = "null" ]; then
  exit 0
fi

# Phase 1: only act on .claude/agents/ or .claude/skills/ paths. Matches
# both absolute paths (worktree or main repo) and relative paths.
if ! echo "$FP" | grep -qE '(^|/)\.claude/(agents|skills)/'; then
  exit 0
fi

# Phase 2: check for any recent sentinel.
SENTINEL_DIR="$HOME/.claude/.sentinels"
NOW=$(date +%s)
FOUND_RECENT=0

for skill in create-skill update-skill agent-development; do
  SF="$SENTINEL_DIR/$skill.touch"
  [ -f "$SF" ] || continue
  # macOS BSD stat first; Linux GNU stat fallback.
  MTIME=$(stat -f %m "$SF" 2>/dev/null || stat -c %Y "$SF" 2>/dev/null || echo 0)
  AGE=$((NOW - MTIME))
  if [ "$AGE" -ge 0 ] && [ "$AGE" -lt "$TTL_SECONDS" ]; then
    FOUND_RECENT=1
    break
  fi
done

if [ "$FOUND_RECENT" -eq 1 ]; then
  exit 0
fi

cat >&2 <<EOF
BLOCKED: Write/Edit/MultiEdit to '$FP' under .claude/(agents|skills)/ requires
invoking one of the authoring skills first (create-skill / update-skill /
agent-development). Those skills write a sentinel touch-file at
\$HOME/.claude/.sentinels/<skill>.touch; this hook checks for one with a
recent mtime (TTL = ${TTL_SECONDS}s).

Fix: invoke the relevant authoring skill via the Skill tool. Its Step 0
writes the sentinel; then retry this edit within the TTL window.

ID-48.11 sentinel-gated agents/skills edit guard. Pairs with sandbox
allowance ID-48.12.
EOF
exit 2
