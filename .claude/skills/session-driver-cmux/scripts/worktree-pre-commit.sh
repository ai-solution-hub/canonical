#!/usr/bin/env bash
# Pre-commit hook installed into each session-driver-cmux worker worktree
# (ID-48.12). Runs prettier on staged files so worker commits land
# already-formatted — complements the project-level format-pre-commit
# (ID-48.8) belt-and-braces.
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

# Re-add the formatted files so the commit captures the rewrites.
echo "$STAGED" | xargs git add

exit 0
