-- ID-131 {131.11} G-SEARCH residual — company_profile EMB-STORE completeness
-- (owner-ratified T4-OQ-1 = MIGRATE).
--
-- Resolves the OQ escalated by the BLOCKED terminal artifact
-- supabase/migrations-blocked/20260702120001_id131_drop_inline_vector_cols.sql
-- (its TODO(OQ) block, reasons 1-3). Two of the three blockers are cleared here:
--   1. record_embeddings.owner_kind CHECK gains 'company_profile' (below, §1).
--   2. The existing company_profiles.company_embedding (TEXT, JSON-serialised)
--      values are normalised into record_embeddings rows (below, §2).
-- Reason 3 (pipeline.ts:123 re-point) is cleared by the SAME {131.11} residual
-- dispatch, in the companion TS commit — NOT in this migration.
--
-- This migration does NOT drop company_profiles.company_embedding. That DROP
-- stays parked in the blocked terminal artifact above and moves back into an
-- applyable migration at M6/{131.19} once G-API has rebuilt the
-- api.company_profiles view without the column (see that file's header for the
-- full api-regen consequence note).
--
-- Data-safe / re-runnable: §1 uses DROP CONSTRAINT IF EXISTS + a superset CHECK
-- (widens the allowed set, never narrows); §2 is an idempotent INSERT ... SELECT
-- guarded by ON CONFLICT DO NOTHING on the M1b UNIQUE (owner_kind, owner_id,
-- model) — matching the flow.py record_embeddings dual-write's upsert-via-UNIQUE
-- posture (_declare_record_embedding, scripts/cocoindex_pipeline/flow.py).
--
-- UK English throughout (DD/MM/YYYY). Authored 03/07/2026.

-- ============================================================================
-- 1. record_embeddings_owner_kind_chk — add 'company_profile' (T4-OQ-1 reason 1).
-- The M1b CHECK (20260628190001_id131_record_embeddings_store.sql) shipped with
-- the 5-value set {source_document, content_chunk, q_a_pair, reference_item,
-- concept}; company_profile was out of scope for M1b and is added now that the
-- owner has ratified normalising the company-profile embedding into this store.
-- Superset widen only — every previously-valid owner_kind value is preserved.
-- ============================================================================
ALTER TABLE "public"."record_embeddings" DROP CONSTRAINT IF EXISTS "record_embeddings_owner_kind_chk";
ALTER TABLE "public"."record_embeddings" ADD CONSTRAINT "record_embeddings_owner_kind_chk"
    CHECK (("owner_kind" = ANY (ARRAY[
        'source_document'::"text",
        'content_chunk'::"text",
        'q_a_pair'::"text",
        'reference_item'::"text",
        'concept'::"text",
        'company_profile'::"text"
    ])));

-- ============================================================================
-- 2. Normalise company_profiles.company_embedding into record_embeddings
-- (T4-OQ-1 reason 2). model = 'text-embedding-3-large' — the same literal the
-- M5 search consumers hard-code when reading record_embeddings (M5,
-- 20260702120000_id131_search_rpcs.sql, and lib/mcp/tools/search.ts), and the
-- default model lib/ai/embed.ts's generateEmbedding() has always used to
-- populate this column (lib/intelligence/pipeline.ts's loadOrGenerateCompanyEmbedding
-- is, and has always been, the sole writer of company_embedding).
--
-- company_embedding is TEXT holding JSON.stringify(embedding) (a JS number[]),
-- e.g. "[0.1,0.2,0.3]" — exactly pgvector's text-in format, so a direct
-- ::extensions.vector cast round-trips it. The `~ '^\['` sanity guard excludes
-- any non-JSON-array leftovers (the pipeline's own regenerate-on-parse-failure
-- path means a genuinely malformed cached value is already a rare/stale case;
-- skipping it here just means that one profile re-generates its embedding on
-- next pipeline run, same as it would have before this migration).
--
-- No id/created_at/updated_at supplied: all three have column defaults
-- (gen_random_uuid()/now()/now() — see M1b DDL), matching the INSERT shape
-- record_embeddings readers/writers already use elsewhere (M1b, M5).
-- ============================================================================
INSERT INTO "public"."record_embeddings" ("owner_kind", "owner_id", "model", "embedding")
SELECT
    'company_profile',
    "id",
    'text-embedding-3-large',
    "company_embedding"::"extensions"."vector"
FROM "public"."company_profiles"
WHERE "company_embedding" IS NOT NULL
  AND "company_embedding" ~ '^\[.*\]$'
ON CONFLICT ("owner_kind", "owner_id", "model") DO NOTHING;
