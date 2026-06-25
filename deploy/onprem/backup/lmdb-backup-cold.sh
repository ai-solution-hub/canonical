#!/usr/bin/env bash
#
# lmdb-backup-cold.sh — COLD-snapshot the cocoindex LMDB memo store and ship it to S3.
# ID-66.14 (canonical-pipeline / on-prem B1).
#
# WHY COLD (and not the mdb_copy hot snapshot in lmdb-backup.sh)
#   cocoindex's Rust engine bundles an LMDB whose on-disk lock/format the distro
#   `mdb_copy` CANNOT open — tested empirically with lmdb-utils 0.9.24 (Debian
#   bookworm) AND 0.9.31 (Debian trixie), both fail at env-open with
#   `MDB_VERSION_MISMATCH (-30794)`, even though the data file is unmistakably
#   standard LMDB (meta magic 0xBEEFC0DE, data version 1). Rather than pin + build
#   cocoindex's exact bundled LMDB just to obtain a compatible `mdb_copy`, we take a
#   CONSISTENT COLD snapshot: stop the container (quiesce the env so no writer can
#   tear a page), file-copy the tiny store, restart the container IMMEDIATELY, then
#   tar + ship. Justified because:
#     - the LMDB is a NON-CRITICAL memo cache (inv 20/25 — loss costs only a memo
#       rebuild on the next ingest, NEVER KH data loss; Supabase is canonical);
#     - it is ~256 KiB, so the copy is milliseconds;
#     - the worker boots lifespan-only (ID-83 / bl-221 — NO corpus walk at boot),
#       so the stop/start window is a couple of seconds and recovers into a
#       non-walking idle worker.
#   The container is ALWAYS restarted (EXIT trap), even if the copy/upload fails.
#
# DESIGN: the HOST does the quiesce + copy (it needs only `docker` + `cp`); the
#   tar + S3 upload run inside the canonical-lmdb-backup-tools sidecar image (it carries
#   awscli + zstd), so the host needs NO awscli (Ubuntu 24.04 dropped the package)
#   and the host shell never sees the secret VALUES — they reach the sidecar only
#   via `docker run --env-file`.
#
# CONFIG (env)
#   APP_UUID            Coolify app uuid — resolves BOTH the running container name
#                       (suffix changes per redeploy) and the on-host volume path. REQUIRED.
#   SECRETS_ENV_FILE    Host env-file with BACKUP_S3_BUCKET + AWS_* [/root/canonical-secrets/lmdb-backup.env].
#   TOOLING_IMAGE       Upload sidecar image [canonical-lmdb-backup-tools:latest].
#   COCOINDEX_CONTAINER / LMDB_HOST_DIR   Optional explicit overrides.
#   LMDB_VOLUME_NAME    Docker volume suffix (Coolify names volumes <APP_UUID>_<name>);
#                       differs per app, so set it per env [cocoindex-state].
#   (in the env-file:) BACKUP_S3_BUCKET (req), BACKUP_S3_PREFIX [lmdb/cocoindex-state],
#                       BACKUP_ENV_LABEL [production], AWS_ENDPOINT_URL, AWS_REGION,
#                       AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
#
#   Object key:  s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/${BACKUP_ENV_LABEL}/lmdb-<UTC-ISO8601>.tar.zst
#
# See the {66.14} section of docs/runbooks/onprem-b1-deploy.md for activation.
set -euo pipefail

log() { printf '[lmdb-cold] %s\n' "$*" >&2; }
die() { printf '[lmdb-cold] ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found."
: "${APP_UUID:?APP_UUID is required (the Coolify app uuid).}"
SECRETS_ENV_FILE="${SECRETS_ENV_FILE:-/root/canonical-secrets/lmdb-backup.env}"
TOOLING_IMAGE="${TOOLING_IMAGE:-canonical-lmdb-backup-tools:latest}"
[[ -f "${SECRETS_ENV_FILE}" ]] || die "secrets env-file not found: ${SECRETS_ENV_FILE}"

# Coolify names the container cocoindex-<app-slug>-<APP_UUID>-<random>; the UUID is the
# only stable, unique token (the random suffix changes per redeploy), so filter on it.
COCOINDEX_CONTAINER="${COCOINDEX_CONTAINER:-$(docker ps --filter "name=${APP_UUID}" --format '{{.Names}}' | head -1)}"
[[ -n "${COCOINDEX_CONTAINER}" ]] || die "no running cocoindex container for app ${APP_UUID}."
# cocoindex 1.x nests the LMDB env one level under COCOINDEX_DB=/cocoindex-state/lmdb.
# LMDB_VOLUME_NAME is the docker volume suffix; it differs per app — e.g.
# ca-cocoindex-platform-state (prod) vs ca-cocoindex-platform-staging-state (staging).
# Override LMDB_HOST_DIR directly to bypass the constructed path entirely.
LMDB_VOLUME_NAME="${LMDB_VOLUME_NAME:-cocoindex-state}"
LMDB_HOST_DIR="${LMDB_HOST_DIR:-/var/lib/docker/volumes/${APP_UUID}_${LMDB_VOLUME_NAME}/_data/lmdb/mdb}"
[[ -f "${LMDB_HOST_DIR}/data.mdb" ]] || die "no data.mdb in ${LMDB_HOST_DIR}."

# --- Tooling image: rebuild if missing -----------------------------------------
# The sidecar image is built locally on the host and NEVER pushed to a registry, so a
# `docker run` of a pruned image fails on an unrecoverable registry pull. Coolify's
# scheduled `force_docker_cleanup` prunes images with no running container — which the
# idle backup sidecar always is between nightly runs — so the image silently vanishes
# and the cron then stops/restarts the cocoindex container but ships NOTHING. Rebuild
# it from the co-located Dockerfile.tools BEFORE we quiesce the container, so a build
# failure never costs a stop/start window.
if ! docker image inspect "${TOOLING_IMAGE}" >/dev/null 2>&1; then
  DOCKERFILE_TOOLS="${DOCKERFILE_TOOLS:-$(dirname "$0")/Dockerfile.tools}"
  [[ -f "${DOCKERFILE_TOOLS}" ]] || die "tooling image ${TOOLING_IMAGE} missing and no Dockerfile.tools at ${DOCKERFILE_TOOLS} to rebuild from."
  log "Tooling image ${TOOLING_IMAGE} missing (likely pruned by Coolify cleanup) — rebuilding from ${DOCKERFILE_TOOLS}."
  docker build -t "${TOOLING_IMAGE}" -f "${DOCKERFILE_TOOLS}" "$(dirname "${DOCKERFILE_TOOLS}")" >&2 \
    || die "failed to rebuild tooling image ${TOOLING_IMAGE}."
fi

SNAP="$(mktemp -d)"
STOPPED=0
cleanup() {
  if [[ "${STOPPED}" -eq 1 ]]; then
    docker start "${COCOINDEX_CONTAINER}" >/dev/null 2>&1 \
      || log "WARN: failed to restart ${COCOINDEX_CONTAINER} — CHECK THE HOST MANUALLY."
  fi
  [[ -d "${SNAP}" ]] && rm -rf -- "${SNAP}" || true
}
trap cleanup EXIT

# --- Cold copy: stop -> copy data.mdb -> restart immediately ------------------
log "Stopping ${COCOINDEX_CONTAINER} for a consistent cold copy."
docker stop "${COCOINDEX_CONTAINER}" >/dev/null
STOPPED=1
# Only data.mdb — lock.mdb is transient (LMDB recreates it on next open).
cp -a "${LMDB_HOST_DIR}/data.mdb" "${SNAP}/data.mdb"
log "Copy complete; restarting ${COCOINDEX_CONTAINER}."
docker start "${COCOINDEX_CONTAINER}" >/dev/null
STOPPED=0
[[ -f "${SNAP}/data.mdb" ]] || die "snapshot missing data.mdb."

# --- Tar + ship inside the sidecar (carries awscli + zstd; gets creds via --env-file)
log "Tar + upload via ${TOOLING_IMAGE}."
docker run --rm \
  -v "${SNAP}:/snap:ro" \
  --env-file "${SECRETS_ENV_FILE}" \
  --entrypoint /bin/sh \
  "${TOOLING_IMAGE}" -ec '
    : "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET unset in env-file}"
    TS=$(date -u +%Y%m%dT%H%M%SZ)
    OBJ="lmdb-${TS}.tar.zst"
    PREFIX="${BACKUP_S3_PREFIX:-lmdb/cocoindex-state}"
    LABEL="${BACKUP_ENV_LABEL:-production}"
    tar --zstd -cf "/tmp/${OBJ}" -C /snap .
    set --
    [ -n "${AWS_ENDPOINT_URL:-}" ] && set -- "$@" --endpoint-url "${AWS_ENDPOINT_URL}"
    [ -n "${AWS_REGION:-}" ] && set -- "$@" --region "${AWS_REGION}"
    aws "$@" s3 cp "/tmp/${OBJ}" "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${LABEL}/${OBJ}"
    echo "[lmdb-cold] uploaded s3://${BACKUP_S3_BUCKET}/${PREFIX}/${LABEL}/${OBJ}"
  '

log "Backup complete."
