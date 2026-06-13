#!/usr/bin/env bash
# PreToolUse(Bash) gate for the RTK trial (WS-C item 4 / D3).
#
# RTK (github.com/rtk-ai/rtk) compacts command OUTPUT to save tokens. Left
# unscoped it also proxies `tsc` / `vitest` / `lint` / `next` etc., which FILTER
# their output — that would trim the failure / error / exit-status / stack-trace
# signal the non-developer owner's verification gates depend on. This gate is the
# silent-failure firewall.
#
# CLOSED-BY-DEFAULT ALLOWLIST: ONLY genuinely read-only commands are delegated to
# `rtk hook claude` (which emits the PreToolUse rewrite contract). EVERY other
# command — every test / lint / build / typecheck run, every git/gh/supabase
# mutation, anything not explicitly allowlisted — passes through RAW; rtk never
# sees it, so its output is never trimmed. Compound / pipe / redirect /
# substitution commands ALSO always pass raw (a pipeline can hide a non-read
# command behind an allowlisted first token).
#
# Ordering: this hook MUST run LAST in the PreToolUse(Bash) chain so the security
# guards (cd / git-C / heredoc / ip-leak) scan the PRISTINE command before any
# rtk rewrite. No-op if rtk is not installed.
set -uo pipefail

INPUT=$(cat)
command -v rtk >/dev/null 2>&1 || exit 0

CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0

# Structural firewall — compound / pipe / redirect / substitution always pass raw.
if printf '%s' "$CMD" | grep -qE '&&|[;|<>]|[$][(]|[`]'; then
  exit 0
fi

first=$(printf '%s' "$CMD" | awk '{print $1}')
sub=$(printf '%s' "$CMD" | awk '{print $2}')
allow=0
case "$first" in
  ls|cat|head|tail|wc|stat|file|tree|realpath|basename|dirname|grep|rg|fd|find|jq|yq)
    allow=1 ;;
  git)
    case "$sub" in
      status|log|diff|show|branch|remote|ls-files|ls-tree|rev-parse|describe|blame|shortlog)
        allow=1 ;;
    esac ;;
  gh)
    case " $CMD " in *' view '*|*' list '*) allow=1 ;; esac ;;
  # NB: `bun` is deliberately NOT allowlisted — rtk has no proxy for
  # `bun scripts/ledger-cli.ts` (so nothing to gain), and keeping bun out
  # guarantees `bun run test` / `bun lint` / `bun run build` can never reach rtk.
esac
[ "$allow" -eq 1 ] || exit 0

# Allowlisted read-only command -> delegate to rtk's own validated hook handler,
# which prints the correct PreToolUse updatedInput JSON to stdout (or nothing if
# rtk has no equivalent, in which case the command is unchanged). stderr is rtk's
# informational chatter and is discarded.
printf '%s' "$INPUT" | rtk hook claude 2>/dev/null
