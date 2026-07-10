/**
 * Static shape check for
 * supabase/migrations/20260709234230_id57_clamp_question_match_embedding_score.sql
 * (ID-57.9, S451 {57.7} fix-executor finding, curator-confirmed). This is a
 * SQL-only migration — not applied by this Subtask (author-only; apply order
 * is staging first, then prod) — so there is no live DB to assert behaviour
 * against yet; the behavioural proof (anti-parallel query embedding no
 * longer violates the range CHECK, clamps to 0 instead) lives in the
 * skip-gated integration case in
 * __tests__/integration/q-a-pairs/question-match-recompute.integration.test.ts,
 * exercised once the migration is applied. This test instead pins the
 * migration file's textual shape: both `question_match_recompute` and
 * `q_a_search` wrap their embedding_score expression in
 * `GREATEST(0, LEAST(1, ...))`, the DR-035 REVOKE/GRANT posture is re-stated
 * for both functions, and the migration is marked author-only.
 *
 * Cheap and deliberately non-exhaustive: a regression guard against the
 * migration file being edited in a way that drops the clamp, the grants
 * posture, or the author-only marker — not a substitute for the real
 * post-apply verification.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations/20260709234230_id57_clamp_question_match_embedding_score.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

function sliceFn(startMarker: string, endMarker?: string): string {
  const start = sql.indexOf(startMarker);
  const end = endMarker ? sql.indexOf(endMarker) : sql.length;
  return sql.slice(start, end);
}

const QMR_BODY = sliceFn(
  'CREATE OR REPLACE FUNCTION "public"."question_match_recompute"',
  'CREATE OR REPLACE FUNCTION "public"."q_a_search"',
);
const QAS_BODY = sliceFn('CREATE OR REPLACE FUNCTION "public"."q_a_search"');

describe('20260709234230_id57_clamp_question_match_embedding_score.sql', () => {
  it('re-creates both functions with their exact current (post-ID-131.19) signature', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."question_match_recompute"\("p_form_question_id" "uuid", "p_query" "text", "p_query_embedding" "extensions"\."vector", "p_question_kind" "text", "p_scope_tag" "text"\[\], "p_anti_scope_tag" "text"\[\], "p_limit" integer DEFAULT 20\) RETURNS integer/,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."q_a_search"\("p_query" "text", "p_query_embedding" "extensions"\."vector", "p_limit" integer DEFAULT 20\) RETURNS TABLE\("pair_id" "uuid", "question_text_preview" "text", "answer_standard_preview" "text", "embedding_score" numeric, "fulltext_score" numeric, "scope_tag" "text"\[\], "publication_status" "text"\)/,
    );
  });

  it('clamps the embedding_score expression to [0,1] in question_match_recompute', () => {
    expect(QMR_BODY).toMatch(
      /GREATEST\(0, LEAST\(1, 1\.0 - \(re\.embedding <=> p_query_embedding\)\)\)::numeric\(5,4\)/,
    );
    // Exactly one scoring expression in this function body, and it is clamped
    // — no bare/unwrapped occurrence survives alongside the clamped one.
    const rawCount = (
      QMR_BODY.match(/1\.0 - \(re\.embedding <=> p_query_embedding\)/g) ?? []
    ).length;
    const clampedCount = (
      QMR_BODY.match(
        /GREATEST\(0, LEAST\(1, 1\.0 - \(re\.embedding <=> p_query_embedding\)\)\)/g,
      ) ?? []
    ).length;
    expect(rawCount).toBe(1);
    expect(clampedCount).toBe(1);
  });

  it('clamps the embedding_score expression to [0,1] in q_a_search', () => {
    expect(QAS_BODY).toMatch(
      /GREATEST\(0, LEAST\(1, 1\.0 - \(re\.embedding <=> p_query_embedding\)\)\)::numeric\(5,4\)/,
    );
    const rawCount = (
      QAS_BODY.match(/1\.0 - \(re\.embedding <=> p_query_embedding\)/g) ?? []
    ).length;
    const clampedCount = (
      QAS_BODY.match(
        /GREATEST\(0, LEAST\(1, 1\.0 - \(re\.embedding <=> p_query_embedding\)\)\)/g,
      ) ?? []
    ).length;
    expect(rawCount).toBe(1);
    expect(clampedCount).toBe(1);
  });

  it('re-states the DR-035 REVOKE/GRANT posture for both functions', () => {
    const revokeAllCount = (sql.match(/REVOKE ALL ON FUNCTION/g) ?? []).length;
    const revokeAnonCount = (
      sql.match(/REVOKE EXECUTE ON FUNCTION .* FROM "anon"/g) ?? []
    ).length;
    expect(revokeAllCount).toBe(2);
    expect(revokeAnonCount).toBe(2);

    expect(QMR_BODY).toMatch(
      /REVOKE ALL ON FUNCTION "public"\."question_match_recompute".*FROM PUBLIC;/,
    );
    expect(QMR_BODY).toMatch(
      /GRANT ALL ON FUNCTION "public"\."question_match_recompute".*TO "authenticated";/,
    );
    expect(QMR_BODY).toMatch(
      /GRANT ALL ON FUNCTION "public"\."question_match_recompute".*TO "service_role";/,
    );

    expect(QAS_BODY).toMatch(
      /REVOKE ALL ON FUNCTION "public"\."q_a_search".*FROM PUBLIC;/,
    );
    expect(QAS_BODY).toMatch(
      /GRANT ALL ON FUNCTION "public"\."q_a_search".*TO "authenticated";/,
    );
    expect(QAS_BODY).toMatch(
      /GRANT ALL ON FUNCTION "public"\."q_a_search".*TO "service_role";/,
    );
  });

  it('documents author-only status and cites the fixing Subtask', () => {
    expect(sql).toMatch(/AUTHORED, NOT APPLIED/);
    expect(sql).toMatch(/ID-57\.9/);
  });
});
