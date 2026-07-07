/**
 * Static shape check for
 * supabase/migrations/20260707200000_id130_form_requirement_embedding_migrate.sql
 * ({130.24}, DR-036). This migration is authored + intended for staging apply
 * by this Subtask (not a deferred/owner-gated file) but there may be no live
 * DB available at test time, so this test pins the file's textual shape:
 * the owner_kind CHECK widens (never narrows), the backfill is idempotent and
 * scoped to non-null embeddings, the projecting api view is dropped BEFORE
 * the base-column DROP and rebuilt AFTER it without requirement_embedding,
 * and the base-column DROP itself is present (unlike the DO-NOT-APPLY
 * historical statement in 20260706120000_id131_drop_inline_vector_cols.sql).
 *
 * Cheap and deliberately non-exhaustive — a regression guard against a later
 * edit silently dropping the CHECK superset, the idempotency guard, the
 * view-before-column-drop ordering, or a grant.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations/20260707200000_id130_form_requirement_embedding_migrate.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

describe('20260707200000_id130_form_requirement_embedding_migrate.sql', () => {
  it('widens record_embeddings_owner_kind_chk to a superset including form_template_requirement', () => {
    expect(sql).toContain(
      'ALTER TABLE "public"."record_embeddings" DROP CONSTRAINT IF EXISTS "record_embeddings_owner_kind_chk";',
    );
    const checkMatch = sql.match(
      /ALTER TABLE "public"\."record_embeddings" ADD CONSTRAINT "record_embeddings_owner_kind_chk"[\s\S]*?\)\)\);/,
    );
    expect(checkMatch).not.toBeNull();
    const checkClause = checkMatch![0];
    // Every previously-valid owner_kind value is preserved (superset widen).
    for (const kind of [
      'source_document',
      'content_chunk',
      'q_a_pair',
      'reference_item',
      'concept',
      'company_profile',
      'form_template_requirement',
    ]) {
      expect(checkClause).toContain(`'${kind}'::"text"`);
    }
  });

  it('backfills non-null requirement_embedding rows into record_embeddings, idempotently', () => {
    const backfillMatch = sql.match(
      /INSERT INTO "public"\."record_embeddings"[\s\S]*?;/,
    );
    expect(backfillMatch).not.toBeNull();
    const backfill = backfillMatch![0];
    expect(backfill).toContain("'form_template_requirement'");
    expect(backfill).toContain("'text-embedding-3-large'");
    expect(backfill).toMatch(/FROM "public"\."form_template_requirements"/);
    expect(backfill).toMatch(/WHERE "requirement_embedding" IS NOT NULL/);
    expect(backfill).toMatch(
      /ON CONFLICT \("owner_kind", "owner_id", "model"\) DO NOTHING/,
    );
    // Same vector type on both sides (extensions.vector(1024)) — no ::cast needed.
    expect(backfill).not.toMatch(
      /"requirement_embedding"::"extensions"\."vector"/,
    );
  });

  it('drops the projecting api view BEFORE the base-column DROP, and rebuilds it after', () => {
    const dropViewIdx = sql.indexOf(
      'DROP VIEW IF EXISTS api.form_template_requirements;',
    );
    const dropColumnIdx = sql.indexOf(
      'ALTER TABLE "public"."form_template_requirements" DROP COLUMN IF EXISTS "requirement_embedding";',
    );
    const createViewIdx = sql.indexOf(
      'CREATE VIEW api.form_template_requirements WITH (security_invoker = true) AS',
    );
    expect(dropViewIdx).toBeGreaterThan(-1);
    expect(dropColumnIdx).toBeGreaterThan(-1);
    expect(createViewIdx).toBeGreaterThan(-1);
    expect(dropViewIdx).toBeLessThan(dropColumnIdx);
    expect(dropColumnIdx).toBeLessThan(createViewIdx);
  });

  it('drops requirement_embedding fresh (not the DO-NOT-APPLY historical statement)', () => {
    expect(sql).toContain(
      'ALTER TABLE "public"."form_template_requirements" DROP COLUMN IF EXISTS "requirement_embedding";',
    );
    expect(sql).not.toMatch(
      /^--.*DROP COLUMN IF EXISTS "requirement_embedding"/m,
    );
  });

  it('rebuilds api.form_template_requirements without requirement_embedding, preserving every other projected column', () => {
    const viewMatch = sql.match(
      /CREATE VIEW api\.form_template_requirements WITH \(security_invoker = true\) AS\s+SELECT([\s\S]*?)FROM public\.form_template_requirements;/,
    );
    expect(viewMatch).not.toBeNull();
    const columnList = viewMatch![1];
    expect(columnList).not.toContain('requirement_embedding');
    for (const col of [
      'id',
      'template_name',
      'template_version',
      'template_type',
      'section_ref',
      'section_name',
      'question_number',
      'requirement_text',
      'description',
      'requirement_type',
      'primary_domain',
      'primary_subtopic',
      'secondary_domain',
      'secondary_subtopic',
      'matching_keywords',
      'matching_guidance',
      'is_mandatory',
      'is_current',
      'sector_applicability',
      'word_limit_guidance',
      'display_order',
      'created_at',
      'updated_at',
    ]) {
      expect(columnList).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('preserves the fail-closed grant shape (anon SELECT-only; authenticated/service_role full CRUD)', () => {
    expect(sql).toContain(
      'GRANT SELECT ON api.form_template_requirements TO anon;',
    );
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_template_requirements TO authenticated;',
    );
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_template_requirements TO service_role;',
    );
  });

  it('references DR-036 and the {130.24} provenance', () => {
    expect(sql).toMatch(/DR-036/);
    expect(sql).toMatch(/130\.24/);
  });
});
