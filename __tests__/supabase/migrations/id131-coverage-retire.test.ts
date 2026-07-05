/**
 * Static shape check for
 * supabase/migrations-blocked/20260706104000_id131_coverage_retire.sql
 * (ID-131.19 fix-Executor escalation 2, DR-034 owner ruling). This is a
 * SQL-only migration — not applied by this Subtask (owner-gated apply lands
 * later in the {131.19} GO sequence) — so there is no live DB to assert
 * behaviour against yet. This test instead pins the migration file's
 * textual shape: both RPCs are dropped in both schemas with the correct
 * signature, `get_guide_coverage` is deliberately NOT touched (its
 * disposition is a separate, unresolved escalation), and the
 * authored-but-not-applied marker is present.
 *
 * Cheap and deliberately non-exhaustive: a regression guard against the
 * migration file being edited in a way that drops the wrong signature or
 * silently starts touching get_guide_coverage, not a substitute for the
 * real post-apply verification that happens once the {131.19} GO applies
 * this migration for real.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations-blocked/20260706104000_id131_coverage_retire.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

describe('20260706104000_id131_coverage_retire.sql', () => {
  it('drops the api.* wrapper for both retiring RPCs with the exact signature', () => {
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS api\.get_coverage_matrix\(p_layer text\);/,
    );
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS api\.get_coverage_summary\(\);/,
    );
  });

  it('drops the public.* backing implementation for both retiring RPCs with the exact signature', () => {
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS public\.get_coverage_matrix\(p_layer text\);/,
    );
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS public\.get_coverage_summary\(\);/,
    );
  });

  it('drops the api.* wrapper before the public.* backing implementation (dependents before base)', () => {
    const apiIdx = sql.indexOf(
      'DROP FUNCTION IF EXISTS api.get_coverage_matrix',
    );
    const publicIdx = sql.indexOf(
      'DROP FUNCTION IF EXISTS public.get_coverage_matrix',
    );
    expect(apiIdx).toBeGreaterThan(-1);
    expect(publicIdx).toBeGreaterThan(-1);
    expect(apiIdx).toBeLessThan(publicIdx);
  });

  it('does NOT touch get_guide_coverage — its disposition is a separate, unresolved escalation', () => {
    expect(sql).not.toMatch(/DROP FUNCTION[^\n]*get_guide_coverage/);
    // The header must still document why, so the gap isn't silently lost.
    expect(sql).toMatch(/get_guide_coverage/);
    expect(sql).toMatch(/app\/api\/guides\/route\.ts/);
  });

  it('documents the DR-034 owner ruling as the retirement rationale', () => {
    expect(sql).toMatch(/DR-034/);
  });

  it('marks the migration as authored-but-not-applied, owner-gated for the {131.19} GO sequence', () => {
    expect(sql).toMatch(/AUTHORED, NOT APPLIED/);
    expect(sql).toMatch(/131\.19/);
  });
});
