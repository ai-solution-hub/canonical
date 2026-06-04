#!/usr/bin/env bash
#
# lmdb-backup.sh — hot-snapshot the cocoindex LMDB engine store and ship it to S3.
# ID-66.14 (canonical-pipeline / on-prem B1). NEW ARTEFACT — surface-agnostic.
#
# WHY THIS EXISTS
#   Coolify's native S3 backups are database-only (scoped to a database_uuid) and do
#   NOT cover a raw named Docker volume (OQ-66-4). The cocoindex engine's LMDB memo
#   store lives on the `cocoindex-state` named volume (mounted at /cocoindex-state,
#   COCOINDEX_DB=/cocoindex-state/lmdb) and therefore needs its own backup job.
#
# CONSISTENCY MECHANISM (the load-bearing safety claim — inv 18)
#   This script snapshots with `mdb_copy -c`, NEVER with `cp`/`tar` of the live
#   data.mdb. `mdb_copy` copies THROUGH an LMDB read transaction: LMDB's MVCC
#   read-snapshot is immutable for the lifetime of that transaction regardless of
#   concurrent writes, so the copy is a CONSISTENT HOT SNAPSHOT — no container stop,
#   no quiesce, no write-pause. A naive `cp`/`tar` of a live data.mdb risks a
#   torn page (a write mid-flight straddling the copy) and is therefore NEVER
#   acceptable. The `-c` flag compacts the copy and drops free pages.
#
#   `mdb_copy` is a CLI tool shipped with liblmdb (Debian/Ubuntu package
#   `lmdb-utils`). It is NOT an importable library symbol. Install it on whichever
#   execution surface runs this script (see runbook {66.14}).
#
# SOURCE-PATH GOTCHA
#   cocoindex opens COCOINDEX_DB=/cocoindex-state/lmdb as a DIRECTORY env, so
#   `mdb_copy`'s source arg is that DIRECTORY (containing data.mdb + lock.mdb), not
#   the data.mdb file. (If the env were ever opened MDB_NOSUBDIR, the source would be
#   the data.mdb FILE and `mdb_copy` would need `-n`.) On first run, verify the dir
#   layout: `ls "$LMDB_SRC"` should print `data.mdb  lock.mdb`. This script asserts
#   data.mdb is present and copies the directory form.
#
# EXECUTION SURFACES (surface-agnostic — pick one at schedule time; see runbook)
#   (a) Coolify scheduled task inside the cocoindex container — NOT viable as-is:
#       the slim buildpack image ships no mdb_copy / aws / zstd.
#   (b) Host cron + a throwaway tooling container that bind-mounts the on-host volume
#       path read-only and carries lmdb-utils + awscli — RECOMMENDED.
#   (c) Host cron directly, if lmdb-utils + awscli are installed on the IONOS host.
#
# CONFIGURATION (env-driven; defaults in [brackets])
#   LMDB_SRC              Directory containing data.mdb/lock.mdb [/cocoindex-state/lmdb]
#   SNAPSHOT_DIR          Scratch dir for the mdb_copy snapshot   [auto: mktemp -d]
#   BACKUP_S3_BUCKET      Target S3 bucket name                   (REQUIRED — no default)
#   BACKUP_S3_PREFIX      Key prefix within the bucket            [lmdb/cocoindex-state]
#   BACKUP_ENV_LABEL      <env> path segment in the object key    [production]
#   AWS_ENDPOINT_URL      S3-compatible endpoint (non-AWS S3)     [unset → AWS S3]
#   AWS_REGION            S3 region                               [unset → SDK default]
#   AWS_ACCESS_KEY_ID     S3 credential                           (from env/instance role)
#   AWS_SECRET_ACCESS_KEY S3 credential                           (from env/instance role)
#
#   Object key written:
#     s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/${BACKUP_ENV_LABEL}/lmdb-<UTC-ISO8601>.tar.<zst|gz>
#
# SUPABASE: this script touches Supabase NOT AT ALL (inv 20). The LMDB store is the
#   cocoindex engine's memo cache; Supabase remains the canonical data store. A
#   missing/stale snapshot costs only a memo-state rebuild on the next ingest — never
#   KH data loss.
#
# NOT ARMED — this file is the ARTEFACT ONLY. It adds no cron entry, no Coolify
#   scheduled task, no real bucket names, and no real credentials. Activation (S3
#   bucket + creds + schedule + retention) is OPERATOR-GATED. See the {66.14} section
#   of docs/runbooks/onprem-b1-deploy.md for the operator activation checklist.

set -euo pipefail

# --- Configuration (env-driven with defaults) --------------------------------
LMDB_SRC="${LMDB_SRC:-/cocoindex-state/lmdb}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-lmdb/cocoindex-state}"
BACKUP_ENV_LABEL="${BACKUP_ENV_LABEL:-production}"

# SNAPSHOT_DIR: if the caller did not provide one, create a fresh temp dir and mark
# it as owned-by-us so the EXIT trap removes it. A caller-supplied dir is left alone.
OWN_SNAPSHOT_DIR=0
if [[ -z "${SNAPSHOT_DIR:-}" ]]; then
  SNAPSHOT_DIR="$(mktemp -d)"
  OWN_SNAPSHOT_DIR=1
fi

# TARBALL is created in the system temp dir and always cleaned up by the trap.
TARBALL=""

# --- Cleanup trap: runs on EXIT (success OR failure) -------------------------
cleanup() {
  # Remove the snapshot dir only if we created it.
  if [[ "${OWN_SNAPSHOT_DIR}" -eq 1 && -n "${SNAPSHOT_DIR:-}" && -d "${SNAPSHOT_DIR}" ]]; then
    rm -rf -- "${SNAPSHOT_DIR}"
  fi
  # Remove the local tarball if it was created.
  if [[ -n "${TARBALL}" && -f "${TARBALL}" ]]; then
    rm -f -- "${TARBALL}"
  fi
}
trap cleanup EXIT

# --- Logging helpers ---------------------------------------------------------
log() { printf '[lmdb-backup] %s\n' "$*" >&2; }
die() { printf '[lmdb-backup] ERROR: %s\n' "$*" >&2; exit 1; }

# --- Preconditions: fail loudly ----------------------------------------------
if ! command -v mdb_copy >/dev/null 2>&1; then
  die "mdb_copy not found. Install the liblmdb CLI tools (Debian/Ubuntu: 'apt-get install lmdb-utils')."
fi

if ! command -v aws >/dev/null 2>&1; then
  die "aws not found. Install the AWS CLI ('pip install awscli' or distro package 'awscli')."
fi

if [[ -z "${BACKUP_S3_BUCKET:-}" ]]; then
  die "BACKUP_S3_BUCKET is required but unset. Set it to the S3 bucket Coolify already targets for DB backups."
fi

if [[ ! -d "${LMDB_SRC}" ]]; then
  die "LMDB_SRC '${LMDB_SRC}' does not exist or is not a directory."
fi

if [[ ! -f "${LMDB_SRC}/data.mdb" ]]; then
  die "LMDB_SRC '${LMDB_SRC}' contains no data.mdb (expected 'data.mdb' and 'lock.mdb'; run 'ls \"${LMDB_SRC}\"' to inspect)."
fi

# --- Hot snapshot via mdb_copy (consistent, no quiesce) ----------------------
# `mdb_copy -c <src-dir> <dst-dir>` copies through an LMDB read transaction and
# compacts. SNAPSHOT_DIR must be EMPTY for mdb_copy to write data.mdb into it.
if [[ -n "$(ls -A -- "${SNAPSHOT_DIR}" 2>/dev/null)" ]]; then
  die "SNAPSHOT_DIR '${SNAPSHOT_DIR}' is not empty; mdb_copy requires an empty destination."
fi

log "Snapshotting LMDB env '${LMDB_SRC}' -> '${SNAPSHOT_DIR}' (mdb_copy -c, consistent hot copy)."
mdb_copy -c "${LMDB_SRC}" "${SNAPSHOT_DIR}"

if [[ ! -f "${SNAPSHOT_DIR}/data.mdb" ]]; then
  die "mdb_copy produced no data.mdb in '${SNAPSHOT_DIR}'; snapshot failed."
fi

# --- Package: zstd if available, else gzip -----------------------------------
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if command -v zstd >/dev/null 2>&1; then
  COMPRESS_EXT="zst"
  COMPRESS_FLAG="--zstd"
else
  log "zstd not found; falling back to gzip."
  COMPRESS_EXT="gz"
  COMPRESS_FLAG="--gzip"
fi

OBJECT_NAME="lmdb-${TIMESTAMP}.tar.${COMPRESS_EXT}"
TARBALL="$(mktemp -t "lmdb-backup.XXXXXX.tar.${COMPRESS_EXT}")"

log "Packaging snapshot -> '${TARBALL}' (${COMPRESS_EXT})."
# -C into the snapshot dir and tar '.' so the archive holds the env files at the
# top level (data.mdb), keeping the restore untar target-path simple.
tar "${COMPRESS_FLAG}" -cf "${TARBALL}" -C "${SNAPSHOT_DIR}" .

# --- Ship to S3 --------------------------------------------------------------
S3_URI="s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/${BACKUP_ENV_LABEL}/${OBJECT_NAME}"

# Assemble optional aws flags (endpoint URL for non-AWS S3; region if set).
AWS_ARGS=()
if [[ -n "${AWS_ENDPOINT_URL:-}" ]]; then
  AWS_ARGS+=(--endpoint-url "${AWS_ENDPOINT_URL}")
fi
if [[ -n "${AWS_REGION:-}" ]]; then
  AWS_ARGS+=(--region "${AWS_REGION}")
fi

log "Uploading -> '${S3_URI}'."
aws "${AWS_ARGS[@]}" s3 cp "${TARBALL}" "${S3_URI}"

log "Backup complete: ${S3_URI}"
