#!/usr/bin/env bash
set -euo pipefail

# scripts/provision-worktree.sh — seed a freshly-created git worktree with the
# symlinks + copies that native Claude-Code worktree creation performs, driven
# by the SAME single source of truth: .claude/settings.json
# worktree.symlinkDirectories (symlinks) + .worktreeinclude (copies).
#
# Why this exists: native worktree.symlinkDirectories / .worktreeinclude only
# fire under Claude-Code-managed worktree creation (`claude --worktree`, Agent
# `isolation:"worktree"`). Raw `git worktree add` — top-level sibling worktrees
# and the cmux session-driver launch-worker.sh — bypasses them, and
# `git-worktreeinclude` (satococoa) can only COPY, never symlink. This script
# closes both gaps so every worktree, however created, gets an identical layout
# from ONE config. Edit settings.json / .worktreeinclude; never re-encode the
# lists here.
#
# Usage:
#   scripts/provision-worktree.sh <worktree-path> [<source-root>]
#
#   <worktree-path>   Path to the already-created worktree to provision.
#   <source-root>     Tree to symlink/copy FROM (holds the real
#                     node_modules/.gitnexus/...). Default: the main worktree,
#                     resolved from <worktree-path> via `git worktree list`.
#
# Behaviour (idempotent; each item is non-fatal):
#   - symlinkDirectories: absolute symlink per listed dir that exists in the
#     source and is not already a real dir in the worktree. (.gitnexus is
#     excluded — see below.)
#   - .gitnexus: special-cased. It holds a TRACKED CLAUDE.md, so a whole-dir
#     symlink would shadow that tracked file (native therefore can't symlink it
#     and full-copies the ~370M lbug instead). Here: real .gitnexus/ dir +
#     absolute symlinks to the parent's lbug + meta.json, and a strip of any
#     bare `.gitnexus/` line from the shared info/exclude (which would re-ignore
#     the tracked CLAUDE.md). We deliberately do NOT `gitnexus index` the
#     worktree — that would add a duplicate "canonical" registry entry and break
#     the repo resolver (single-canonical invariant; see the block below).
#     Leaner than native's full copy; agents query via `--repo canonical`.
#   - .worktreeinclude: each non-blank, non-comment line is treated as a literal
#     relative path and `cp -R`d if it exists in the source. `.gitnexus*` lines
#     are SKIPPED (handled surgically above).
#
# Exits 0 even when individual seeds are skipped; non-zero only on bad arguments
# or a target that is not a git worktree.

USAGE="Usage: provision-worktree.sh <worktree-path> [<source-root>]"
WORKTREE_ARG="${1:?$USAGE}"
SOURCE_ARG="${2:-}"

if [ ! -d "$WORKTREE_ARG" ]; then
  echo "Error: worktree path '$WORKTREE_ARG' does not exist." >&2
  exit 1
fi
WORKTREE_PATH="$(cd "$WORKTREE_ARG" && pwd -P)"

if ! git -C "$WORKTREE_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: '$WORKTREE_PATH' is not inside a git worktree." >&2
  exit 1
fi

# Resolve the source root (the tree we mirror FROM).
if [ -n "$SOURCE_ARG" ]; then
  SOURCE_ROOT="$(cd "$SOURCE_ARG" && pwd -P)"
else
  # The main worktree is always the first entry in `git worktree list`.
  SOURCE_ROOT="$(git -C "$WORKTREE_PATH" worktree list --porcelain 2>/dev/null \
    | awk '/^worktree /{print $2; exit}')"
  if [ -z "${SOURCE_ROOT:-}" ] || [ ! -d "$SOURCE_ROOT" ]; then
    echo "Error: could not resolve source root from git worktree list." >&2
    exit 1
  fi
fi

if [ "$SOURCE_ROOT" = "$WORKTREE_PATH" ]; then
  echo "Error: source root and worktree path are the same tree ('$WORKTREE_PATH')." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq not found on PATH (required to read symlinkDirectories)." >&2
  exit 1
fi

echo "provision-worktree: $WORKTREE_PATH  (source: $SOURCE_ROOT)" >&2

# --- symlinkDirectories (settings.local.json overrides settings.json) ---

read_symlink_dirs() {
  local f dirs
  for f in "$SOURCE_ROOT/.claude/settings.local.json" "$SOURCE_ROOT/.claude/settings.json"; do
    if [ -f "$f" ]; then
      dirs="$(jq -r '.worktree.symlinkDirectories[]? // empty' "$f" 2>/dev/null || true)"
      if [ -n "$dirs" ]; then
        printf '%s\n' "$dirs"
        return 0
      fi
    fi
  done
  # Fallback only if neither settings file declares the key.
  printf '%s\n' node_modules .venv .cache
}

SYMLINKED=0
while IFS= read -r dir; do
  [ -z "$dir" ] && continue
  case "$dir" in
    .gitnexus) continue ;;  # tracked CLAUDE.md → surgical handling below
  esac
  SRC="$SOURCE_ROOT/$dir"
  DST="$WORKTREE_PATH/$dir"
  [ -e "$SRC" ] || continue
  if [ -d "$DST" ] && [ ! -L "$DST" ]; then
    echo "  skip symlink: $dir already a real dir in worktree" >&2
    continue
  fi
  if ln -sfn "$SRC" "$DST" 2>/dev/null; then
    echo "  symlink: $dir -> $SRC" >&2
    SYMLINKED=$((SYMLINKED + 1))
  else
    echo "  Note: could not symlink '$dir' (non-fatal)" >&2
  fi
done < <(read_symlink_dirs)

# --- .gitnexus (surgical: real dir + lbug/meta.json symlinks + register) ---

PARENT_GNX="$SOURCE_ROOT/.gitnexus"
if [ -f "$PARENT_GNX/lbug" ] && [ -f "$PARENT_GNX/meta.json" ]; then
  # Strip a bare `.gitnexus/` line from the shared info/exclude — it would undo
  # the `!.gitnexus/CLAUDE.md` negation and re-ignore the tracked directive file.
  COMMON_DIR="$(git -C "$WORKTREE_PATH" rev-parse --git-common-dir 2>/dev/null || true)"
  if [ -n "$COMMON_DIR" ]; then
    case "$COMMON_DIR" in
      /*) ;;
      *) COMMON_DIR="$WORKTREE_PATH/$COMMON_DIR" ;;
    esac
    EXCL="$COMMON_DIR/info/exclude"
    if [ -f "$EXCL" ] && grep -qxF '.gitnexus/' "$EXCL"; then
      sed -i.bak '/^\.gitnexus\/$/d' "$EXCL" 2>/dev/null && rm -f "${EXCL}.bak"
    fi
  fi
  mkdir -p "$WORKTREE_PATH/.gitnexus"
  ln -sfn "$PARENT_GNX/lbug" "$WORKTREE_PATH/.gitnexus/lbug"
  ln -sfn "$PARENT_GNX/meta.json" "$WORKTREE_PATH/.gitnexus/meta.json"
  # NB: no `gitnexus index <worktree>`. Each registration adds a duplicate global
  # registry entry labelled "canonical", which makes the `repo` resolver
  # ambiguous and breaks `gitnexus query/impact/context` REPO-WIDE (the
  # single-canonical-entry invariant — CLAUDE.md / OQ-5). Worktree agents use
  # `--repo canonical` (MCP repo:"canonical") → the single shared index; the
  # symlinks above keep CWD-based `gitnexus status` working locally.
  echo "  gitnexus: symlinked lbug + meta.json (shared index; not registered)" >&2
else
  echo "  Note: parent .gitnexus/{lbug,meta.json} absent — skipping index seed" >&2
fi

# --- .worktreeinclude (literal copies; skip .gitnexus*) ---

INCLUDE_FILE="$SOURCE_ROOT/.worktreeinclude"
COPIED=0
if [ -f "$INCLUDE_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="$(printf '%s' "$line" | awk '{$1=$1; print}')"
    [ -z "$line" ] && continue
    case "$line" in
      \#*) continue ;;
      .gitnexus*) continue ;;  # surgical handling above
    esac
    SRC="$SOURCE_ROOT/$line"
    DST="$WORKTREE_PATH/$line"
    [ -e "$SRC" ] || continue
    mkdir -p "$(dirname "$DST")"
    if cp -R "$SRC" "$DST" 2>/dev/null; then
      echo "  copy: $line" >&2
      COPIED=$((COPIED + 1))
    else
      echo "  Warning: .worktreeinclude copy failed for '$line'" >&2
    fi
  done < "$INCLUDE_FILE"
fi

echo "provision-worktree: done ($SYMLINKED symlinks, $COPIED copies)" >&2
