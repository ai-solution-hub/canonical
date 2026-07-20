#!/usr/bin/env bash
# Pre-commit hook installed into each session-driver-cmux worker worktree.
# Runs prettier on staged files so worker commits land already-formatted —
# complements the project-level format-pre-commit, belt-and-braces.
#
# Strategy: format only staged files (not the whole tree). Re-add formatted
# files to the index so the commit captures the formatted content. If
# prettier produces no changes the commit proceeds unchanged.
#
# Filter:
#   - Only files prettier supports (driven by `prettier --check`'s own
#     file-type detection; we pre-filter to common extensions to avoid
#     spawning prettier on binaries).
#   - Skip deletions (--diff-filter=ACMR excludes D).
#
# Failure mode: if prettier exits non-zero (e.g. syntax error in a JS file),
# the commit is aborted with prettier's diagnostic surfaced to the worker.
# The worker can then fix the source and re-stage.
#
# Installed by .claude/skills/session-driver-cmux/scripts/launch-worker.sh
# at worktree-creation time; not tracked by the worktree's own git history.

set -euo pipefail

# Resolve repo root from the hook's location ($GIT_DIR is set by git).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi

cd "$REPO_ROOT"

# --- Clash-free ledger guard -----------------------------------------------
# Workers run in isolated worktrees, so the ledger daemon mutex — which is per
# main-checkout ledger directory — CANNOT de-conflict their writes. An
# in-branch `chore(ledger)` commit bypasses the mutex entirely. Block any
# staged ledger JSON or its md mirror (the ledgers live in the private
# docs-site repo under src/content/docs/ledgers/) so a stray in-branch ledger
# write fails loudly here; workers RETURN ledger-write intents in
# final_report.yaml instead, and the Orchestrator applies them on MAIN. See
# .claude/skills/workflow-orchestration/SKILL.md → Ledger field-discipline.
#
# ROLLOUT CAVEAT: this hook is copied into each worktree at launch
# (launch-worker.sh), so editing it affects FUTURE worktrees only — the
# Orchestrator sequences the change before the next wave's launches.
#
# Read-only staged-index check; degrade-safe — only block on a positive match
# (a failed/empty staged-name query never blocks). `|| true` keeps an empty
# grep from aborting under `set -euo pipefail`.
STAGED_LEDGER=$(git diff --cached --name-only --diff-filter=ACMR \
  | grep -E '^src/content/docs/ledgers/(task-list|product-backlog|product-roadmap|product-retros|umbrellas)\.json$|^src/content/docs/ledgers/(tasks|backlog|roadmap)/.*\.md$' \
  || true)

if [ -n "$STAGED_LEDGER" ]; then
  echo "" >&2
  echo "pre-commit: BLOCKED — ledger write staged in a worker branch:" >&2
  while IFS= read -r offending; do
    echo "  - $offending" >&2
  done <<<"$STAGED_LEDGER"
  echo "" >&2
  echo "Workers (worktree sub-orchestrators + executors) MUST NOT commit ledger" >&2
  echo "writes in-branch. The ledger daemon mutex is per main-checkout ledger" >&2
  echo "directory, so an in-branch chore(ledger) commit bypasses it and races" >&2
  echo "id allocation. RETURN ledger-write intents in final_report.yaml; the" >&2
  echo "Orchestrator applies them via ledger-cli.ts on the MAIN checkout." >&2
  echo "" >&2
  exit 1
fi
# --------------------------------------------------------------------------

# Collect staged files prettier can handle. Extension allowlist keeps the
# spawn cost predictable and avoids prettier's "no parser inferred" noise
# on unrelated files (e.g. .sh, .py, binaries).
STAGED=$(git diff --cached --name-only --diff-filter=ACMR \
  | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|css|scss|html|yaml|yml)$' \
  || true)

if [ -z "$STAGED" ]; then
  exit 0
fi

# Run prettier --write on staged files. Use bun (project standard) to invoke
# the locally-installed prettier without a global dependency.
if ! echo "$STAGED" | xargs bun prettier --write --log-level=warn; then
  echo "pre-commit: prettier failed — fix the reported errors and re-stage." >&2
  exit 1
fi

# Re-add the formatted files so the commit captures the rewrites. -f: a staged
# file under a gitignored path (already tracked) must re-add without aborting.
echo "$STAGED" | xargs git add -f

exit 0
