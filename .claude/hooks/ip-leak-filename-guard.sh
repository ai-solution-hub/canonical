#!/usr/bin/env bash
# PreToolUse hook (workflow-improvement WS-A7, 2026-06-12).
#
# Blocks tool calls whose file path or command text contains a client /
# counterparty name from the private denylist. Prevents IP leaks like the
# near-miss where a migration filename contained a client name (friction F8).
#
# Denylist: ${KH_PRIVATE_DOCS_DIR}/.config/ip-denylist.txt
#   - one term per line, case-insensitive substring match
#   - lines starting with # are comments; blank lines ignored
#   - file lives in the PRIVATE docs-site repo so the names themselves are
#     never committed to the public knowledge-hub repo
# If the denylist file is absent, this hook is a silent no-op.
#
# Matched against: .tool_input.file_path (Write/Edit) and
# .tool_input.command (Bash) — filenames and command text are both leak
# vectors (supabase migration new <name>, git mv, echo > file, branch names).
#
# Input: JSON on stdin. Behaviour: exit 0 allow; exit 2 + stderr block.

set -euo pipefail

DENYLIST="${KH_PRIVATE_DOCS_DIR:-}/.config/ip-denylist.txt"
[ -f "$DENYLIST" ] || exit 0

INPUT=$(cat)
TEXT=$(echo "$INPUT" | jq -r '(.tool_input.file_path // "") + " " + (.tool_input.command // "")' 2>/dev/null || true)
[ -z "${TEXT// /}" ] && exit 0

while IFS= read -r term; do
  case "$term" in ''|'#'*) continue;; esac
  if echo "$TEXT" | grep -qiF -- "$term"; then
    cat >&2 <<MSG
BLOCKED: tool input contains a denylisted client/IP term (matched a line in
the private ip-denylist). Client names must never appear in filenames, branch
names, commands, or committed artifacts in this repo. Rename using a neutral
slug. (WS-A7 IP-leak guard; denylist: \$KH_PRIVATE_DOCS_DIR/.config/ip-denylist.txt)
MSG
    exit 2
  fi
done < "$DENYLIST"

exit 0
