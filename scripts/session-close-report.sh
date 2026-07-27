#!/usr/bin/env bash
# session-close-report.sh — emit the mechanically-derivable session-close state for the
# handoff continuation prompt's "Mechanical state (auto-generated)" section (Task δ,
# CA-S430 workflow-continuity-repair). Read-only.
# Run from the canonical repo root: `bash scripts/session-close-report.sh`.
#
# Worktree coverage (S499 T7). `git worktree list` only ever reports the clone family
# you run it from. This machine keeps more than one independent clone of canonical, and
# every Intent-workspace worktree hangs off exactly one of them — so the bare call used
# to hide whichever family the session was not standing in. Both orphaned subtasks found
# in S498/S499 were sitting in that blind spot. The report now enumerates every clone
# root it can discover and flags Intent workspace dirs holding a checkout that no clone
# still registers.
#
# SAFETY: this script never runs a git command *inside* an unregistered checkout. A
# stale checkout's `.git` file can still point at an admin dir that git has since
# re-registered to a different, live worktree; running git there shares (and refreshes)
# that live worktree's index and HEAD. Unregistered dirs are inspected by reading their
# `.git` file as text only.
set -uo pipefail

ts="$(date -u +%Y-%m-%dT%H:%MZ)"

# Intent workspace root. Override for a non-default Intent install.
INTENT_WORKSPACES_DIR="${INTENT_WORKSPACES_DIR:-$HOME/intent/workspaces}"

# Depth-1 parents searched for sibling clones that share this repo's `origin`. This IS a
# machine-layout guess and cannot be avoided: two independent clones of the same remote
# have no mechanical link to each other on disk. Override with
# CANONICAL_CLONE_SEARCH_DIRS (space-separated), or bypass discovery entirely with
# CANONICAL_CLONE_ROOTS (colon-separated, explicit).
CANONICAL_CLONE_SEARCH_DIRS="${CANONICAL_CLONE_SEARCH_DIRS:-$HOME/Developer $HOME/Documents/development $HOME/src $HOME/code $HOME/projects}"

roots=''

add_root() {
  r="$1"
  [ -n "$r" ] || return 0
  [ -d "$r" ] || return 0
  printf '%s\n' "$roots" | grep -Fxq "$r" && return 0
  roots="${roots}${r}
"
}

# Absolute clone root of the repo containing $1 (a worktree resolves to its parent clone).
clone_root_of() {
  d="$1"
  common="$(cd "$d" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null)" || return 1
  [ -n "$common" ] || return 1
  common="$(cd "$d" 2>/dev/null && cd "$common" 2>/dev/null && pwd)" || return 1
  printf '%s\n' "${common%/.git}"
}

origin_of() { git -C "$1" remote get-url origin 2>/dev/null; }

if [ -n "${CANONICAL_CLONE_ROOTS:-}" ]; then
  # Explicit override — exclusive, discovery is skipped entirely.
  _oifs="$IFS"
  IFS=:
  for r in $CANONICAL_CLONE_ROOTS; do
    IFS="$_oifs"
    add_root "$r"
    IFS=:
  done
  IFS="$_oifs"
else
  # 1. This repo's own clone root.
  add_root "$(clone_root_of . 2>/dev/null)"

  # 2. Every Intent-workspace checkout points back at its clone via its `.git` file.
  for gf in "$INTENT_WORKSPACES_DIR"/*/*/.git; do
    [ -f "$gf" ] || continue
    gd="$(sed -n 's/^gitdir: //p' "$gf" | head -1)"
    case "$gd" in
      */.git/worktrees/*) add_root "${gd%%/.git/worktrees/*}" ;;
    esac
  done

  # 3. Sibling clones sharing this repo's origin.
  self_origin="$(origin_of .)"
  if [ -n "$self_origin" ]; then
    for parent in $CANONICAL_CLONE_SEARCH_DIRS; do
      [ -d "$parent" ] || continue
      for cand in "$parent"/*/; do
        cand="${cand%/}"
        [ -d "$cand/.git" ] || continue
        [ "$(origin_of "$cand")" = "$self_origin" ] || continue
        add_root "$cand"
      done
    done
  fi
fi

# Registered worktree paths across every discovered root.
registered=''
while IFS= read -r root; do
  [ -n "$root" ] || continue
  registered="${registered}$(git -C "$root" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p')
"
done <<EOF
$roots
EOF

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
if [ -z "${roots//[[:space:]]/}" ]; then
  echo '(no clone roots discovered)'
else
  while IFS= read -r root; do
    [ -n "$root" ] || continue
    echo "# clone root: $root"
    git -C "$root" worktree list 2>/dev/null | sed 's/^/  /' || echo '  (unreadable)'
    echo
  done <<EOF
$roots
EOF
fi
echo '```'
echo

echo "### Intent workspace lifecycle (dirs with no registered worktree)"
echo '```'
if [ ! -d "$INTENT_WORKSPACES_DIR" ]; then
  echo "(no Intent workspaces dir at $INTENT_WORKSPACES_DIR)"
else
  ghosts=0
  bare=0
  for wsdir in "$INTENT_WORKSPACES_DIR"/*/; do
    wsdir="${wsdir%/}"
    [ -d "$wsdir" ] || continue
    ws_has_checkout=0
    for sub in "$wsdir"/*/; do
      sub="${sub%/}"
      [ -e "$sub/.git" ] || continue
      ws_has_checkout=1
      printf '%s\n' "$registered" | grep -Fxq "$sub" && continue
      ghosts=$((ghosts + 1))
      echo "UNREGISTERED checkout: $sub"
      if [ -f "$sub/.git" ]; then
        admin="$(sed -n 's/^gitdir: //p' "$sub/.git" | head -1)"
        echo "  admin dir: ${admin:-?}"
        if [ -f "$admin/gitdir" ]; then
          owner="$(sed -n '1s|/\.git$||p' "$admin/gitdir")"
          if [ -n "$owner" ] && [ "$owner" != "$sub" ]; then
            echo "  !! ALIASES a live worktree: $owner"
            echo "     (that admin dir was re-registered; git run here shares ITS index/HEAD)"
          fi
        else
          echo "  admin dir missing — checkout is fully detached from its clone"
        fi
      else
        echo "  (independent clone, not a worktree)"
      fi
    done
    if [ "$ws_has_checkout" -eq 0 ]; then
      bare=$((bare + 1))
      echo "NO CHECKOUT: $wsdir  (scaffold-only — nothing to orphan)"
    fi
  done
  echo
  echo "summary: ${ghosts} unregistered checkout(s), ${bare} scaffold-only workspace dir(s)"
  if [ "$ghosts" -gt 0 ]; then
    echo
    echo "Pre-reset audit recipe for an unregistered/dirty checkout (do NOT reset or"
    echo "remove first, and never 'git stash' — the stash ref list is global across"
    echo "worktrees):"
    echo "  1. Read its .git file as text to find the clone + admin dir. If the admin"
    echo "     dir is registered elsewhere, treat every git read as touching THAT"
    echo "     worktree; use 'git --no-optional-locks' so the shared index is not"
    echo "     refreshed."
    echo "  2. Diff against the LOCAL checkout HEAD, not origin/main — the local tree"
    echo "     is what the orphaned session actually branched from."
    echo "       git --no-optional-locks -C <dir> diff --numstat HEAD | sort -k1 -rn"
    echo "  3. Rank files by lines unique to the workspace; read the top of that list"
    echo "     first. Untracked paths matter most:"
    echo "       git --no-optional-locks -C <dir> status --porcelain | grep '^??'"
    echo "  4. For each candidate, check whether it is NEW work or an OLD snapshot:"
    echo "       git log --oneline --diff-filter=D -- <path>   # deleted from main => stale"
    echo "       git log --oneline --diff-filter=A -- <path>   # never on main  => orphan"
    echo "  5. Hand-filter the hunks for stale reversions before rescuing anything."
    echo "  6. Raise what survives as its own task with the evidence. Removal is"
    echo "     owner-gated and needs a 'git status' on the record first."
  fi
fi
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
