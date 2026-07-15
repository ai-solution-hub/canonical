#!/usr/bin/env bash
#
# regen-mirrors.sh — regenerate the ledger per-record mirrors locally, as ONE
# idempotent command.
#
# Why: every session that edits task-list.json / initiatives.json /
# product-backlog.json / product-retros.json must regenerate
# ledgers/{tasks,backlog,initiatives,retros}/ so the mirrors stay in sync.
# Doing that by hand means re-cloning task-view and re-running `bun install`
# each session (recurring S264/S265 friction — the clone's node_modules is
# not persisted). This script removes that:
#   • clones task-view @ TASK_VIEW_TAG only if the tag-keyed cache is missing
#   • runs `bun install` only if node_modules is absent
#   • regenerates ALL FOUR ledgers' mirrors via task-view.js (--check, one
#     shot per ledger — server-owned mirror generation, ID-148.12). The
#     ID-148.9 KH-native generate-{initiatives,retros}-mirror.ts scripts are
#     SUPERSEDED: task-view's mirror-generator gained an initiatives arm
#     (nested render, repurposed roadmap arm) + a retros arm (removed from
#     the mirror-exclusion set) at {148.10} — Option C moves generation for
#     ALL FOUR ledgers server-side, matching task-list/backlog.
#   • reports drift LOCALLY/INFORMATIONALLY — there is no CI byte-parity gate
#     (the `ledger-mirror-parity` job was retired under ID-68.35 when the
#     ledgers moved to docs-site; the earlier "CI is the gate" framing here
#     was stale)
#
# Single source of truth for the tag is .github/workflows/ci.yml — parsed below
# so this script and CI never diverge. Override with env vars when needed:
#   TASK_VIEW_TAG=<tag>     pin a different release
#   TASK_VIEW_DIR=<path>    reuse an existing working clone (skips the cache)
#
# Spec lineage: docs/specs/id-20-per-task-mirror/TECH.md §3.5/§6.4; S265 retro #3b.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# --- resolve the tag (override > ci.yml literal) -----------------------------
TAG="${TASK_VIEW_TAG:-}"
if [ -z "$TAG" ]; then
  TAG="$(grep -m1 'TASK_VIEW_TAG:' .github/workflows/ci.yml \
    | sed 's/.*TASK_VIEW_TAG:[[:space:]]*//' | tr -d '[:space:]')"
fi
if [ -z "$TAG" ]; then
  echo "error: could not resolve TASK_VIEW_TAG (set it explicitly)" >&2
  exit 1
fi

# --- resolve the clone dir (override > tag-keyed cache) ----------------------
# Tag-keyed so switching releases naturally uses a fresh dir; reuse is implicit.
DIR="${TASK_VIEW_DIR:-$REPO/.cache/task-view-$TAG}"

echo "→ task-view: tag=$TAG dir=$DIR"

# --- clone-if-missing --------------------------------------------------------
if [ ! -d "$DIR/.git" ]; then
  echo "→ cloning task-view @ $TAG"
  rm -rf "$DIR"
  mkdir -p "$(dirname "$DIR")"
  # Two distinct silencers — both target stderr advisory noise (clone never
  # touches stdout, so ledger-cli's JSON envelope contract was never at risk;
  # this is purely a UX fix for interactive operator use):
  #   --quiet                     drops `Cloning into '...'` + `done.` progress.
  #   -c advice.detachedHead=false suppresses the "Note: switching to..." +
  #                               "You are in 'detached HEAD' state..." block
  #                               that `--branch <TAG>` triggers because TAG
  #                               is a release tag, not a branch ref. `--quiet`
  #                               alone does NOT suppress this advisory.
  # Genuine errors (network, auth, missing tag) still hit stderr. ID-35.33.
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$TAG" \
    https://github.com/liam-jons/task-view.git "$DIR"
else
  echo "→ reusing cached clone"
fi

# --- bun-install-if-missing --------------------------------------------------
if [ ! -d "$DIR/node_modules" ]; then
  echo "→ bun install (task-view deps)"
  # --silent suppresses bun's package-install line noise (interactive UX fix
  # for first session write); genuine errors still hit stderr. ID-35.33.
  (cd "$DIR" && bun install --silent)
else
  echo "→ node_modules present (skip install)"
fi

# --- resolve the relocated ledger dir (ID-68.35) -----------------------------
# The ledger JSONs + mirror dirs moved OUT of the public repo's docs/reference/
# into the PRIVATE knowledge-hub-docs-site checkout at src/content/docs/ledgers/.
# Fail-closed: error LOUD if KH_PRIVATE_DOCS_DIR is unset (no stale in-repo path).
LEDGER_DIR="${KH_PRIVATE_DOCS_DIR:?KH_PRIVATE_DOCS_DIR must be set (ID-68.35 ledger relocation)}/src/content/docs/ledgers"

# --- regenerate ALL FOUR ledgers' mirrors via task-view.js (server-owned) ---
# ID-148.12: initiatives + retros now regen via the SAME --check one-shot
# path as task-list/backlog (task-view's mirror-generator gained both arms
# at {148.10}) — the KH-native generate-{initiatives,retros}-mirror.ts
# scripts (ID-148.9) are SUPERSEDED and deleted. `--check <path>` is
# filename-agnostic — it detects the document kind via `document_name`, not
# the filename, so each ledger regenerates through the identical mechanism.
echo "→ regenerating mirrors (--check x4, server-owned)"
node "$DIR/bin/task-view.js" --check "$LEDGER_DIR/task-list.json"
node "$DIR/bin/task-view.js" --check "$LEDGER_DIR/product-backlog.json"
node "$DIR/bin/task-view.js" --check "$LEDGER_DIR/initiatives.json"
node "$DIR/bin/task-view.js" --check "$LEDGER_DIR/product-retros.json"

# --- report drift (informational — no CI byte-parity job exists; the
# `ledger-mirror-parity` job was retired under ID-68.35 when the ledgers moved
# to docs-site. Mirror parity is server-side-regen (task-list/backlog, on
# every server write) plus this local hook only) ------------------------------
# Use `git status --porcelain` (not `git diff`) so NEW mirrors for added records
# are surfaced too — `git diff` ignores untracked files, so a freshly-added
# Task's mirror (e.g. a new ID-NN.md) would otherwise be silently missed.
MIRROR_DIRS=("$LEDGER_DIR/tasks" "$LEDGER_DIR/backlog" "$LEDGER_DIR/initiatives" "$LEDGER_DIR/retros")
# git must run in the DOCS-SITE repo (the ledger relocation moved the mirror
# dirs out of this repo — a bare `git status` here fatals with "outside
# repository"; WS-B3 fix).
DRIFT="$(git -C "$KH_PRIVATE_DOCS_DIR" status --porcelain -- "${MIRROR_DIRS[@]}")"
if [ -z "$DRIFT" ]; then
  echo "✓ mirrors in sync — no drift"
else
  echo "✎ mirrors regenerated — review + stage (M = changed, ?? = new):"
  echo "$DRIFT"
fi
