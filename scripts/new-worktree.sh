#!/usr/bin/env bash
set -euo pipefail

# scripts/new-worktree.sh — create a TOP-LEVEL sibling git worktree and provision
# it with the canonical symlink + copy layout.
#
# Native `claude --worktree <name>` always nests worktrees under
# .claude/worktrees/ and cannot create top-level siblings; `git worktree add`
# can place a sibling but does NOT apply symlinkDirectories / .worktreeinclude;
# `git-worktreeinclude` copies but never symlinks. This wrapper combines a plain
# `git worktree add ../<name>` with scripts/provision-worktree.sh so a top-level
# worktree gets the IDENTICAL layout (symlinked node_modules/.venv/.bin/.cache,
# surgically-symlinked .gitnexus index, copied .env.local/tsbuildinfo) from the
# single config source.
#
# Usage:
#   scripts/new-worktree.sh <name> [<base-ref>]
#
#   <name>       Worktree dir + branch name. Created as a sibling of the repo
#                root: <repo-parent>/<name> on a new branch <name>.
#   <base-ref>   Ref to branch from. Default: current HEAD of the main worktree.
#
# Idempotency: refuses if the branch or the destination path already exists
# (with a recovery hint), so a half-finished prior run is surfaced, not masked.

USAGE="Usage: new-worktree.sh <name> [<base-ref>]"
NAME="${1:?$USAGE}"
BASE_REF="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" worktree list --porcelain 2>/dev/null \
  | awk '/^worktree /{print $2; exit}')"
if [ -z "${PROJECT_ROOT:-}" ] || [ ! -d "$PROJECT_ROOT" ]; then
  echo "Error: could not resolve repo root from $SCRIPT_DIR." >&2
  exit 1
fi

DEST="$(dirname "$PROJECT_ROOT")/$NAME"

if git -C "$PROJECT_ROOT" rev-parse --verify --quiet "refs/heads/$NAME" >/dev/null 2>&1; then
  echo "Error: branch '$NAME' already exists." >&2
  echo "       Recover with:  git -C $PROJECT_ROOT branch -D $NAME" >&2
  exit 1
fi
if [ -e "$DEST" ]; then
  echo "Error: destination '$DEST' already exists." >&2
  echo "       Recover with:  git -C $PROJECT_ROOT worktree remove --force $DEST" >&2
  exit 1
fi

if [ -n "$BASE_REF" ]; then
  git -C "$PROJECT_ROOT" worktree add -b "$NAME" "$DEST" "$BASE_REF"
else
  git -C "$PROJECT_ROOT" worktree add -b "$NAME" "$DEST"
fi

echo "Created worktree: $DEST (branch $NAME)" >&2
"$SCRIPT_DIR/provision-worktree.sh" "$DEST" "$PROJECT_ROOT"
echo "Top-level worktree ready: $DEST" >&2
