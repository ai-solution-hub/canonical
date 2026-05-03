#!/usr/bin/env bash
# WP-CI.RES.7 — Staging reference-table refresh orchestrator (Path (ii)).
#
# Refreshes 6 FK-safe reference/lookup tables from production into the persistent
# staging Supabase branch (turayklvaunphgbgscat) via pg_dump -Fc | pg_restore.
# Zero PII surface — no scrub step required.
#
# Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-ci-res7-staging-data-strategy-spec.md
# Replaces: scripts/staging-mirror-and-scrub.ts (783 LoC, ESCALATING at v7).

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────

PROD_DB_URL="${PROD_SUPABASE_DB_URL:?Missing PROD_SUPABASE_DB_URL}"
STAGING_DB_URL="${STAGING_SUPABASE_DB_URL:?Missing STAGING_SUPABASE_DB_URL}"

# FK-safe reference/lookup tables (6 tables).
# Maintenance: adding/removing a table is a one-line change here.
#
# RULE: only tables with NO FK to auth.users or content tables belong
# here. Supabase's postgres role (rds_superuser) cannot disable system
# constraint triggers, so any FK pointing to a table that doesn't exist
# on staging will cause pg_restore to fail.
#
# EXCLUDED (all have FK → auth.users via created_by/decided_by/flagged_by):
#   - public.user_roles              — user_id FK → auth.users
#   - public.feed_prompts            — created_by FK → auth.users
#   - public.feed_flags              — flagged_by, resolved_by FK → auth.users
#                                      + feed_article_id FK → feed_articles
#   - public.tag_morphology_drift_flags — decided_by FK → auth.users
#   - public.company_profiles        — created_by FK → auth.users
#   - public.guides                  — created_by FK → auth.users
#   - public.guide_sections          — FK → guides (excluded above)
REFERENCE_TABLES=(
  public.taxonomy_domains
  public.taxonomy_subtopics
  public.taxonomy_sync_state
  public.layer_vocabulary
  public.entity_aliases
  public.template_requirements
)

# FK-aware DELETE ordering (spec §5.2 + continuation prompt critical rule 4):
# Children before parents. guide_sections FK → guides;
# taxonomy_subtopics FK → taxonomy_domains. All others have no
# inter-reference-table FK dependencies.
DELETE_ORDER=(
  public.taxonomy_subtopics
  public.taxonomy_sync_state
  public.layer_vocabulary
  public.entity_aliases
  public.template_requirements
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
# --single-transaction: wraps restore in a single transaction.
# NOTE: --disable-triggers intentionally NOT used — Supabase's postgres
# role is rds_superuser, not full superuser, and cannot disable system
# constraint triggers. The FK-violating tables (user_roles, feed_prompts)
# are excluded from the table set, so no trigger disabling is needed.
pg_dump "$PROD_DB_URL" -Fc --data-only $TABLE_ARGS \
  | pg_restore --data-only --single-transaction -d "$STAGING_DB_URL"

# ── Post-flight verification ────────────────────────────────────────────────

echo "[verify] Spot-checking row counts on staging..."
for t in public.taxonomy_domains public.taxonomy_subtopics public.layer_vocabulary public.entity_aliases; do
  COUNT=$(psql "$STAGING_DB_URL" -c "SELECT count(*) FROM $t;" -t -A)
  echo "  $t: $COUNT rows"
  [ "$COUNT" -gt 0 ] || { echo "FATAL: $t is empty after refresh"; exit 1; }
done

# ── Post-refresh: verify pipeline service account role intact ────────────────
# The reference refresh does NOT touch user_roles (excluded from table set),
# but verify the pipeline admin role survived as a sanity check.
echo "[post-refresh] Verifying pipeline service account role..."
PIPELINE_ROLE=$(psql "$STAGING_DB_URL" -c \
  "SELECT role FROM public.user_roles WHERE user_id = 'a0000000-0000-4000-8000-000000000001';" -t -A)
if [ "$PIPELINE_ROLE" != "admin" ]; then
  echo "WARNING: pipeline service account admin role missing — re-inserting..."
  psql "$STAGING_DB_URL" -c \
    "INSERT INTO public.user_roles (user_id, role) VALUES ('a0000000-0000-4000-8000-000000000001', 'admin') ON CONFLICT (user_id) DO NOTHING;"
fi

echo "[done] Reference tables refreshed. ${#REFERENCE_TABLES[@]} tables, prod migration count=$PROD_COUNT."
