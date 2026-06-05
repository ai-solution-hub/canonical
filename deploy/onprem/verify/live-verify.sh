#!/usr/bin/env bash
#
# live-verify.sh — ID-62 {62.9} B1 live-verification trigger (operator/host hook).
# canonical-pipeline / on-prem B1 (ID-66 host).
#
# THE TRIGGER SEQUENCE (load-bearing — ID-83 / bl-221 boot-never-walks):
#
#   1. verify driver STAGES the fixture set   (docker exec → loopback POST /stage)
#   2. POST /walk                              (bearer-gated, single-flight — ingests
#                                               the driver-staged corpus; staging bytes
#                                               NO LONGER ingests on its own under ID-83)
#   3. wait for walk completion               (docker logs: "/walk completed (requestId=…)")
#   4. Vitest go-live tier ON the host        (cocoindex-scoped vitest invocation with the
#                                               COCOINDEX_* env block + live-Supabase creds),
#                                               with a background WALK PUMP issuing further
#                                               POST /walk cycles — Tier-1/Tier-2 files stage
#                                               their OWN fixtures inside their beforeAll
#                                               hooks DURING the Vitest run, so a single
#                                               pre-Vitest walk cannot ingest them. The pump
#                                               replays the retired continuous-watcher
#                                               semantics for the supervised verify window
#                                               only (each pass is incremental: unchanged
#                                               files memo-hit and burn nothing).
#
# A non-zero driver exit FAILS BEFORE the Vitest step runs (ID-62 {62.9} brief).
#
# POLICY (ID-62 Inv-28 — topology-agnostic, carried from the Cloud-Run-era spec):
#   - On-demand operator/host hook. NO gcloud, NO WIF, NO Cloud Run Job anywhere
#     in this trigger path.
#   - NOT inlined into the PR-blocking ci.yml `integration` job; ci.yml unchanged.
#   - NOT scheduled today — see the commented launch-flip block at the bottom
#     (ID-62 Inv-29).
#
# BURN DISCIPLINE: the on-prem pipeline writes to LIVE Supabase (prod-wired today —
# see docs/themes/canonical-pipeline/reference/cocoindex-write-model.md §6 / OQ-64-8).
# Run this under the same supervised-burn discipline as the S297 smokes: watch
# `docker logs -f` during the run; the kill-switch is `docker stop <container>`
# (aborts an in-flight walk; the single-flight lock dies with the process).
# Fixtures are test-prefixed and cleaned up by the test layer's dropFixture.
#
# HOST PREREQUISITES (operator — see docs/runbooks/onprem-b1-deploy.md §ID-62):
#   - docker CLI access to the cocoindex compose stack.
#   - A knowledge-hub repo checkout + `bun install` (the Vitest step runs from
#     it, AND step 0b docker-cps its docs/testing fixture corpus into the
#     container — the buildpack image does not carry the corpus).
#   - A host env file (default /root/.kh-live-verify.env, NEVER committed) providing:
#       NEXT_PUBLIC_SUPABASE_URL=…       # live Supabase project URL
#       SUPABASE_SERVICE_ROLE_KEY=…      # live service-role key
#   - CRON_SECRET lives in the cocoindex CONTAINER env (compose) — this script
#     never needs it host-side (all /walk POSTs run via docker exec).
#
# USAGE:
#   KH_REPO_DIR=/opt/knowledge-hub deploy/onprem/verify/live-verify.sh
#
# Tunables (env):
#   KH_REPO_DIR              repo checkout the Vitest step runs from (REQUIRED)
#   VERIFY_ENV_FILE          host secrets env file (default /root/.kh-live-verify.env)
#   COCOINDEX_CONTAINER      container name/id (default: resolved by image grep)
#   PULLMD_CONTAINER         pullmd container name/id (default: resolved by image grep)
#   COCOINDEX_INTERNAL_PORT  sidecar port inside the container (default 8080 = $PORT default)
#   FIXTURE_SET              verify_driver --fixtures set (default templates)
#   WALK_TIMEOUT_SECS        max wait for the pre-Vitest walk to complete (default 900)
#   WALK_PUMP_INTERVAL_SECS  pump cadence during the Vitest window (default 30)
#   COCOINDEX_STAGING_URL    override the host→sidecar URL (default: container-IP form)

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────

KH_REPO_DIR="${KH_REPO_DIR:?set KH_REPO_DIR to the knowledge-hub checkout the Vitest step runs from}"
VERIFY_ENV_FILE="${VERIFY_ENV_FILE:-/root/.kh-live-verify.env}"
COCOINDEX_INTERNAL_PORT="${COCOINDEX_INTERNAL_PORT:-8080}"
FIXTURE_SET="${FIXTURE_SET:-templates}"
WALK_TIMEOUT_SECS="${WALK_TIMEOUT_SECS:-900}"
WALK_PUMP_INTERVAL_SECS="${WALK_PUMP_INTERVAL_SECS:-30}"

log() { printf '[live-verify] %s\n' "$*" >&2; }
die() { log "FATAL: $*"; exit 1; }

# Google-buildpack python env (S316 — verified live on B1). The onprem image is
# a Google buildpack build: python3 lives at
# /layers/google.python.runtime/python/bin/python3 and site-packages resolve
# via the pip user-site at PYTHONUSERBASE=/layers/google.python.pip/pip. A bare
# `docker exec … python3` exits 127 (the exec PATH omits the buildpack layers),
# so EVERY `docker exec` in this script injects this env block.
BUILDPACK_PYTHON_ENV=(
  -e PYTHONUSERBASE=/layers/google.python.pip/pip
  -e PATH=/layers/google.python.pip/pip/bin:/layers/google.python.runtime/python/bin:/usr/bin:/bin
)

# Where the buildpack image roots the app checkout inside the container.
# verify_driver resolves its repo root two parents above its own module path
# (<app-dir>/scripts/cocoindex_pipeline/verify_driver.py → <app-dir>), so the
# fixture corpus seeded in step 0b must land under <app-dir>/docs/testing.
COCOINDEX_APP_DIR="${COCOINDEX_APP_DIR:-/workspace}"

# Resolve the cocoindex container (compose names drift across Coolify deploys,
# so default to an image-name grep rather than a hard-coded container name).
if [[ -z "${COCOINDEX_CONTAINER:-}" ]]; then
  COCOINDEX_CONTAINER="$(docker ps --filter "ancestor=$(docker ps --format '{{.Image}}' | grep -m1 'kh-cocoindex-pipeline' || true)" --format '{{.Names}}' | head -1 || true)"
  [[ -n "$COCOINDEX_CONTAINER" ]] || COCOINDEX_CONTAINER="$(docker ps --format '{{.Names}}\t{{.Image}}' | grep 'kh-cocoindex-pipeline' | head -1 | cut -f1 || true)"
fi
[[ -n "${COCOINDEX_CONTAINER:-}" ]] || die "could not resolve the cocoindex container — set COCOINDEX_CONTAINER explicitly"
log "cocoindex container: ${COCOINDEX_CONTAINER}"

if [[ -z "${PULLMD_CONTAINER:-}" ]]; then
  PULLMD_CONTAINER="$(docker ps --format '{{.Names}}\t{{.Image}}' | grep -i 'pullmd' | head -1 | cut -f1 || true)"
fi

[[ -f "$VERIFY_ENV_FILE" ]] || die "secrets env file not found: $VERIFY_ENV_FILE (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)"
[[ -d "$KH_REPO_DIR" ]] || die "KH_REPO_DIR does not exist: $KH_REPO_DIR"

# ──────────────────────────────────────────────────────────────────────────
# In-container HTTP helpers (the image ships NO curl — python3 + urllib is the
# dependency-free form, per docs/runbooks/onprem-b1-deploy.md §B2).
# CRON_SECRET resolves INSIDE the container env; it never touches the host.
# ──────────────────────────────────────────────────────────────────────────

container_health() {
  docker exec "${BUILDPACK_PYTHON_ENV[@]}" "$COCOINDEX_CONTAINER" python3 -c "
import urllib.request, sys
with urllib.request.urlopen('http://127.0.0.1:${COCOINDEX_INTERNAL_PORT}/health', timeout=15) as r:
    sys.exit(0 if r.status == 200 else 1)
"
}

# POST /walk. Prints the response JSON (incl. requestId) on stdout.
# Exit 0 on 202 (accepted) AND on 409 (walk already in flight — pump-tolerable);
# non-zero on 400/401/503/network failure.
container_walk_post() {
  docker exec "${BUILDPACK_PYTHON_ENV[@]}" "$COCOINDEX_CONTAINER" python3 -c "
import json, os, sys, urllib.request, urllib.error
req = urllib.request.Request(
    'http://127.0.0.1:${COCOINDEX_INTERNAL_PORT}/walk',
    method='POST',
    headers={'Authorization': 'Bearer ' + os.environ['CRON_SECRET']},
)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print(r.read().decode())
except urllib.error.HTTPError as e:
    body = e.read().decode()[:300]
    print(json.dumps({'httpStatus': e.code, 'body': body}))
    sys.exit(0 if e.code == 409 else 1)
"
}

container_ip() {
  docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1" | awk '{print $1}'
}

# ──────────────────────────────────────────────────────────────────────────
# Step 0 — preflight
# ──────────────────────────────────────────────────────────────────────────

log "preflight: /health probe (loopback, in-container)"
container_health || die "/health probe failed — sidecar not healthy; aborting before any stage/walk"

# ──────────────────────────────────────────────────────────────────────────
# Step 0b — seed the fixture corpus into the container (docker cp).
#
# The buildpack image packages ONLY scripts/ + requirements.txt — the committed
# docs/testing/test-data/** fixture corpus is NOT in the image (verified live
# on B1, S316). verify_driver reads its fixture bytes repo-relative INSIDE the
# container, so without this seed it exits non-zero and the script dies
# pre-walk. Ratified mechanism (option a, S318): docker-cp the corpus from the
# host checkout — no image change, no compose change.
#
# Idempotence: the `/.` source suffix copies the CONTENTS of docs/testing into
# the destination dir, so re-runs overwrite in place. (A bare
# `docker cp docs/testing <c>:…/docs/testing` would NEST a second testing/
# level on re-run — do not "simplify" this form.)
# ──────────────────────────────────────────────────────────────────────────

[[ -d "${KH_REPO_DIR}/docs/testing" ]] || die "fixture corpus not found at ${KH_REPO_DIR}/docs/testing — is KH_REPO_DIR a full checkout?"
log "step 0b: seeding fixture corpus → ${COCOINDEX_CONTAINER}:${COCOINDEX_APP_DIR}/docs/testing (docker cp)"
docker exec "${BUILDPACK_PYTHON_ENV[@]}" "$COCOINDEX_CONTAINER" mkdir -p "${COCOINDEX_APP_DIR}/docs/testing" \
  || die "could not create ${COCOINDEX_APP_DIR}/docs/testing in the container"
docker cp "${KH_REPO_DIR}/docs/testing/." "${COCOINDEX_CONTAINER}:${COCOINDEX_APP_DIR}/docs/testing" \
  || die "docker cp of the fixture corpus failed"

# ──────────────────────────────────────────────────────────────────────────
# Step 1 — verify driver stages the fixture set (stage-only by design, {62.7}).
# A non-zero driver exit fails HERE — before the walk and before Vitest.
# ──────────────────────────────────────────────────────────────────────────

log "step 1: verify driver staging fixture set '${FIXTURE_SET}' (loopback /stage)"
if ! docker exec "${BUILDPACK_PYTHON_ENV[@]}" "$COCOINDEX_CONTAINER" python3 -m scripts.cocoindex_pipeline.verify_driver --fixtures "$FIXTURE_SET"; then
  die "verify driver exited non-zero — failing BEFORE the Vitest step (ID-62 {62.9})"
fi

# ──────────────────────────────────────────────────────────────────────────
# Step 2 — POST /walk (the ID-83 session delta: staging bytes no longer
# ingests on its own; the stage → walk → assert sequence is mandatory).
# ──────────────────────────────────────────────────────────────────────────

WALK_LOG_SINCE="$(date -u +%Y-%m-%dT%H:%M:%S)"
log "step 2: POST /walk (bearer-gated, single-flight)"
WALK_RESPONSE="$(container_walk_post)" || die "POST /walk rejected: ${WALK_RESPONSE}"
log "walk response: ${WALK_RESPONSE}"
REQUEST_ID="$(printf '%s' "$WALK_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("requestId",""))' 2>/dev/null || true)"
[[ -n "$REQUEST_ID" ]] || die "no requestId in /walk response (409 walk-in-flight? re-run once the current walk finishes): ${WALK_RESPONSE}"

# ──────────────────────────────────────────────────────────────────────────
# Step 3 — wait for the pre-Vitest walk to complete. /walk is async (202 +
# requestId; completion observed via logs / pipeline_runs webhook). We watch
# docker logs for the worker's terminal line for THIS requestId.
# ──────────────────────────────────────────────────────────────────────────

log "step 3: waiting for walk requestId=${REQUEST_ID} (timeout ${WALK_TIMEOUT_SECS}s)"
DEADLINE=$(( $(date +%s) + WALK_TIMEOUT_SECS ))
while true; do
  WALK_LINES="$(docker logs --since "$WALK_LOG_SINCE" "$COCOINDEX_CONTAINER" 2>&1 | grep -F "requestId=${REQUEST_ID}" || true)"
  if printf '%s' "$WALK_LINES" | grep -q "/walk completed"; then
    log "walk completed (requestId=${REQUEST_ID})"
    break
  fi
  if printf '%s' "$WALK_LINES" | grep -q "update_blocking failed"; then
    die "walk FAILED (requestId=${REQUEST_ID}) — see docker logs; aborting before Vitest"
  fi
  [[ "$(date +%s)" -lt "$DEADLINE" ]] || die "walk did not complete within ${WALK_TIMEOUT_SECS}s (requestId=${REQUEST_ID})"
  sleep 10
done

# ──────────────────────────────────────────────────────────────────────────
# Step 4 — resolve the host→sidecar URL for the Vitest env block.
#
# The compose stack publishes NO host port for the sidecar (healthcheck is
# in-container /dev/tcp). From the HOST, the "localhost" of the spec's env
# block is realised as the container's bridge IP (host-local, not public).
# If the operator prefers the literal http://localhost:8080 form, add a
# `ports: ["127.0.0.1:8080:8080"]` publish to the compose service instead and
# export COCOINDEX_STAGING_URL before invoking.
# ──────────────────────────────────────────────────────────────────────────

if [[ -z "${COCOINDEX_STAGING_URL:-}" ]]; then
  COCOINDEX_IP="$(container_ip "$COCOINDEX_CONTAINER")"
  [[ -n "$COCOINDEX_IP" ]] || die "could not resolve the cocoindex container IP — export COCOINDEX_STAGING_URL explicitly"
  COCOINDEX_STAGING_URL="http://${COCOINDEX_IP}:${COCOINDEX_INTERNAL_PORT}"
fi
log "COCOINDEX_STAGING_URL=${COCOINDEX_STAGING_URL}"

PULLMD_SERVICE_URL="${PULLMD_SERVICE_URL:-}"
if [[ -z "$PULLMD_SERVICE_URL" && -n "${PULLMD_CONTAINER:-}" ]]; then
  PULLMD_IP="$(container_ip "$PULLMD_CONTAINER" || true)"
  [[ -n "$PULLMD_IP" ]] && PULLMD_SERVICE_URL="http://${PULLMD_IP}:3000"
fi
log "PULLMD_SERVICE_URL=${PULLMD_SERVICE_URL:-<unset — Tier-4 agpl-boundary will skip>}"

# ──────────────────────────────────────────────────────────────────────────
# Step 5 — walk pump (background). Tier-1/Tier-2 files stage their OWN
# fixtures in beforeAll DURING the Vitest run; under ID-83 nothing walks those
# stages unless we keep issuing /walk. Each pass is incremental (memo hits on
# unchanged files); a 409 (walk in flight) is tolerated and retried next tick.
# ──────────────────────────────────────────────────────────────────────────

PUMP_PID=""
stop_pump() {
  if [[ -n "$PUMP_PID" ]] && kill -0 "$PUMP_PID" 2>/dev/null; then
    kill "$PUMP_PID" 2>/dev/null || true
    wait "$PUMP_PID" 2>/dev/null || true
  fi
}
trap stop_pump EXIT

(
  while true; do
    sleep "$WALK_PUMP_INTERVAL_SECS"
    container_walk_post >/dev/null 2>&1 || true
  done
) &
PUMP_PID=$!
log "step 5: walk pump started (pid=${PUMP_PID}, every ${WALK_PUMP_INTERVAL_SECS}s)"

# ──────────────────────────────────────────────────────────────────────────
# Step 6 — Vitest go-live tier (cocoindex-scoped; NOT `bun test` — Bun's
# built-in runner is not Vitest).
#
# Per-file go-live ledger (ID-62 {62.9} / TECH §Testing "File → invariant tier
# map" / OQ-62-TECH-12). The --exclude list below is the EXPLICIT defer ledger
# — these files are NOT verified by this trigger and are NOT claimed verified
# (no green-by-skipping: they are named, with reasons, here and in
# docs/runbooks/onprem-b1-deploy.md §ID-62):
#
#   LIVE  — Tier-1 (all 20 stage+poll files), Tier-2 (form-extraction{,-rls}),
#           Tier-3 health-probe + transient-retry, Tier-4 agpl-boundary
#           (when PULLMD_SERVICE_URL resolves), Tier-5 (all 5 no-gate files).
#
#   DEFERRED (Tier-3, 6 of 8):
#     sidecar-cold-start        — needs an operator-driven cold-start cycle
#                                 (COCOINDEX_COLD_START=true gate + deliberate
#                                 container restart); Cloud-Run scale-to-zero
#                                 framing needs a B1 re-anchor.
#     sidecar-mime-coverage     — beforeAll staging is a 28.18-era stub
#                                 ("FUTURE: drop one fixture per MIME") — the
#                                 file polls prefixes nothing stages; enabling
#                                 it fails deterministically. HTML branch is
#                                 additionally ID-75-gated (PullMD cannot read
#                                 staged local files).
#     sidecar-version-metadata  — beforeAll empty; polls its own random prefix
#                                 that nothing stages (28.18 stub).
#     stage-topology            — beforeAll staging stubbed (28.18 stub).
#     latency-budget            — beforeAll staging stubbed; 30s per-file
#                                 budget also needs an ID-83 re-anchor (walk
#                                 cadence now dominates the measured latency).
#     audit-log-shipping        — polls its own random prefix that nothing
#                                 stages (28.18 stub); v1.1 audit_log half
#                                 self-gates on table existence.
#
#   DEFERRED (Tier-1b, 3 of 3):
#     extract-memoisation              — staging half deferred at authoring
#                                        ("FUTURE … 28.18") and never landed;
#                                        seededContentIds stays empty → fails
#                                        deterministically. Needs its own stage
#                                        + a SECOND walk pass (re-ingest).
#     memo-hit-pipeline-run            — never stages its prefix; assumes the
#                                        retired continuous poll-cycle model
#                                        (pre-ID-83). Needs own stage + two
#                                        explicit walks.
#     stage-5-failure-non-destructive  — self-stages via injectStage5Failure,
#                                        BUT the `?failStage5=` destPath
#                                        directive is NOT implemented by the
#                                        live /stage route ({62.5}) — the
#                                        credential is never cleared, Stage-5
#                                        never fails, the assertions fail.
# ──────────────────────────────────────────────────────────────────────────

log "step 6: Vitest go-live tier (repo: ${KH_REPO_DIR})"
set -a
# Operator-managed secrets file; path validated above.
# shellcheck disable=SC1090
source "$VERIFY_ENV_FILE"
set +a

VITEST_EXIT=0
(
  cd "$KH_REPO_DIR"
  export COCOINDEX_STAGING_URL
  export COCOINDEX_FIXTURE_STAGING_URL="$COCOINDEX_STAGING_URL"
  export COCOINDEX_SOURCE_PATH="/cocoindex-state/corpus"
  export PULLMD_SERVICE_URL
  bun x vitest run --config vitest.integration.config.ts \
    __tests__/integration/cocoindex \
    form-extraction \
    --exclude '**/sidecar-cold-start.integration.test.ts' \
    --exclude '**/sidecar-mime-coverage.integration.test.ts' \
    --exclude '**/sidecar-version-metadata.integration.test.ts' \
    --exclude '**/stage-topology.integration.test.ts' \
    --exclude '**/latency-budget.integration.test.ts' \
    --exclude '**/audit-log-shipping.integration.test.ts' \
    --exclude '**/extract-memoisation.integration.test.ts' \
    --exclude '**/memo-hit-pipeline-run.integration.test.ts' \
    --exclude '**/stage-5-failure-non-destructive.integration.test.ts'
) || VITEST_EXIT=$?

stop_pump
trap - EXIT

if [[ "$VITEST_EXIT" -eq 0 ]]; then
  log "live-verify PASSED (driver staged, walk completed, live tier green)"
else
  log "live-verify FAILED (vitest exit ${VITEST_EXIT})"
fi
exit "$VITEST_EXIT"

# ──────────────────────────────────────────────────────────────────────────
# Scheduled cadence — LAUNCH FLIP (ID-62 Inv-29)
#
# Inv-29 is satisfied TODAY by this commented block + the action item on the
# T13 row of docs/themes/canonical-pipeline/reference/canonical-pipeline-sequencing.md.
# The verification stays on-demand until launch (Inv-28). At launch, flip to a
# scheduled cadence with a ONE-LINE UNCOMMENT below (host crontab), or stand up
# the equivalent Coolify scheduled task (per-app config, not git-tracked — same
# operability class as the B2 /walk task).
#
# FLIP ON AT LAUNCH (ID-62 Inv-29)
# schedule: (uncomment ONE line into `crontab -e` on the B1 host; pick the cadence)
# 0 3 * * * KH_REPO_DIR=/opt/knowledge-hub /opt/knowledge-hub/deploy/onprem/verify/live-verify.sh >> /var/log/kh-live-verify.log 2>&1
# ──────────────────────────────────────────────────────────────────────────
