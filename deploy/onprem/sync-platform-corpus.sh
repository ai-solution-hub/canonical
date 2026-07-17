#!/usr/bin/env bash
#
# sync-platform-corpus.sh — ID-134 {134.4} BI-6 vendored→on-prem corpus bridge.
# canonical-pipeline / Platform-production on-prem (ca-cocoindex-platform).
#
# WHAT THIS IS (TECH.md §3 step 6 + RATIFY-1):
#   The Platform seam-coverage corpus is VENDORED in-repo at
#   scripts/cocoindex_pipeline/fixtures/platform-corpus/ (RATIFY-1: the single
#   byte-identical, checkout-reproducible source of truth — the gate's entire
#   purpose is reproducibility, so the corpus must NOT live local-only on one
#   operator's Mac). This script is the BI-6 bridge that carries that vendored
#   tree onto the on-prem named volume in two hops:
#
#     Hop A (runs locally / anywhere with the checkout):
#       vendored tree  ──rsync──>  derived working copy
#       scripts/cocoindex_pipeline/fixtures/platform-corpus/
#         ──>  <repo-parent>/local-fs-platform/corpus      (byte-identical)
#       The external local-fs-platform/corpus is a DERIVED copy (RATIFY-1); it
#       is never the source of truth. rsync --delete makes the dest a byte-exact
#       mirror (extras such as stray .DS_Store placeholders are pruned), and a
#       post-sync `diff -r` self-check fails loud if the copy is not identical.
#
#     Hop B (runs ON the deploy host — staged onto the named volume):
#       derived copy  ──docker cp──>  /cocoindex-state/corpus
#       <derived>/.  ──>  ca-cocoindex-platform:/cocoindex-state/corpus
#       The compose mounts ca-cocoindex-platform-state:/cocoindex-state
#       (docker-compose.platform.yaml ~L180); the image does NOT carry the
#       corpus (onprem-deploy.yml leaves COCOINDEX_SOURCE_PATH to Coolify), so
#       the corpus MUST be staged onto the volume by this hop. After staging,
#       COCOINDEX_SOURCE_PATH must point at /cocoindex-state/corpus (Coolify env,
#       docker-compose.platform.yaml ~L133, default empty) and a supervised
#       POST /walk ingests it (GREENFIELD runbook step 7b pattern).
#
# IDEMPOTENCE (mirrors live-verify.sh step 0b):
#   The `docker cp <src>/. <c>:<dst>` form copies the CONTENTS of <src> into
#   <dst>, so re-runs overwrite in place. A bare `docker cp <src> <c>:<dst>`
#   would NEST a second corpus/ level on re-run — do NOT "simplify" this form.
#   Hop A's `rsync --delete` is likewise re-runnable: a second run is a no-op
#   delta (no diff drift, no nesting).
#
# USAGE:
#   deploy/onprem/sync-platform-corpus.sh [--dest <path>] [--on-prem] [--print-hop-b] [-h]
#
#   (default)        run Hop A only — sync vendored tree → derived copy + verify.
#   --dest <path>    override the derived-copy destination
#                    (default: <repo-parent>/local-fs-platform/corpus;
#                     also settable via PLATFORM_CORPUS_DEST env).
#   --on-prem        run Hop A, then Hop B (docker cp onto the volume). Intended
#                    to be run ON the deploy host only; needs a reachable docker
#                    daemon and the ca-cocoindex-platform container.
#   --print-hop-b    print the exact Hop B docker-cp invocation (no execution)
#                    so an operator can run it manually under supervision.
#   -h | --help      this help.
#
# ENV (Hop B):
#   COCOINDEX_CONTAINER   container name (default: ca-cocoindex-platform).
#   COCOINDEX_CORPUS_DIR  on-volume corpus dir (default: /cocoindex-state/corpus).
#
set -euo pipefail

log()  { printf '%s %s\n' "[sync-platform-corpus]" "$*" >&2; }
die()  { printf '%s ERROR: %s\n' "[sync-platform-corpus]" "$*" >&2; exit 1; }

# ── Resolve the vendored source robustly ────────────────────────────────────
# Prefer `git rev-parse --show-toplevel` from the script's own location (works
# from any canonical checkout at deploy time — NOT a hardcoded worktree path);
# fall back to the script-location-relative path if git is unavailable.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)"; then
  :
else
  # deploy/onprem/sync-platform-corpus.sh → repo root is two levels up.
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

VENDORED_SRC="${REPO_ROOT}/scripts/cocoindex_pipeline/fixtures/platform-corpus"

# Derived-copy destination: sibling of the repo root by default, overridable.
DEST_DEFAULT="$(cd "$REPO_ROOT/.." && pwd)/local-fs-platform/corpus"
DEST="${PLATFORM_CORPUS_DEST:-$DEST_DEFAULT}"

COCOINDEX_CONTAINER="${COCOINDEX_CONTAINER:-ca-cocoindex-platform}"
COCOINDEX_CORPUS_DIR="${COCOINDEX_CORPUS_DIR:-/cocoindex-state/corpus}"

RUN_HOP_B=0
PRINT_HOP_B=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)        DEST="${2:?--dest needs a path}"; shift 2 ;;
    --on-prem)     RUN_HOP_B=1; shift ;;
    --print-hop-b) PRINT_HOP_B=1; shift ;;
    -h|--help)     sed -n '2,60p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             die "unknown argument: $1 (try --help)" ;;
  esac
done

print_hop_b() {
  # The canonical, idempotent Hop B invocation. The `/.` source suffix copies
  # CONTENTS (idempotent); a bare `docker cp <dest> <c>:<dir>` NESTS on re-run.
  # printf (not a heredoc) so this works even where $TMPDIR is locked down.
  printf '%s\n' \
    '# ── Hop B — stage the derived copy onto the on-prem named volume ─────────────' \
    '# Run ON the deploy host (needs the docker daemon + the platform container).' \
    "# Mirrors live-verify.sh step 0b's docker-cp shape (the '/.' CONTENTS form)." \
    "docker exec ${COCOINDEX_CONTAINER} mkdir -p ${COCOINDEX_CORPUS_DIR}" \
    "docker cp \"${DEST}/.\" \"${COCOINDEX_CONTAINER}:${COCOINDEX_CORPUS_DIR}\"" \
    '# Then point the engine at it and trigger one supervised walk:' \
    "#   Coolify env: COCOINDEX_SOURCE_PATH=${COCOINDEX_CORPUS_DIR}" \
    "#   POST /walk (PIPELINE_TRIGGER_SECRET bearer) — watch 'docker logs -f ${COCOINDEX_CONTAINER}';" \
    "#   kill-switch is 'docker stop ${COCOINDEX_CONTAINER}' (GREENFIELD runbook step 7b)."
}

# ── Hop A — vendored tree → derived working copy (byte-identical) ────────────
[[ -d "$VENDORED_SRC" ]] || die "vendored corpus not found at ${VENDORED_SRC} — is this a full canonical checkout?"

log "Hop A: vendored ${VENDORED_SRC}"
log "   →   derived  ${DEST}"
mkdir -p "$DEST"

# Trailing-slash form: copy the CONTENTS of the source into DEST. --delete prunes
# any extras (e.g. stray .DS_Store) so DEST becomes a byte-exact mirror; --archive
# preserves the bytes. Re-runs are no-op deltas (idempotent — no nesting/drift).
rsync --archive --delete "${VENDORED_SRC}/" "${DEST}/" \
  || die "rsync of the vendored corpus failed"

# Self-check: the derived copy MUST be byte-identical to the vendored source.
if ! diff -r "$VENDORED_SRC" "$DEST" >/dev/null; then
  diff -r "$VENDORED_SRC" "$DEST" >&2 || true
  die "post-sync diff is non-empty — derived copy is NOT byte-identical to the vendored source"
fi
log "Hop A OK — derived copy is byte-identical (diff -r empty)."

# ── Hop B — documented by default; executed only with --on-prem ──────────────
if [[ "$PRINT_HOP_B" -eq 1 ]]; then
  print_hop_b
fi

if [[ "$RUN_HOP_B" -eq 1 ]]; then
  command -v docker >/dev/null 2>&1 || die "--on-prem needs docker on PATH (run this on the deploy host)"
  log "Hop B: staging derived copy → ${COCOINDEX_CONTAINER}:${COCOINDEX_CORPUS_DIR} (docker cp)"
  docker exec "${COCOINDEX_CONTAINER}" mkdir -p "${COCOINDEX_CORPUS_DIR}" \
    || die "could not create ${COCOINDEX_CORPUS_DIR} in ${COCOINDEX_CONTAINER}"
  docker cp "${DEST}/." "${COCOINDEX_CONTAINER}:${COCOINDEX_CORPUS_DIR}" \
    || die "docker cp of the derived corpus failed"
  log "Hop B OK — corpus staged. Set COCOINDEX_SOURCE_PATH=${COCOINDEX_CORPUS_DIR} (Coolify) then POST /walk (supervised)."
fi

log "done."
