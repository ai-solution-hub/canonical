#!/usr/bin/env bash
# deploy/coolify/goose/run-pilot.sh
#
# ID-71.26 — the per-run wrapper the Coolify SCHEDULED TASK invokes (NOT the
# container entrypoint; the container is boot-idle). One invocation == one pilot
# run == at most one Anthropic spend tick.
#
# Responsibilities:
#   1. Mint a short-lived Supabase OAuth bearer for the dedicated `editor`
#      service-actor via password-grant (OQ-B recommended posture).
#   2. Export it as MCP_BEARER_TOKEN so the recipe's remote-MCP extension can send
#      `Authorization: Bearer …` + `X-MCP-Actor: headless`.
#   3. Run the pilot recipe ONE-SHOT, no persisted session.
#
# OQ-B (Liam ratify at G1/G2): verify `curl` AND `python3` (or `jq`) are present in
#   ghcr.io/block/goose:v1.38.0 — the token mint below needs an HTTP client + JSON
#   parse. If absent, either switch the image or mint the token in a sidecar.
set -euo pipefail

# --- Required env (injected by Coolify; see docker-compose.goose.yaml) ----------
: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_PUBLISHABLE_KEY:?SUPABASE_PUBLISHABLE_KEY is required}"
: "${GOOSE_SERVICE_ACTOR_EMAIL:?GOOSE_SERVICE_ACTOR_EMAIL is required}"
: "${GOOSE_SERVICE_ACTOR_PASSWORD:?GOOSE_SERVICE_ACTOR_PASSWORD is required}"
: "${GOOSE_MCP_URL:?GOOSE_MCP_URL is required}"

RECIPE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECIPE="${RECIPE_DIR}/o4-pilot.yaml"
export GOOSE_CONFIG_PATH="${RECIPE_DIR}/config.yaml"

# --- 1+2. Mint the per-run bearer (password grant) ------------------------------
# GoTrue password-grant: POST /auth/v1/token?grant_type=password with the anon/
# publishable key as apikey. Short-lived; never logged. The `editor` role earns
# propose-writes; publication stays human-gated at the MCP surface (B-INV-6).
echo "[run-pilot] minting service-actor bearer (${GOOSE_SERVICE_ACTOR_EMAIL})…"
_token_response="$(
  curl -fsS \
    -X POST "${SUPABASE_URL%/}/auth/v1/token?grant_type=password" \
    -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${GOOSE_SERVICE_ACTOR_EMAIL}\",\"password\":\"${GOOSE_SERVICE_ACTOR_PASSWORD}\"}"
)"

MCP_BEARER_TOKEN="$(
  printf '%s' "${_token_response}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])'
)"
unset _token_response
export MCP_BEARER_TOKEN

if [[ -z "${MCP_BEARER_TOKEN}" ]]; then
  echo "[run-pilot] FATAL: empty access_token from GoTrue" >&2
  exit 1
fi

# --- 3. Run the pilot recipe one-shot -------------------------------------------
# --no-session: no persisted conversation state between runs (each tick is fresh).
echo "[run-pilot] running pilot recipe against ${GOOSE_MCP_URL}…"
exec goose run --no-session --recipe "${RECIPE}"
