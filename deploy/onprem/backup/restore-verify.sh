#!/usr/bin/env bash
#
# restore-verify.sh — exercise the {66.14} LMDB backup restore path (inv 15 / inv 7).
# ID-66.14 (canonical-pipeline / on-prem B1).
#
# Downloads the newest backup object from S3 (via the canonical-lmdb-backup-tools sidecar,
# which carries awscli), untars it, and verifies the restored data.mdb is a VALID
# LMDB env — by checking the meta-page magic (0xBEEFC0DE at byte offset 16) and a
# non-zero size. NB: `mdb_stat` CANNOT be used to validate it (the same LMDB
# version skew that forced the cold-snapshot design — see lmdb-backup-cold.sh —
# means no distro mdb tool can open cocoindex's env), so the magic check is the
# integrity proof. A real restore then untars data.mdb into the env dir on the
# (stopped) volume; see the {66.14} "Restore procedure" in the runbook.
#
# CONFIG: APP_UUID (req), SECRETS_ENV_FILE [/root/canonical-secrets/lmdb-backup.env],
#         TOOLING_IMAGE [canonical-lmdb-backup-tools:latest].
set -euo pipefail

: "${APP_UUID:?APP_UUID is required.}"
SECRETS_ENV_FILE="${SECRETS_ENV_FILE:-/root/canonical-secrets/lmdb-backup.env}"
TOOLING_IMAGE="${TOOLING_IMAGE:-canonical-lmdb-backup-tools:latest}"
command -v docker >/dev/null 2>&1 || { echo "[restore] ERROR: docker not found" >&2; exit 1; }
[[ -f "${SECRETS_ENV_FILE}" ]] || { echo "[restore] ERROR: no ${SECRETS_ENV_FILE}" >&2; exit 1; }

# Tooling image is local-only (never pushed) and Coolify's force_docker_cleanup prunes
# it between runs — rebuild from the co-located Dockerfile.tools if missing (see
# lmdb-backup-cold.sh for the full rationale). A pruned image otherwise fails the restore
# on an unrecoverable registry pull — the worst moment to discover it.
if ! docker image inspect "${TOOLING_IMAGE}" >/dev/null 2>&1; then
  DOCKERFILE_TOOLS="${DOCKERFILE_TOOLS:-$(dirname "$0")/Dockerfile.tools}"
  [[ -f "${DOCKERFILE_TOOLS}" ]] || { echo "[restore] ERROR: tooling image ${TOOLING_IMAGE} missing and no Dockerfile.tools at ${DOCKERFILE_TOOLS}" >&2; exit 1; }
  echo "[restore] tooling image ${TOOLING_IMAGE} missing (likely Coolify-pruned) — rebuilding from ${DOCKERFILE_TOOLS}" >&2
  docker build -t "${TOOLING_IMAGE}" -f "${DOCKERFILE_TOOLS}" "$(dirname "${DOCKERFILE_TOOLS}")" >&2 || { echo "[restore] ERROR: rebuild failed" >&2; exit 1; }
fi

OUT="$(mktemp -d)"
trap 'rm -rf "${OUT}"' EXIT

# Pull every object in the prefix (there are few) into a host-mounted dir via the sidecar.
docker run --rm --env-file "${SECRETS_ENV_FILE}" -v "${OUT}:/out" --entrypoint /bin/sh "${TOOLING_IMAGE}" -ec '
  : "${BACKUP_S3_BUCKET:?}"
  P="${BACKUP_S3_PREFIX:-lmdb/cocoindex-state}"; L="${BACKUP_ENV_LABEL:-production}"
  set --
  [ -n "${AWS_ENDPOINT_URL:-}" ] && set -- "$@" --endpoint-url "${AWS_ENDPOINT_URL}"
  [ -n "${AWS_REGION:-}" ] && set -- "$@" --region "${AWS_REGION}"
  aws "$@" s3 cp --recursive "s3://${BACKUP_S3_BUCKET}/${P}/${L}/" /out/
'

TAR="$(ls -t "${OUT}"/*.tar.zst 2>/dev/null | head -1)"
[[ -n "${TAR}" ]] || { echo "[restore] ERROR: no .tar.zst downloaded" >&2; exit 1; }
echo "[restore] newest object: $(basename "${TAR}") ($(stat -c%s "${TAR}") bytes compressed)"

tar --zstd -xf "${TAR}" -C "${OUT}"
[[ -f "${OUT}/data.mdb" ]] || { echo "[restore] ERROR: tar has no data.mdb" >&2; exit 1; }

SZ="$(stat -c%s "${OUT}/data.mdb")"
MAGIC="$(od -An -t x1 -j 16 -N 4 "${OUT}/data.mdb" | tr -d ' ')"
echo "[restore] restored data.mdb: ${SZ} bytes, meta-magic=${MAGIC} (expect dec0efbe = LMDB 0xBEEFC0DE)"
if [[ "${MAGIC}" == "dec0efbe" && "${SZ}" -gt 0 ]]; then
  echo "[restore] VALID LMDB restore verified."
else
  echo "[restore] FAIL: not a valid LMDB env." >&2
  exit 1
fi
