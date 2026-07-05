/**
 * Static shape check for
 * supabase/migrations-blocked/20260706103000_id131_attention_counts_rewrite.sql
 * (ID-131.19 S450 Wave 1, Fix 1). This is a SQL-only migration — not applied
 * by this Subtask (owner-gated apply lands later in the {131.19} GO
 * sequence) — so there is no live DB to assert behaviour against yet. This
 * test instead pins the migration file's textual shape: the DROP+CREATE
 * (not CREATE OR REPLACE) pattern required by Postgres 42P13, the
 * quality_flag_count re-point onto source_documents, the coverage_gap_count
 * retirement (absent from every clause), and the grants being re-applied.
 *
 * Cheap and deliberately non-exhaustive: it is a regression guard against the
 * migration file being edited (e.g. by a later Subtask) in a way that
 * reintroduces content_items, drops the source_documents join, or silently
 * stubs coverage_gap_count back to 0 — not a substitute for the real
 * post-apply verification that happens once the migration is actually
 * applied.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations-blocked/20260706103000_id131_attention_counts_rewrite.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

// The executable SQL body only — from the CREATE FUNCTION statement to its
// closing `$$;`, excluding the header prose (which legitimately narrates
// "content_items"/"coverage_gap_count" as history) and the trailing COMMENT
// ON FUNCTION (which legitimately documents the retirement in prose too).
const FUNCTION_BODY = sql.slice(
  sql.indexOf('CREATE FUNCTION "public"."get_dashboard_attention_counts"'),
  sql.indexOf('ALTER FUNCTION "public"."get_dashboard_attention_counts"'),
);

describe('20260706103000_id131_attention_counts_rewrite.sql', () => {
  it('DROPs then CREATEs (not CREATE OR REPLACE) — 42P13 OUT-column-set change', () => {
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS "public"\."get_dashboard_attention_counts"/,
    );
    expect(sql).toMatch(
      /CREATE FUNCTION "public"\."get_dashboard_attention_counts"/,
    );
    expect(sql).not.toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."get_dashboard_attention_counts"/,
    );
  });

  it('re-points quality_flag_count onto source_documents, never content_items as a query target', () => {
    expect(FUNCTION_BODY).toMatch(
      /JOIN source_documents sd ON iql\.source_document_id = sd\.id/,
    );
    // No FROM/JOIN clause in the executable body targets content_items —
    // the surrounding "-- ... content_items ..." comments narrating the
    // fix are expected and fine; only a real query reference would be a bug.
    expect(FUNCTION_BODY).not.toMatch(/(?:FROM|JOIN)\s+content_items\b/);
  });

  it('retires coverage_gap_count entirely — absent from OUT signature, DECLARE, and RETURN QUERY', () => {
    // Check the three places the field would actually reappear as CODE (not
    // narrating prose comments, which legitimately explain the retirement
    // inline): the RETURNS TABLE OUT-column list, the DECLARE block, and the
    // final RETURN QUERY SELECT tuple.
    const returnsClause = FUNCTION_BODY.match(
      /RETURNS TABLE\(([\s\S]*?)\)\s*\n\s*LANGUAGE/,
    )![1];
    expect(returnsClause).not.toMatch(/coverage_gap_count/);

    const declareBlock = FUNCTION_BODY.match(/DECLARE([\s\S]*?)BEGIN/)![1];
    expect(declareBlock).not.toMatch(/v_coverage_gap_count/);

    const returnQueryTuple = FUNCTION_BODY.match(
      /RETURN QUERY SELECT([\s\S]*?);\s*\nEND;/,
    )![1];
    expect(returnQueryTuple).not.toMatch(/v_coverage_gap_count/);
  });

  it('preserves the other 7 OUT columns and the freshness_summary jsonb shape', () => {
    const returnsMatch = sql.match(
      /RETURNS TABLE\(([\s\S]*?)\)\s*\n\s*LANGUAGE/,
    );
    expect(returnsMatch).not.toBeNull();
    const returnsClause = returnsMatch![1];
    for (const col of [
      'governance_review_count',
      'unverified_count',
      'quality_flag_count',
      'stale_content_count',
      'expired_content_count',
      'expiring_content_date_count',
      'unread_notification_count',
      'freshness_summary',
    ]) {
      expect(returnsClause).toContain(col);
    }
  });

  it('re-applies the same public.* grants (REVOKE FROM PUBLIC, GRANT TO authenticated + service_role)', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION "public"\."get_dashboard_attention_counts"\("p_user_id" "uuid", "p_role" "text"\) FROM PUBLIC;/,
    );
    expect(sql).toMatch(
      /GRANT ALL ON FUNCTION "public"\."get_dashboard_attention_counts"\("p_user_id" "uuid", "p_role" "text"\) TO "authenticated";/,
    );
    expect(sql).toMatch(
      /GRANT ALL ON FUNCTION "public"\."get_dashboard_attention_counts"\("p_user_id" "uuid", "p_role" "text"\) TO "service_role";/,
    );
  });

  it('does not touch the api.* wrapper (deferred to the GO M-API regen step)', () => {
    // No DDL statement in this migration targets the api schema's wrapper —
    // header prose explaining the DEFERRED api.* regen (mentioning the name)
    // is expected and fine; only an actual DROP/CREATE/ALTER against
    // api.get_dashboard_attention_counts would be a scope violation.
    expect(sql).not.toMatch(
      /(?:DROP|CREATE|CREATE OR REPLACE|ALTER)\s+FUNCTION\s+"?api"?\."?get_dashboard_attention_counts"?/,
    );
  });

  it('marks the migration as authored-but-not-applied, owner-gated for the {131.19} GO sequence', () => {
    expect(sql).toMatch(/AUTHORED, NOT APPLIED/);
    expect(sql).toMatch(/131\.19/);
  });

  it('cites DR-034 as the rationale for the coverage_gap_count retirement', () => {
    expect(sql).toMatch(/DR-034/);
  });
});
