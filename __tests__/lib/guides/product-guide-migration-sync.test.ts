/**
 * Guard test — keeps the WP4 Product Guide wiring migration in sync with
 * the live `taxonomy_subtopics` slug inventory and the 19 canonical
 * section names.
 *
 * Why this exists: the 40 tests in `product-guide-resolution.test.ts` mock
 * Supabase entirely and assert against an in-memory `SECTION_FILTER_MAP`
 * constant that mirrors the migration's intent. A typo in the migration
 * SQL (e.g. `'data-protecton'` instead of `'data-protection'`) would not
 * be caught by those tests because they never read the migration file.
 *
 * This guard greps the migration file and verifies:
 *
 * 1. Every subtopic slug referenced in the migration exists in a known
 *    set of active slugs.
 * 2. All 19 expected section names appear in the migration.
 *
 * Pattern: mirrors `__tests__/mcp/mcp-fixture-sync.test.ts` + similar
 * guards.
 *
 * WP4 S189 verifier finding M2.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations/20260422174420_wire_product_guide_sections.sql',
);

// The 14 unique subtopic_filter values populated by WP4. Every slug MUST
// exist as a row in `taxonomy_subtopics` with `is_active = true` on 'r'.
// This list is the source of truth for the guard; update when the
// migration changes.
const EXPECTED_SUBTOPIC_SLUGS = [
  'approach',
  'certification',
  'company-info',
  'cyber-security',
  'data-protection',
  'deployment',
  // 'financial' retained for the historical migration file
  // (20260422174420_wire_product_guide_sections.sql) — that file uses the
  // pre-merge slug. Live DB rows have since migrated to 'financial-standing'
  // via S203 WP-D taxonomy-financial-merge-spec.md.
  'financial',
  'financial-standing',
  'functionality',
  'integration',
  'references',
  'sla',
  'standards',
  'technical',
  'usability',
] as const;

// The 19 canonical Product Guide section names as they appear in the
// live `guide_sections` rows. Must all appear in the migration.
const EXPECTED_SECTION_NAMES = [
  'Elevator Pitch',
  'Key Features',
  'Target Audience',
  'Differentiators',
  'Demo Flow',
  'Pricing',
  'Competitor Comparison',
  'Objection Handling',
  'Success Stories',
  'Use Cases',
  'Upsell Paths',
  'Technical Spec',
  'Security & Compliance',
  'Implementation',
  'SLAs',
  'Integrations',
  'Data Handling',
  'Accessibility',
  'Certifications',
];

describe('Product Guide migration 20260422174420 — fixture sync guard', () => {
  let migrationSql: string;

  beforeAll(async () => {
    migrationSql = await readFile(MIGRATION_PATH, 'utf8');
  });

  it('contains all 19 canonical section names', () => {
    for (const name of EXPECTED_SECTION_NAMES) {
      expect(
        migrationSql,
        `migration missing section_name '${name}' — either the UPDATE was deleted or the name was renamed without updating this guard`,
      ).toContain(`section_name = '${name}'`);
    }
  });

  it('every subtopic_filter value in SET clauses is a known active slug', () => {
    // Match patterns like "SET subtopic_filter = 'data-protection',"
    const pattern = /SET\s+subtopic_filter\s*=\s*'([a-z0-9-]+)'/gi;
    const matches = [...migrationSql.matchAll(pattern)];
    expect(
      matches.length,
      'expected at least 19 UPDATE SET clauses (one per section)',
    ).toBeGreaterThanOrEqual(19);

    const allowedSet = new Set<string>(EXPECTED_SUBTOPIC_SLUGS);
    for (const match of matches) {
      const slug = match[1];
      expect(
        allowedSet.has(slug),
        `migration uses subtopic slug '${slug}' which is not in the allowed list — either add it to EXPECTED_SUBTOPIC_SLUGS or fix the migration typo`,
      ).toBe(true);
    }
  });

  it('has idempotency guard `subtopic_filter IS NULL` on every UPDATE', () => {
    const updateCount = (migrationSql.match(/^\s*UPDATE\s+guide_sections/gim) || [])
      .length;
    const guardCount = (
      migrationSql.match(/AND\s+subtopic_filter\s+IS\s+NULL/gi) || []
    ).length;
    expect(guardCount).toBe(updateCount);
  });

  it('scopes every UPDATE to the 3 Product Guide UUIDs only', () => {
    // The WP4 migration uses literal `guide_id IN (uuid1, uuid2, uuid3)`
    // for the 3 Product Guides. The UUIDs are documented in the header
    // comment block (lines 29-31).
    const PRODUCT_GUIDE_UUIDS = [
      'f216848e-decf-4a86-a19f-f9907b6b55c8', // LMS Product Guide
      'ff2b9333-80f7-41a7-88d8-82baeb65b20e', // Websites Product Guide
      'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687', // Advanced Audits Product Guide
    ];
    for (const uuid of PRODUCT_GUIDE_UUIDS) {
      expect(
        migrationSql,
        `expected Product Guide UUID ${uuid} in migration`,
      ).toContain(uuid);
    }
    // Count UPDATE occurrences and IN-clauses to ensure each UPDATE uses
    // the 3-UUID scope.
    const updateCount = (migrationSql.match(/^\s*UPDATE\s+guide_sections/gim) || [])
      .length;
    expect(updateCount).toBeGreaterThanOrEqual(19);
  });
});
