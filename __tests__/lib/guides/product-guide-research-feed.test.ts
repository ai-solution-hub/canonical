/**
 * Product Guide Research Feed — Migration Validation Tests
 *
 * Validates that the Research Feed migration for Product Guides
 * (S189 WP5) inserts exactly 3 rows with the correct shape,
 * mirroring the existing Sector Guide Research Feed pattern.
 *
 * Reference: docs/client-documentation/kb-hub-gap-analysis-response-s188.md SS7.7
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Constants — verified against live DB on 22/04/2026
// ---------------------------------------------------------------------------

const PRODUCT_GUIDE_IDS = {
  'Advanced Audits': 'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687',
  LMS: 'f216848e-decf-4a86-a19f-f9907b6b55c8',
  Websites: 'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
} as const;

const MIGRATION_FILENAME =
  '20260422174117_add_research_feed_to_product_guides.sql';

// ---------------------------------------------------------------------------
// Read the migration file once
// ---------------------------------------------------------------------------

const migrationsDir = path.resolve(
  __dirname,
  '../../../supabase/migrations',
);
const migrationPath = path.join(migrationsDir, MIGRATION_FILENAME);

let migrationSql: string;
try {
  migrationSql = fs.readFileSync(migrationPath, 'utf-8');
} catch {
  migrationSql = '';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Product Guide Research Feed migration', () => {
  it('migration file exists and is non-empty', () => {
    expect(migrationSql.length).toBeGreaterThan(0);
  });

  describe.each(Object.entries(PRODUCT_GUIDE_IDS))(
    '%s Product Guide',
    (guideName, guideId) => {
      it(`inserts a Research Feed section for ${guideName}`, () => {
        // The guide_id must appear in the migration
        expect(migrationSql).toContain(guideId);
        // The section name must be 'Research Feed'
        expect(migrationSql).toContain("'Research Feed'");
      });

      it(`uses expected_layer = 'research' for ${guideName}`, () => {
        // Find the INSERT block for this guide and verify it contains 'research'
        const guideBlock = extractGuideBlock(migrationSql, guideId);
        expect(guideBlock).toBeTruthy();
        expect(guideBlock).toContain("'research'");
      });

      it(`sets is_required = FALSE for ${guideName}`, () => {
        const guideBlock = extractGuideBlock(migrationSql, guideId);
        expect(guideBlock).toBeTruthy();
        expect(guideBlock).toMatch(/FALSE/i);
      });

      it(`sets display_order = 20 for ${guideName}`, () => {
        const guideBlock = extractGuideBlock(migrationSql, guideId);
        expect(guideBlock).toBeTruthy();
        // display_order appears as the number 20 in the values
        expect(guideBlock).toContain('20');
      });

      it(`has idempotent WHERE NOT EXISTS guard for ${guideName}`, () => {
        const guideBlock = extractGuideBlock(migrationSql, guideId);
        expect(guideBlock).toBeTruthy();
        expect(guideBlock).toMatch(/(?:WHERE|AND)\s+NOT\s+EXISTS/i);
        // The guard checks the same guide_id
        expect(guideBlock).toContain(guideId);
      });

      it(`sets content_type_filter = NULL for ${guideName} (matches Sector Guide pattern)`, () => {
        // The existing Sector Guide Research Feed rows all have
        // content_type_filter = NULL. Product Guides must match.
        const guideBlock = extractGuideBlock(migrationSql, guideId);
        expect(guideBlock).toBeTruthy();
        // The block should contain multiple NULL values for:
        // description, subtopic_filter, content_type_filter, parent_section_id
        const nullCount = (guideBlock!.match(/\bNULL\b/gi) || []).length;
        // At least 4 NULLs in the values + at least 1 more in WHERE NOT EXISTS subquery
        expect(nullCount).toBeGreaterThanOrEqual(4);
        // Should NOT contain a string literal for content_type_filter
        // like 'article' or 'research' as the filter value
        // (The only string values should be the guide_id UUID and
        // 'Research Feed' section name and 'research' layer)
        const stringLiterals = guideBlock!.match(/'[^']+'/g) || [];
        const nonStructuralStrings = stringLiterals.filter(
          (s) =>
            s !== `'${guideId}'` &&
            s !== "'Research Feed'" &&
            s !== "'research'" &&
            !s.includes('::uuid'),
        );
        // No extra string literals = content_type_filter, subtopic_filter,
        // description, and parent_section_id are all NULL
        expect(nonStructuralStrings).toHaveLength(0);
      });
    },
  );

  it('inserts exactly 3 Research Feed rows (one per Product Guide)', () => {
    // Count the number of INSERT statements
    const insertCount = (
      migrationSql.match(/INSERT\s+INTO\s+guide_sections/gi) || []
    ).length;
    expect(insertCount).toBe(3);
  });

  it('does not modify existing Sector Guide or Intelligence Guide sections', () => {
    // Sector Guide IDs that should NOT appear in this migration
    const sectorGuideIds = [
      '77572af7-bda3-44f2-af84-a4ae0902e775', // SCP
      '0bc30f3e-10b7-47a2-b52b-edde1bbb4ade', // SAB
      '865aaadf-ae95-4ad6-99d4-bfd9d5f42dfb', // MATs
      'dfba48a0-272a-4469-a00c-7b0b0a2afb64', // Education Safeguarding
      'd42b2651-5f71-4ce5-931d-3f0755ad193d', // MAT Auditing
    ];
    for (const id of sectorGuideIds) {
      expect(migrationSql).not.toContain(id);
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the SQL block for a specific guide_id's INSERT statement.
 * Looks for the INSERT INTO ... ; block containing this guide_id.
 */
function extractGuideBlock(
  sql: string,
  guideId: string,
): string | null {
  // Split on INSERT INTO statements, keeping the delimiter
  const insertBlocks = sql.split(/(?=INSERT\s+INTO\s+guide_sections)/i);
  for (const block of insertBlocks) {
    // Only consider blocks that are actual INSERT statements (not the header comment)
    if (
      block.includes(guideId) &&
      /^INSERT\s+INTO\s+guide_sections/i.test(block.trim())
    ) {
      return block;
    }
  }
  return null;
}

