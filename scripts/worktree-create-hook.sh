#!/usr/bin/env bash
set -euo pipefail

# scripts/worktree-create-hook.sh — Claude Code `WorktreeCreate` hook.
#
# Replaces native worktree creation (docs/en/worktrees#replace-worktree-creation-
# with-a-hook) so EVERY Claude-created worktree — Agent `isolation:"worktree"`,
# `claude --worktree`, desktop parallel sessions — comes up fully provisioned.
# Closes the S496 gap where subagent worktrees arrived without node_modules and
# burned a failed vitest run before the agent hand-cloned it.
#
# What it does, in order:
#   1. `git worktree add` under .claude/worktrees/<name> (native layout, so the
#      periodic sweep and .gitignore conventions keep working), branching from
#      the CURRENT HEAD — the "head" baseRef semantics. Deliberate: agent briefs
#      pin "work from your worktree HEAD", and branching from origin/HEAD would
#      silently discard unpushed local main state (the S496 hazard).
#   2. scripts/provision-worktree.sh — symlinks per settings.json
#      worktree.symlinkDirectories + copies per .worktreeinclude. A
#      WorktreeCreate hook suppresses native .worktreeinclude processing, so
#      the provision script is what carries it here.
#   3. CoW-clone node_modules (`cp -c`, APFS — seconds). A REAL directory, not
#      a symlink: turbopack/Next.js infer the workspace root from node_modules
#      location, which is the recorded objection (S495) to symlinking it.
#      node_modules therefore stays OUT of worktree.symlinkDirectories.
#
# Hook contract: JSON on stdin (`.name`); stdout must be EXACTLY the created
# directory path; all diagnostics to stderr. A non-path stdout aborts session
# startup with exit 1 (documented), so everything below routes >&2.

INPUT="$(cat)"
NAME="$(printf '%s' "$INPUT" | jq -r '.name // empty' 2>/dev/null || true)"
[ -n "$NAME" ] || NAME="wt-$(date +%s)-$$"

ROOT="$(git rev-parse --show-toplevel)"
DIR="$ROOT/.claude/worktrees/$NAME"
BRANCH="worktree-$NAME"

# Reuse-name semantics: an existing directory is reopened, never recreated.
if [ -d "$DIR" ]; then
  echo "$DIR"
  exit 0
fi

# Stale branch without a directory (crashed prior session): park it out of the
# way rather than failing creation.
if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  BRANCH="$BRANCH-$(date +%s)"
fi

git -C "$ROOT" worktree add -b "$BRANCH" "$DIR" HEAD >&2

bash "$ROOT/scripts/provision-worktree.sh" "$DIR" "$ROOT" >&2 \
  || echo "worktree-create-hook: provision-worktree.sh failed (non-fatal)" >&2

if [ -d "$ROOT/node_modules" ] && [ ! -e "$DIR/node_modules" ]; then
  cp -c -R "$ROOT/node_modules" "$DIR/node_modules" 2>/dev/null \
    || cp -R "$ROOT/node_modules" "$DIR/node_modules" >&2 \
    || echo "worktree-create-hook: node_modules clone failed (non-fatal)" >&2
fi

echo "$DIR"
