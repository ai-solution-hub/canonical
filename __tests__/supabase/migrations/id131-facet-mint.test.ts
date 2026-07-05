/**
 * Static shape check for supabase/migrations/20260705100000_id131_facet_mint.sql
 * (ID-131.38 FACET-MINT). This is a SQL-only migration — not applied by this
 * Subtask (owner-gated apply lands later in the {131.19} GO sequence) — so
 * there is no live DB to assert behaviour against yet. This test instead pins
 * the migration file's textual shape: both backfills exist with the BI-19
 * reference_item exclusion documented, both forward-mint triggers exist with
 * ON CONFLICT DO NOTHING, and reference_items is never targeted by an INSERT.
 *
 * Cheap and deliberately non-exhaustive: it is a regression guard against the
 * migration file being edited (e.g. by a later Subtask) in a way that drops
 * one of the two owner_kinds or the idempotency guard, not a substitute for
 * the real post-apply verification (gov review returns 200, not 409) that
 * happens once the migration is actually applied.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations/20260705100000_id131_facet_mint.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

describe('20260705100000_id131_facet_mint.sql', () => {
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

  it('marks the migration as authored-but-not-applied, owner-gated for the {131.19} GO sequence', () => {
    expect(sql).toMatch(/AUTHORED, NOT APPLIED/);
    expect(sql).toMatch(/131\.19/);
  });
});
