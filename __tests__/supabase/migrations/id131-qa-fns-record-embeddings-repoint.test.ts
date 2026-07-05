/**
 * Static shape check for
 * supabase/migrations/20260706170000_id131_qa_fns_record_embeddings_repoint.sql
 * (ID-131.19, S450 GO tail #3, owner-directed fix). This is a SQL-only
 * migration — not applied by this Subtask (author-only; owner-gated apply
 * lands later in the GO sequence) — so there is no live DB to assert
 * behaviour against yet. This test instead pins the migration file's textual
 * shape: all three RPCs (`q_a_extractions_promotion_candidates`, `q_a_search`,
 * `question_match_recompute`) are re-created with their signature unchanged,
 * every `qap.question_embedding` / `p.question_embedding` read is gone, and
 * each function instead reads `public.record_embeddings` scoped to
 * `owner_kind = 'q_a_pair'` and `model = 'text-embedding-3-large'`.
 *
 * Cheap and deliberately non-exhaustive: a regression guard against the
 * migration file being edited in a way that drops the re-point or the
 * signature, not a substitute for the real post-apply verification that
 * happens once the owner-gated GO sequence applies this migration for real.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations/20260706170000_id131_qa_fns_record_embeddings_repoint.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

describe('20260706170000_id131_qa_fns_record_embeddings_repoint.sql', () => {
  it('re-creates all three functions with their exact squash-baseline signature', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."q_a_extractions_promotion_candidates"\(\) RETURNS SETOF "public"\."q_a_extractions"/,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."q_a_search"\("p_query" "text", "p_query_embedding" "extensions"\."vector", "p_limit" integer DEFAULT 20\) RETURNS TABLE\("pair_id" "uuid", "question_text_preview" "text", "answer_standard_preview" "text", "embedding_score" numeric, "fulltext_score" numeric, "scope_tag" "text"\[\], "publication_status" "text"\)/,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."question_match_recompute"\("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"\."vector", "p_question_kind" "text", "p_scope_tag" "text"\[\], "p_anti_scope_tag" "text"\[\], "p_limit" integer DEFAULT 20\) RETURNS integer/,
    );
  });

  it('never executes a cosine-distance or NULL-check against the dropped question_embedding column', () => {
    // Prose comments and the historical-context header legitimately quote the
    // OLD broken expressions for documentation (e.g. "was `qap.question_
    // embedding IS NOT NULL`") — those quoted mentions are fine. What must be
    // ABSENT is the executable cosine-distance operator applied directly to
    // the dropped column, which is the exact pattern that broke at runtime.
    expect(sql).not.toMatch(/question_embedding\s*<=>/);
    expect(sql).not.toMatch(
      /<=>\s*p_query_embedding\s*\)\)?::numeric.*qap\.question_embedding/,
    );
  });

  it('q_a_extractions_promotion_candidates re-points the NULL-embedding check onto record_embeddings via NOT EXISTS', () => {
    const fnBody = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION "public"."q_a_extractions_promotion_candidates"',
      ),
      sql.indexOf('CREATE OR REPLACE FUNCTION "public"."q_a_search"'),
    );
    expect(fnBody).toMatch(/NOT EXISTS \(/);
    expect(fnBody).toMatch(/re\.owner_kind = 'q_a_pair'/);
    expect(fnBody).toMatch(/re\.owner_id = p\.id/);
    expect(fnBody).toMatch(/re\.model = 'text-embedding-3-large'/);
    // LANGUAGE sql (no DECLARE support) — the model literal must be inlined,
    // not referenced via an embedding_model variable.
    expect(fnBody).toMatch(/LANGUAGE "sql" STABLE/);
  });

  it('q_a_search joins record_embeddings for both the cosine expression and the eligibility filter', () => {
    const fnBody = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION "public"."q_a_search"'),
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION "public"."question_match_recompute"',
      ),
    );
    expect(fnBody).toMatch(
      /embedding_model CONSTANT text := 'text-embedding-3-large'/,
    );
    expect(fnBody).toMatch(
      /JOIN public\.record_embeddings re ON re\.owner_kind = 'q_a_pair' AND re\.owner_id = qap\.id AND re\.model = embedding_model/,
    );
    expect(fnBody).toMatch(/re\.embedding <=> p_query_embedding/);
    expect(fnBody).toMatch(/WHERE re\.embedding IS NOT NULL/);
    expect(fnBody).toMatch(/LANGUAGE "plpgsql" STABLE SECURITY DEFINER/);
  });

  it('question_match_recompute joins record_embeddings for both the cosine expression and the B6 eligibility filter', () => {
    const fnBody = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION "public"."question_match_recompute"',
      ),
    );
    expect(fnBody).toMatch(
      /embedding_model CONSTANT text := 'text-embedding-3-large'/,
    );
    expect(fnBody).toMatch(
      /JOIN public\.record_embeddings re ON re\.owner_kind = 'q_a_pair' AND re\.owner_id = qap\.id AND re\.model = embedding_model/,
    );
    expect(fnBody).toMatch(/re\.embedding <=> p_query_embedding/);
    expect(fnBody).toMatch(/WHERE re\.embedding IS NOT NULL/);
    expect(fnBody).toMatch(/LANGUAGE "plpgsql" SECURITY DEFINER/);
  });

  it('preserves the pre-existing grants posture: only q_a_extractions_promotion_candidates restates REVOKE/GRANT', () => {
    const revokeGrantCount = (sql.match(/REVOKE ALL ON FUNCTION/g) ?? [])
      .length;
    expect(revokeGrantCount).toBe(1);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION "public"\."q_a_extractions_promotion_candidates"\(\) FROM PUBLIC;/,
    );
  });

  it('documents author-only status (no apply in this Subtask)', () => {
    expect(sql).toMatch(/AUTHORED, NOT APPLIED/);
    expect(sql).toMatch(/ID-131\.19/);
  });
});
