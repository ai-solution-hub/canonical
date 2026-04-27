/**
 * WP-A: classification_disputes migration guard
 *
 * File-content test that verifies the squashed migration file contains all
 * expected classification_disputes definitions: RLS policies, CHECK
 * constraints, indexes, trigger, FK constraints, and per-item cost columns.
 *
 * This does NOT run against a live DB — it parses the migration SQL to
 * verify the structural contract survives future refactors.
 *
 * Post-squash: all 43 migrations were consolidated into a single pg_dump
 * schema file. Assertions target the pg_dump output format rather than the
 * original imperative migration syntax.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SQUASHED_MIGRATION = resolve(
  __dirname,
  '../../supabase/migrations/20260416102457_pre_squash_reconciliation.sql',
);

describe('classification_disputes migration', () => {
  let migrationPath: string;
  let content: string;

  beforeAll(() => {
    migrationPath = SQUASHED_MIGRATION;
    expect(
      existsSync(migrationPath),
      'squashed migration file must exist',
    ).toBe(true);
    content = readFileSync(migrationPath, 'utf-8');
  });

  it('migration file exists and is non-empty', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(content.length).toBeGreaterThan(100);
  });

  // ---------------------------------------------------------------
  // Table structure
  // ---------------------------------------------------------------

  describe('table structure', () => {
    it('creates the classification_disputes table', () => {
      // pg_dump format: CREATE TABLE IF NOT EXISTS "public"."classification_disputes"
      expect(content).toMatch(/CREATE TABLE.*classification_disputes/i);
    });

    it('has content_item_id FK with CASCADE delete', () => {
      // pg_dump emits FKs as separate ALTER TABLE ADD CONSTRAINT statements
      expect(content).toMatch(
        /classification_disputes_content_item_id_fkey.*FOREIGN KEY.*content_item_id.*REFERENCES.*content_items.*ON DELETE CASCADE/is,
      );
    });

    it('has disputed_by FK with SET NULL delete', () => {
      expect(content).toMatch(
        /classification_disputes_disputed_by_fkey.*FOREIGN KEY.*disputed_by.*REFERENCES.*auth.*users.*ON DELETE SET NULL/is,
      );
    });

    it('has resolved_by FK with SET NULL delete', () => {
      expect(content).toMatch(
        /classification_disputes_resolved_by_fkey.*FOREIGN KEY.*resolved_by.*REFERENCES.*auth.*users.*ON DELETE SET NULL/is,
      );
    });
  });

  // ---------------------------------------------------------------
  // CHECK constraints
  // ---------------------------------------------------------------

  describe('CHECK constraints', () => {
    it('disputed_field allows exactly the 7 expected values', () => {
      const expectedFields = [
        'primary_domain',
        'primary_subtopic',
        'secondary_domain',
        'secondary_subtopic',
        'primary_layer',
        'content_type',
        'entity_type',
      ];
      for (const field of expectedFields) {
        expect(content, `disputed_field must allow '${field}'`).toContain(
          `'${field}'`,
        );
      }
      expect(content).toMatch(/classification_disputes_disputed_field_check/i);
    });

    it('status allows exactly open, resolved, rejected', () => {
      expect(content).toContain("'open'");
      expect(content).toContain("'resolved'");
      expect(content).toContain("'rejected'");
      // pg_dump format: "status" "text" DEFAULT 'open'::"text" NOT NULL
      expect(content).toMatch(/status.*text.*DEFAULT\s+'open'/i);
    });

    it('rationale has minimum length check (>= 10)', () => {
      // pg_dump format: "length"(TRIM(BOTH FROM "rationale")) >= 10
      expect(content).toMatch(/length.*trim.*rationale.*>=\s*10/i);
    });

    it('resolution completeness constraint exists', () => {
      expect(content).toContain('classification_disputes_resolution_complete');
      // Open must have NULL resolved_by and resolved_at
      expect(content).toMatch(
        /status.*=\s*'open'.*AND.*resolved_by.*IS\s+NULL.*AND.*resolved_at.*IS\s+NULL/is,
      );
      // Resolved/rejected must have both set
      expect(content).toMatch(
        /resolved_by.*IS\s+NOT\s+NULL.*AND.*resolved_at.*IS\s+NOT\s+NULL/is,
      );
    });
  });

  // ---------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------

  describe('indexes', () => {
    it('has content_item_id index', () => {
      expect(content).toContain('idx_classification_disputes_item');
      // pg_dump format: ON "public"."classification_disputes" USING "btree" ("content_item_id")
      expect(content).toMatch(
        /ON\s+"?public"?\."?classification_disputes"?.*"?content_item_id"?/i,
      );
    });

    it('has partial index on open disputes by status + created_at', () => {
      expect(content).toContain('idx_classification_disputes_status_created');
      // pg_dump format: WHERE ("status" = 'open'::"text")
      expect(content).toMatch(/WHERE\s+\(?"?status"?\s*=\s*'open'/i);
    });

    it('has disputed_by index', () => {
      expect(content).toContain('idx_classification_disputes_disputed_by');
    });

    it('has partial resolved_by index', () => {
      expect(content).toContain('idx_classification_disputes_resolved_by');
      // pg_dump format: WHERE ("resolved_by" IS NOT NULL)
      expect(content).toMatch(/WHERE\s+\(?"?resolved_by"?\s+IS\s+NOT\s+NULL/i);
    });
  });

  // ---------------------------------------------------------------
  // Trigger
  // ---------------------------------------------------------------

  describe('updated_at trigger', () => {
    it('creates the trigger function with correct search_path', () => {
      expect(content).toContain('set_classification_disputes_updated_at');
      // pg_dump format uses quoted identifiers: SET "search_path" TO 'public', 'extensions'
      expect(content).toMatch(/search_path.*public.*extensions/i);
    });

    it('trigger fires BEFORE UPDATE', () => {
      // pg_dump format: BEFORE UPDATE ON "public"."classification_disputes"
      expect(content).toMatch(
        /BEFORE\s+UPDATE\s+ON\s+"?public"?\."?classification_disputes"?/i,
      );
    });

    it('trigger sets NEW.updated_at = now()', () => {
      expect(content).toMatch(/NEW\.updated_at\s*=\s*now\(\)/i);
    });
  });

  // ---------------------------------------------------------------
  // RLS policies — happy paths
  // ---------------------------------------------------------------

  describe('RLS policies', () => {
    it('enables RLS on classification_disputes', () => {
      // pg_dump format: ALTER TABLE "public"."classification_disputes" ENABLE ROW LEVEL SECURITY
      expect(content).toMatch(
        /ALTER\s+TABLE\s+"?public"?\."?classification_disputes"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
      );
    });

    // -- Admin SELECT all
    it('admin can SELECT all disputes', () => {
      expect(content).toContain('classification_disputes_select_admin');
      // pg_dump format: "public"."get_user_role"() = 'admin'::"text"
      expect(content).toMatch(
        /FOR\s+SELECT\s+TO\s+"?authenticated"?[\s\S]*?get_user_role"?\(\)\s*=\s*'admin'/i,
      );
    });

    // -- Editor SELECT own
    it('editor can SELECT own disputes only', () => {
      expect(content).toContain('classification_disputes_select_own');
      // pg_dump format: "public"."get_user_role"() = 'editor'::"text"
      expect(content).toMatch(
        /classification_disputes_select_own[\s\S]*?get_user_role"?\(\)\s*=\s*'editor'/i,
      );
      // pg_dump format: ("disputed_by" = "auth"."uid"())
      expect(content).toMatch(
        /classification_disputes_select_own[\s\S]*?disputed_by"?\s*=\s*"?auth"?\."?uid"?\(/i,
      );
    });

    // -- Editor/Admin INSERT
    it('editor and admin can INSERT with own disputed_by + open status', () => {
      expect(content).toContain('classification_disputes_insert');
      // Must check role IN ('admin', 'editor') — pg_dump uses ARRAY syntax
      expect(content).toMatch(
        /classification_disputes_insert[\s\S]*?'admin'[\s\S]*?'editor'/i,
      );
      // pg_dump format: ("disputed_by" = "auth"."uid"())
      expect(content).toMatch(
        /classification_disputes_insert[\s\S]*?disputed_by"?\s*=\s*"?auth"?\."?uid"?\(/i,
      );
      // pg_dump format: ("status" = 'open'::"text")
      expect(content).toMatch(
        /classification_disputes_insert[\s\S]*?status"?\s*=\s*'open'/i,
      );
      // Must enforce resolved_by IS NULL
      expect(content).toMatch(
        /classification_disputes_insert[\s\S]*?resolved_by"?\s+IS\s+NULL/i,
      );
      // Must enforce resolved_at IS NULL
      expect(content).toMatch(
        /classification_disputes_insert[\s\S]*?resolved_at"?\s+IS\s+NULL/i,
      );
      // Must enforce resolution_notes IS NULL
      expect(content).toMatch(
        /classification_disputes_insert[\s\S]*?resolution_notes"?\s+IS\s+NULL/i,
      );
    });

    // -- Admin UPDATE (resolve)
    it('admin can UPDATE disputes', () => {
      expect(content).toContain('classification_disputes_update_admin');
      expect(content).toMatch(
        /classification_disputes_update_admin[\s\S]*?FOR\s+UPDATE/i,
      );
      // pg_dump format: "public"."get_user_role"() = 'admin'::"text"
      expect(content).toMatch(
        /classification_disputes_update_admin[\s\S]*?get_user_role"?\(\)\s*=\s*'admin'/i,
      );
    });

    // -- Admin DELETE rejected only
    it('admin can DELETE rejected disputes only', () => {
      expect(content).toContain(
        'classification_disputes_delete_admin_rejected_only',
      );
      expect(content).toMatch(
        /classification_disputes_delete_admin_rejected_only[\s\S]*?FOR\s+DELETE/i,
      );
      // pg_dump format: ("status" = 'rejected'::"text")
      expect(content).toMatch(
        /classification_disputes_delete_admin_rejected_only[\s\S]*?status"?\s*=\s*'rejected'/i,
      );
    });

    // ---------------------------------------------------------------
    // RLS policies — negative paths (structural verification)
    // ---------------------------------------------------------------

    it('no viewer SELECT policy exists (viewer has no access)', () => {
      // There should be no policy that allows viewer role
      const viewerPolicyMatch = content.match(
        /CREATE\s+POLICY[^;]*classification_disputes[^;]*'viewer'[^;]*/gi,
      );
      expect(viewerPolicyMatch).toBeNull();
    });

    it('editor cannot impersonate — INSERT enforces disputed_by = auth.uid()', () => {
      // The INSERT policy WITH CHECK clause must enforce disputed_by = auth.uid()
      // pg_dump format: ("disputed_by" = "auth"."uid"())
      const insertPolicy = content.match(
        /CREATE\s+POLICY\s+"classification_disputes_insert"[\s\S]*?;/i,
      );
      expect(insertPolicy).not.toBeNull();
      expect(insertPolicy![0]).toMatch(
        /disputed_by"?\s*=\s*"?auth"?\."?uid"?\(/i,
      );
    });

    it('editor cannot insert a pre-resolved dispute — INSERT enforces status=open + NULL resolution fields', () => {
      const insertPolicy = content.match(
        /CREATE\s+POLICY\s+"classification_disputes_insert"[\s\S]*?;/i,
      );
      expect(insertPolicy).not.toBeNull();
      // pg_dump format: ("status" = 'open'::"text")
      expect(insertPolicy![0]).toMatch(/status"?\s*=\s*'open'/i);
      expect(insertPolicy![0]).toMatch(/resolved_by"?\s+IS\s+NULL/i);
      expect(insertPolicy![0]).toMatch(/resolved_at"?\s+IS\s+NULL/i);
    });

    it('no editor UPDATE policy exists (editors cannot update disputes)', () => {
      // Only admin has UPDATE. Check there's no editor UPDATE policy.
      const updatePolicies = content.match(
        /CREATE\s+POLICY[^;]*FOR\s+UPDATE[^;]*/gi,
      );
      expect(updatePolicies).not.toBeNull();
      // All UPDATE policies must reference admin, not editor
      for (const policy of updatePolicies!) {
        expect(policy).not.toMatch(/get_user_role\(\)\s*=\s*'editor'/i);
      }
    });

    it('admin cannot delete non-rejected disputes — DELETE USING checks status=rejected', () => {
      const deletePolicy = content.match(
        /CREATE\s+POLICY\s+"classification_disputes_delete_admin_rejected_only"[\s\S]*?;/i,
      );
      expect(deletePolicy).not.toBeNull();
      // pg_dump format: ("status" = 'rejected'::"text")
      expect(deletePolicy![0]).toMatch(/status"?\s*=\s*'rejected'/i);
    });
  });

  // ---------------------------------------------------------------
  // Part B: per-item cost columns on content_items
  // ---------------------------------------------------------------

  describe('content_items cost/token columns', () => {
    const expectedColumns = [
      'classification_model',
      'classification_tokens_in',
      'classification_tokens_out',
      'classification_cache_creation_tokens',
      'classification_cache_read_tokens',
      'embedding_model',
      'embedding_tokens',
    ];

    it('includes all 7 cost/token columns in content_items', () => {
      // Post-squash: columns appear inline in CREATE TABLE, not as ADD COLUMN
      for (const col of expectedColumns) {
        expect(content, `content_items must have column '${col}'`).toMatch(
          new RegExp(`"${col}"`, 'i'),
        );
      }
    });

    it('classification_model and embedding_model are text type', () => {
      // pg_dump format: "classification_model" "text"
      expect(content).toMatch(/"classification_model"\s+"text"/i);
      expect(content).toMatch(/"embedding_model"\s+"text"/i);
    });

    it('token columns are integer type', () => {
      const intColumns = [
        'classification_tokens_in',
        'classification_tokens_out',
        'classification_cache_creation_tokens',
        'classification_cache_read_tokens',
        'embedding_tokens',
      ];
      for (const col of intColumns) {
        // pg_dump format: "column_name" integer
        expect(content).toMatch(new RegExp(`"${col}"\\s+integer`, 'i'));
      }
    });
  });

  // ---------------------------------------------------------------
  // Structural completeness (replaces rollback comment checks
  // from the pre-squash imperative migration format)
  // ---------------------------------------------------------------

  describe('structural completeness', () => {
    it('table, trigger, and function are all present', () => {
      // These are the objects a rollback would need to drop —
      // verifying they exist in the squashed schema confirms the
      // squash preserved the full structural contract.
      expect(content).toMatch(
        /CREATE TABLE IF NOT EXISTS "public"\."classification_disputes"/i,
      );
      expect(content).toContain(
        'set_classification_disputes_updated_at_trigger',
      );
      expect(content).toContain('set_classification_disputes_updated_at');
    });

    it('all 7 cost/token columns are present in content_items', () => {
      const expectedColumns = [
        'classification_model',
        'classification_tokens_in',
        'classification_tokens_out',
        'classification_cache_creation_tokens',
        'classification_cache_read_tokens',
        'embedding_model',
        'embedding_tokens',
      ];
      for (const col of expectedColumns) {
        expect(content).toContain(`"${col}"`);
      }
    });
  });

  // ---------------------------------------------------------------
  // Table comments
  // ---------------------------------------------------------------

  describe('table and column comments', () => {
    it('has a table comment', () => {
      // pg_dump format: COMMENT ON TABLE "public"."classification_disputes"
      expect(content).toMatch(
        /COMMENT\s+ON\s+TABLE\s+"?public"?\."?classification_disputes"?/i,
      );
    });

    it('has column comments for current_value, proposed_value, and disputed_by', () => {
      expect(content).toMatch(
        /COMMENT\s+ON\s+COLUMN\s+"?public"?\."?classification_disputes"?\."?current_value"?/i,
      );
      expect(content).toMatch(
        /COMMENT\s+ON\s+COLUMN\s+"?public"?\."?classification_disputes"?\."?proposed_value"?/i,
      );
      expect(content).toMatch(
        /COMMENT\s+ON\s+COLUMN\s+"?public"?\."?classification_disputes"?\."?disputed_by"?/i,
      );
    });
  });
});
