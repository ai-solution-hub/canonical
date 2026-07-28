#!/usr/bin/env bash
# PreToolUse hook (ID-48.11).
#
# Blocks Write/Edit/MultiEdit — and, when wired under the Bash matcher,
# Bash-mediated writes (redirects, mv/cp/rm/tee, sed -i, scripted splices) —
# to files under .claude/agents/ or .claude/skills/ UNLESS one of the
# authoring skills (create-skill / update-skill / agent-development) has been
# recently invoked. Invocation is signalled by a "sentinel" touch-file
# written by Step 0 of those skill bodies. Bash detection is a heuristic on
# the command text, not a parser: read-only commands touching those paths
# stay unguarded; a blocked false positive is escaped by invoking the
# authoring skill (its Step 0 touch runs via Bash and is allowlisted).
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
CMD=$(echo "$INPUT" | jq -r '.tool_input.command' 2>/dev/null || true)

PATH_RE='(^|[/ "'"'"'=])\.claude/(agents|skills)/'

if [ -n "$FP" ] && [ "$FP" != "null" ]; then
  # Write|Edit|MultiEdit shape.
  # Phase 1: only act on .claude/agents/ or .claude/skills/ paths. Matches
  # both absolute paths (worktree or main repo) and relative paths.
  if ! echo "$FP" | grep -qE '(^|/)\.claude/(agents|skills)/'; then
    exit 0
  fi
elif [ -n "$CMD" ] && [ "$CMD" != "null" ]; then
  # Bash shape (id-386 guard-scope extension: Bash-mediated writes previously
  # bypassed this guard entirely). Heuristic, not a parser: flag only commands
  # that plausibly WRITE into .claude/(agents|skills)/ — reads stay unguarded.
  FP="$CMD"
  if ! echo "$CMD" | grep -qE "$PATH_RE"; then
    exit 0
  fi
  WRITES=0
  # (a) A redirect whose target is under the guarded path.
  echo "$CMD" | grep -qE '>>?[ ]*"?[^ ]*\.claude/(agents|skills)/' && WRITES=1
  # (b) A mutating verb with the guarded path inside its own segment
  #     (no pipe/;/& between verb and path).
  echo "$CMD" | grep -qE '\b(mv|cp|rm|tee|install|rsync|truncate|dd|patch)\b[^|;&]*\.claude/(agents|skills)/' && WRITES=1
  # (c) In-place editors.
  echo "$CMD" | grep -qE '\b(sed|perl)\b[^|;&]*-i[^|;&]*\.claude/(agents|skills)/' && WRITES=1
  # (d) Scripted writes (the proven python3-splice route): a python/node
  #     invocation naming the path alongside a write API.
  echo "$CMD" | grep -qE '\b(python3?|node)\b' \
    && echo "$CMD" | grep -qE 'open\(|write_text|writeFile|shutil\.' && WRITES=1
  [ "$WRITES" -eq 1 ] || exit 0
else
  # Neither shape present — allow; nothing to judge.
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
BLOCKED: writing under .claude/(agents|skills)/ (via '$FP') requires
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
