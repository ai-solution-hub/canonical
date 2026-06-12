#!/usr/bin/env bash
# PreToolUse hook (workflow-improvement WS-A3, 2026-06-12).
#
# Blocks Bash commands that feed an UNQUOTED-delimiter heredoc (<<EOF) whose
# body contains `!`. History-expansion / interpolation mangling of `!=` and
# `!` inside unquoted heredocs caused repeated self-inflicted rewrites
# (friction cluster F3 — recurred across >=3 sessions despite prose warnings
# in skills; this hook is the deterministic replacement).
#
# Allowed and untouched:
#   - quoted-delimiter heredocs:  <<'EOF' / <<"EOF"  (no expansion — safe)
#   - here-strings: <<<word
#   - unquoted heredocs whose body contains no `!`
#
# Fix when blocked: quote the delimiter (<<'EOF') if no interpolation is
# needed, or write the script to a file and execute it.
#
# Input: JSON on stdin with .tool_input.command.
# Behaviour: exit 0 allow; exit 2 + stderr block.

set -euo pipefail

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command' 2>/dev/null || true)
[ -z "$CMD" ] || [ "$CMD" = "null" ] && exit 0

# Unquoted heredoc marker: << or <<- followed by a bare WORD (not ' or ").
# `<<<` here-strings do not match (third < is not a delimiter letter).
if ! echo "$CMD" | grep -qE '<<-?[[:space:]]*[A-Za-z_]'; then
  exit 0
fi

# Body after the first heredoc marker; block only if it contains `!`.
BODY=${CMD#*<<}
case "$BODY" in
  *!*)
    cat >&2 <<'MSG'
BLOCKED: unquoted heredoc (<<EOF) with a `!` in its body. Shell expansion
mangles `!`/`!=` inside unquoted heredocs (recurring F3 friction).
Fix: quote the delimiter — <<'EOF' — if you don't need interpolation, or
write the script to a file and execute it. (WS-A3 heredoc pre-flight hook.)
MSG
    exit 2
    ;;
esac

exit 0
