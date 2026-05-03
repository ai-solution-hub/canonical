#!/usr/bin/env bash
# WP-CI.RES.7 — Staging reference-table refresh orchestrator (Path (ii)).
#
# Refreshes 13 reference/lookup tables from production into the persistent
# staging Supabase branch (turayklvaunphgbgscat) via pg_dump -Fc | pg_restore.
# Zero PII surface — no scrub step required.
#
# Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-ci-res7-staging-data-strategy-spec.md
# Replaces: scripts/staging-mirror-and-scrub.ts (783 LoC, ESCALATING at v7).

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────

PROD_DB_URL="${PROD_SUPABASE_DB_URL:?Missing PROD_SUPABASE_DB_URL}"
STAGING_DB_URL="${STAGING_SUPABASE_DB_URL:?Missing STAGING_SUPABASE_DB_URL}"

# Explicit list per spec §3.2 + §3.4 (13 tables, ~357 rows).
# Maintenance: adding/removing a table is a one-line change here + one-line
# in the spec §3.2 table.
REFERENCE_TABLES=(
  public.taxonomy_domains
  public.taxonomy_subtopics
  public.taxonomy_sync_state
  public.layer_vocabulary
  public.guides
  public.guide_sections
  public.entity_aliases
  public.company_profiles
  public.template_requirements
  public.feed_prompts
  public.feed_flags
  public.tag_morphology_drift_flags
  public.user_roles
)

# FK-aware DELETE ordering (spec §5.2 + continuation prompt critical rule 4):
# Children before parents. guide_sections FK → guides;
# taxonomy_subtopics FK → taxonomy_domains. All others have no
# inter-reference-table FK dependencies.
DELETE_ORDER=(
  public.guide_sections
  public.taxonomy_subtopics
  public.taxonomy_sync_state
  public.layer_vocabulary
  public.entity_aliases
  public.company_profiles
  public.template_requirements
  public.feed_prompts
  public.feed_flags
  public.tag_morphology_drift_flags
  public.user_roles
  public.guides
  public.taxonomy_domains
)

# ── Pre-flight ──────────────────────────────────────────────────────────────

echo "[pre-flight] Checking pg_dump version..."
PG_DUMP_VERSION=$(pg_dump --version 2>&1)
echo "  $PG_DUMP_VERSION"
echo "$PG_DUMP_VERSION" | grep -q "17\." || { echo "FATAL: pg_dump must be v17 (Supabase runs PG 17.6)"; exit 3; }

echo "[pre-flight] Checking staging reachability..."
psql "$STAGING_DB_URL" -c "SELECT 1;" -t -A > /dev/null || { echo "FATAL: staging unreachable"; exit 3; }

echo "[pre-flight] Checking migration parity..."
PROD_COUNT=$(psql "$PROD_DB_URL" -c "SELECT count(*) FROM supabase_migrations.schema_migrations;" -t -A)
STAGING_COUNT=$(psql "$STAGING_DB_URL" -c "SELECT count(*) FROM supabase_migrations.schema_migrations;" -t -A)
echo "  prod=$PROD_COUNT staging=$STAGING_COUNT"
[ "$PROD_COUNT" = "$STAGING_COUNT" ] || { echo "FATAL: migration count mismatch (prod=$PROD_COUNT, staging=$STAGING_COUNT)"; exit 3; }

# ── Build pg_dump table args ────────────────────────────────────────────────

TABLE_ARGS=""
for t in "${REFERENCE_TABLES[@]}"; do
  TABLE_ARGS="$TABLE_ARGS -t $t"
done

# ── Clear staging reference tables (FK-aware order) ─────────────────────────

echo "[clear] Deleting existing reference data on staging (${#DELETE_ORDER[@]} tables)..."
for t in "${DELETE_ORDER[@]}"; do
  echo "  DELETE FROM $t"
  psql "$STAGING_DB_URL" -c "DELETE FROM $t;" 2>/dev/null || true
done

# ── Dump + restore (single-pass, data-only) ─────────────────────────────────

echo "[refresh] pg_dump prod | pg_restore staging (${#REFERENCE_TABLES[@]} tables)..."
# shellcheck disable=SC2086
pg_dump "$PROD_DB_URL" -Fc --data-only $TABLE_ARGS \
  | pg_restore --data-only --single-transaction -d "$STAGING_DB_URL"

# ── Post-flight verification ────────────────────────────────────────────────

echo "[verify] Spot-checking row counts on staging..."
for t in public.taxonomy_domains public.taxonomy_subtopics public.guides public.user_roles; do
  COUNT=$(psql "$STAGING_DB_URL" -c "SELECT count(*) FROM $t;" -t -A)
  echo "  $t: $COUNT rows"
  [ "$COUNT" -gt 0 ] || { echo "FATAL: $t is empty after refresh"; exit 1; }
done

echo "[done] Reference tables refreshed. ${#REFERENCE_TABLES[@]} tables, prod migration count=$PROD_COUNT."
