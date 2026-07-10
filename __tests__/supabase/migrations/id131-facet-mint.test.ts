/**
 * Static shape check for supabase/migrations/20260706100000_id131_facet_mint.sql
 * (ID-131.38 FACET-MINT). Confirmed applied and live on staging (a 23505
 * collision proved the forward-mint trigger fires) via the owner-gated
 * {131.19} GO sequence. This test pins the migration file's textual shape:
 * both backfills exist with the BI-19 reference_item exclusion documented,
 * both forward-mint triggers exist with ON CONFLICT DO NOTHING, and
 * reference_items is never targeted by an INSERT.
 *
 * Cheap and deliberately non-exhaustive: it is a regression guard against the
 * migration file being edited (e.g. by a later Subtask) in a way that drops
 * one of the two owner_kinds or the idempotency guard, not a substitute for
 * a fresh post-apply verification pass.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations/20260706100000_id131_facet_mint.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

describe('20260706100000_id131_facet_mint.sql', () => {
  it('backfills source_documents into record_lifecycle', () => {
    expect(sql).toMatch(
      /INSERT INTO "public"\."record_lifecycle"[\s\S]*?FROM "public"\."source_documents"/,
    );
    expect(sql).toContain("'source_document'");
  });

  it('backfills q_a_pairs into record_lifecycle', () => {
    expect(sql).toMatch(
      /INSERT INTO "public"\."record_lifecycle"[\s\S]*?FROM "public"\."q_a_pairs"/,
    );
    expect(sql).toContain("'q_a_pair'");
  });

  it('documents the BI-19 reference_item exclusion and never inserts/mints it', () => {
    expect(sql).toMatch(/BI-19/);
    expect(sql).toMatch(/reference_item/i);
    expect(sql).not.toMatch(/INSERT INTO "public"\."reference_items?"/i);
    expect(sql).not.toMatch(/AFTER INSERT ON "public"\."reference_items?"/i);
  });

  it('forward-mints via AFTER INSERT triggers on both owner tables', () => {
    expect(sql).toMatch(
      /AFTER INSERT ON "public"\."source_documents"\s+FOR EACH ROW EXECUTE FUNCTION "public"\."record_lifecycle_mint_source_document"/,
    );
    expect(sql).toMatch(
      /AFTER INSERT ON "public"\."q_a_pairs"\s+FOR EACH ROW EXECUTE FUNCTION "public"\."record_lifecycle_mint_q_a_pair"/,
    );
  });

  it('mint functions are SECURITY DEFINER, owned by postgres, with EXECUTE revoked from PUBLIC', () => {
    // These are the exact properties that make the viewer q_a_pair-insert path
    // safe (see migration header): SECURITY DEFINER + OWNER postgres lets the
    // mint insert bypass record_lifecycle's editor/admin-only INSERT policy
    // regardless of the inserting role, and REVOKE ALL FROM PUBLIC keeps the
    // function trigger-only (never directly callable). A future edit that
    // drops any of the three would silently reopen the RLS gap.
    for (const fn of [
      'record_lifecycle_mint_source_document',
      'record_lifecycle_mint_q_a_pair',
    ]) {
      const createHeader = sql.match(
        new RegExp(
          `CREATE OR REPLACE FUNCTION "public"\\."${fn}"\\(\\) RETURNS "trigger"[\\s\\S]*?AS \\$\\$`,
        ),
      );
      expect(
        createHeader,
        `${fn}: CREATE FUNCTION header not found`,
      ).not.toBeNull();
      expect(createHeader![0]).toMatch(/SECURITY DEFINER/);

      expect(sql).toMatch(
        new RegExp(
          `ALTER FUNCTION "public"\\."${fn}"\\(\\) OWNER TO "postgres";`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION "public"\\."${fn}"\\(\\) FROM PUBLIC;`,
        ),
      );
    }
  });

  it('guards every record_lifecycle INSERT with ON CONFLICT (owner_kind, owner_id) DO NOTHING', () => {
    const inserts = sql.match(
      /INSERT INTO (?:public\.|"public"\.)"?record_lifecycle"?[\s\S]*?;/g,
    );
    expect(inserts).not.toBeNull();
    expect(inserts!.length).toBeGreaterThanOrEqual(4); // 2 backfills + 2 mint-fn bodies
    for (const stmt of inserts!) {
      expect(stmt).toMatch(
        /ON CONFLICT \("?owner_kind"?, "?owner_id"?\) DO NOTHING/,
      );
    }
  });

  it('is idempotent/re-runnable — CREATE OR REPLACE + DROP TRIGGER IF EXISTS', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."record_lifecycle_mint_source_document"/,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."record_lifecycle_mint_q_a_pair"/,
    );
    expect(sql).toMatch(
      /DROP TRIGGER IF EXISTS "trg_record_lifecycle_mint_source_document"/,
    );
    expect(sql).toMatch(
      /DROP TRIGGER IF EXISTS "trg_record_lifecycle_mint_q_a_pair"/,
    );
  });

  it('marks the migration as applied, landed via the {131.19} GO sequence', () => {
    expect(sql).toMatch(/APPLIED/);
    expect(sql).not.toMatch(/AUTHORED, NOT APPLIED/);
    expect(sql).toMatch(/131\.19/);
  });
});
