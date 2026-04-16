/**
 * WP-A: classification_disputes migration guard
 *
 * File-content test that verifies the classification_disputes migration
 * contains all expected RLS policies, CHECK constraints, indexes, and
 * trigger definitions. Follows the same pattern as the existing
 * pipeline-service-account.test.ts and auth-users-insert-guard.test.ts.
 *
 * This does NOT run against a live DB — it parses the migration SQL to
 * verify the structural contract survives future refactors.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');

/**
 * Find the classification_disputes migration file by suffix pattern.
 * The timestamp prefix varies by environment.
 */
function findMigrationFile(): string | null {
  const files = readdirSync(MIGRATIONS_DIR);
  const match = files.find((f) =>
    f.endsWith(
      '_create_classification_disputes_and_peritem_cost_columns.sql',
    ),
  );
  return match ? resolve(MIGRATIONS_DIR, match) : null;
}

describe('classification_disputes migration', () => {
  let migrationPath: string;
  let content: string;

  beforeAll(() => {
    const found = findMigrationFile();
    expect(
      found,
      'classification_disputes migration file must exist',
    ).not.toBeNull();
    migrationPath = found!;
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
      expect(content).toMatch(
        /CREATE TABLE\s+classification_disputes/i,
      );
    });

    it('has content_item_id FK with CASCADE delete', () => {
      expect(content).toMatch(
        /content_item_id\s+uuid\s+NOT NULL\s+REFERENCES\s+content_items\(id\)\s+ON DELETE CASCADE/i,
      );
    });

    it('has disputed_by FK with SET NULL delete', () => {
      expect(content).toMatch(
        /disputed_by\s+uuid\s+REFERENCES\s+auth\.users\(id\)\s+ON DELETE SET NULL/i,
      );
    });

    it('has resolved_by FK with SET NULL delete', () => {
      expect(content).toMatch(
        /resolved_by\s+uuid\s+REFERENCES\s+auth\.users\(id\)\s+ON DELETE SET NULL/i,
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
        expect(
          content,
          `disputed_field must allow '${field}'`,
        ).toContain(`'${field}'`);
      }
      expect(content).toMatch(/disputed_field.*CHECK/is);
    });

    it('status allows exactly open, resolved, rejected', () => {
      expect(content).toContain("'open'");
      expect(content).toContain("'resolved'");
      expect(content).toContain("'rejected'");
      expect(content).toMatch(
        /status\s+text\s+NOT NULL\s+DEFAULT\s+'open'/i,
      );
    });

    it('rationale has minimum length check (>= 10)', () => {
      expect(content).toMatch(
        /length\(trim\(rationale\)\)\s*>=\s*10/i,
      );
    });

    it('resolution completeness constraint exists', () => {
      expect(content).toContain(
        'classification_disputes_resolution_complete',
      );
      // Open must have NULL resolved_by and resolved_at
      expect(content).toMatch(
        /status\s*=\s*'open'\s+AND\s+resolved_by\s+IS\s+NULL\s+AND\s+resolved_at\s+IS\s+NULL/i,
      );
      // Resolved/rejected must have both set
      expect(content).toMatch(
        /resolved_by\s+IS\s+NOT\s+NULL\s+AND\s+resolved_at\s+IS\s+NOT\s+NULL/i,
      );
    });
  });

  // ---------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------

  describe('indexes', () => {
    it('has content_item_id index', () => {
      expect(content).toContain('idx_classification_disputes_item');
      expect(content).toMatch(
        /ON\s+classification_disputes\(content_item_id\)/i,
      );
    });

    it('has partial index on open disputes by status + created_at', () => {
      expect(content).toContain(
        'idx_classification_disputes_status_created',
      );
      expect(content).toMatch(
        /WHERE\s+status\s*=\s*'open'/i,
      );
    });

    it('has disputed_by index', () => {
      expect(content).toContain(
        'idx_classification_disputes_disputed_by',
      );
    });

    it('has partial resolved_by index', () => {
      expect(content).toContain(
        'idx_classification_disputes_resolved_by',
      );
      expect(content).toMatch(
        /WHERE\s+resolved_by\s+IS\s+NOT\s+NULL/i,
      );
    });
  });

  // ---------------------------------------------------------------
  // Trigger
  // ---------------------------------------------------------------

  describe('updated_at trigger', () => {
    it('creates the trigger function with correct search_path', () => {
      expect(content).toContain(
        'set_classification_disputes_updated_at',
      );
      expect(content).toMatch(
        /SET\s+search_path\s*=\s*public,\s*extensions/i,
      );
    });

    it('trigger fires BEFORE UPDATE', () => {
      expect(content).toMatch(
        /BEFORE\s+UPDATE\s+ON\s+classification_disputes/i,
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
      expect(content).toMatch(
        /ALTER\s+TABLE\s+classification_disputes\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
      );
    });

    // -- Admin SELECT all
    it('admin can SELECT all disputes', () => {
      expect(content).toContain(
        'classification_disputes_select_admin',
      );
      expect(content).toMatch(
        /FOR\s+SELECT\s+TO\s+authenticated[\s\S]*?get_user_role\(\)\s*=\s*'admin'/i,
      );
    });

    // -- Editor SELECT own
    it('editor can SELECT own disputes only', () => {
      expect(content).toContain(
        'classification_disputes_select_own',
      );
      // Policy must check both role=editor AND disputed_by=auth.uid()
      expect(content).toMatch(
        /classification_disputes_select_own[\s\S]*?get_user_role\(\)\s*=\s*'editor'/i,
      );
      expect(content).toMatch(
        /classification_disputes_select_own[\s\S]*?disputed_by\s*=\s*auth\.uid\(\)/i,
      );
    });

    // -- Editor/Admin INSERT
    it('editor and admin can INSERT with own disputed_by + open status', () => {
      expect(content).toContain(
        'classification_disputes_insert',
      );
      // Must check role IN ('admin', 'editor')
      expect(content).toMatch(
        /classification_disputes_insert[\s\S]*?IN\s*\(\s*'admin'\s*,\s*'editor'\s*\)/i,
      );
      // Must enforce disputed_by = auth.uid()
      expect(content).toMatch(
        /classification_disputes_insert[\s\S]*?disputed_by\s*=\s*auth\.uid\(\)/i,
      );
      // Must enforce status = 'open'
      expect(content).toMatch(
        /classification_disputes_insert[\s\S]*?status\s*=\s*'open'/i,
      );
      // Must enforce resolved_by IS NULL
      expect(content).toMatch(
        /classification_disputes_insert[\s\S]*?resolved_by\s+IS\s+NULL/i,
      );
      // Must enforce resolved_at IS NULL
      expect(content).toMatch(
        /classification_disputes_insert[\s\S]*?resolved_at\s+IS\s+NULL/i,
      );
      // Must enforce resolution_notes IS NULL
      expect(content).toMatch(
        /classification_disputes_insert[\s\S]*?resolution_notes\s+IS\s+NULL/i,
      );
    });

    // -- Admin UPDATE (resolve)
    it('admin can UPDATE disputes', () => {
      expect(content).toContain(
        'classification_disputes_update_admin',
      );
      expect(content).toMatch(
        /classification_disputes_update_admin[\s\S]*?FOR\s+UPDATE/i,
      );
      expect(content).toMatch(
        /classification_disputes_update_admin[\s\S]*?get_user_role\(\)\s*=\s*'admin'/i,
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
      expect(content).toMatch(
        /classification_disputes_delete_admin_rejected_only[\s\S]*?status\s*=\s*'rejected'/i,
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
      // Extract the INSERT policy block
      const insertPolicy = content.match(
        /CREATE\s+POLICY\s+"classification_disputes_insert"[\s\S]*?;/i,
      );
      expect(insertPolicy).not.toBeNull();
      expect(insertPolicy![0]).toMatch(/disputed_by\s*=\s*auth\.uid\(\)/i);
    });

    it('editor cannot insert a pre-resolved dispute — INSERT enforces status=open + NULL resolution fields', () => {
      const insertPolicy = content.match(
        /CREATE\s+POLICY\s+"classification_disputes_insert"[\s\S]*?;/i,
      );
      expect(insertPolicy).not.toBeNull();
      expect(insertPolicy![0]).toContain("status = 'open'");
      expect(insertPolicy![0]).toMatch(/resolved_by\s+IS\s+NULL/i);
      expect(insertPolicy![0]).toMatch(/resolved_at\s+IS\s+NULL/i);
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
      // USING clause must include status = 'rejected'
      expect(deletePolicy![0]).toMatch(/status\s*=\s*'rejected'/i);
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

    it('adds all 7 cost/token columns to content_items', () => {
      for (const col of expectedColumns) {
        expect(
          content,
          `content_items must gain column '${col}'`,
        ).toMatch(
          new RegExp(
            `ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${col}\\b`,
            'i',
          ),
        );
      }
    });

    it('classification_model and embedding_model are text type', () => {
      expect(content).toMatch(
        /classification_model\s+text/i,
      );
      expect(content).toMatch(
        /embedding_model\s+text/i,
      );
    });

    it('token columns are int type', () => {
      const intColumns = [
        'classification_tokens_in',
        'classification_tokens_out',
        'classification_cache_creation_tokens',
        'classification_cache_read_tokens',
        'embedding_tokens',
      ];
      for (const col of intColumns) {
        expect(content).toMatch(
          new RegExp(`${col}\\s+int`, 'i'),
        );
      }
    });
  });

  // ---------------------------------------------------------------
  // Rollback comment
  // ---------------------------------------------------------------

  describe('rollback', () => {
    it('contains rollback comment with DROP TABLE', () => {
      expect(content).toMatch(/--\s*ROLLBACK:/i);
      expect(content).toMatch(
        /DROP\s+TABLE\s+IF\s+EXISTS\s+classification_disputes/i,
      );
    });

    it('rollback drops the trigger and function', () => {
      expect(content).toMatch(
        /DROP\s+TRIGGER\s+IF\s+EXISTS\s+set_classification_disputes_updated_at_trigger/i,
      );
      expect(content).toMatch(
        /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.set_classification_disputes_updated_at/i,
      );
    });

    it('rollback drops all 7 content_items columns', () => {
      const expectedDrops = [
        'classification_model',
        'classification_tokens_in',
        'classification_tokens_out',
        'classification_cache_creation_tokens',
        'classification_cache_read_tokens',
        'embedding_model',
        'embedding_tokens',
      ];
      for (const col of expectedDrops) {
        expect(content).toMatch(
          new RegExp(
            `DROP\\s+COLUMN\\s+IF\\s+EXISTS\\s+${col}`,
            'i',
          ),
        );
      }
    });
  });

  // ---------------------------------------------------------------
  // Table comments
  // ---------------------------------------------------------------

  describe('table and column comments', () => {
    it('has a table comment', () => {
      expect(content).toMatch(
        /COMMENT\s+ON\s+TABLE\s+classification_disputes/i,
      );
    });

    it('has column comments for current_value, proposed_value, and disputed_by', () => {
      expect(content).toMatch(
        /COMMENT\s+ON\s+COLUMN\s+classification_disputes\.current_value/i,
      );
      expect(content).toMatch(
        /COMMENT\s+ON\s+COLUMN\s+classification_disputes\.proposed_value/i,
      );
      expect(content).toMatch(
        /COMMENT\s+ON\s+COLUMN\s+classification_disputes\.disputed_by/i,
      );
    });
  });
});
