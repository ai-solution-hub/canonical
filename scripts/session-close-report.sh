#!/usr/bin/env bash
# session-close-report.sh — emit the mechanically-derivable session-close state for the
# handoff continuation prompt's "Mechanical state (auto-generated)" section (Task δ,
# CA-S430 workflow-continuity-repair). Read-only.
# Run from the canonical repo root: `bash scripts/session-close-report.sh`.
set -uo pipefail

ts="$(date -u +%Y-%m-%dT%H:%MZ)"

echo "## Mechanical state (auto-generated)"
echo
echo "_\`scripts/session-close-report.sh\` @ ${ts}._"
echo

echo "### Branch / HEAD"
echo '```'
printf 'branch: %s\n' "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
printf 'HEAD:   %s\n' "$(git log -1 --format='%h %s' 2>/dev/null || echo '?')"
echo '```'
echo

echo "### Named worktrees (orphan check — verify each is landed before removal)"
echo '```'
git worktree list 2>/dev/null || echo '(none)'
echo '```'
echo

echo "### Open PRs + CI"
echo '```'
gh-axi pr list 2>/dev/null || echo '(gh-axi unavailable — run manually)'
echo '```'
echo

echo "### GitNexus index freshness"
echo '```'
if [ -d .gitnexus ]; then
  printf 'repo HEAD: %s\n' "$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "(stale-index warning on commit is expected; run 'bun run gitnexus:analyze' before a code-heavy wave)"
else
  echo '(.gitnexus absent)'
fi
echo '```'
