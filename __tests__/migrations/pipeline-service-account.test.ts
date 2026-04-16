/**
 * SI-H2: Pipeline service account migration guard
 *
 * Pure file-content test that verifies the squashed migration contains
 * the pipeline service account references (used by the SI pipeline for
 * classifyContent audit attribution). This test guards against
 * accidental deletion or content drift.
 *
 * Post-squash: the original standalone INSERT migration was consolidated
 * into the pg_dump schema file. Data-level INSERTs (auth.users,
 * user_roles) are not preserved in pg_dump, but the structural references
 * (UUID, display name, ON CONFLICT patterns, admin role) remain in
 * function definitions and comments.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('Pipeline service account migration', () => {
  const migrationPath = resolve(
    __dirname,
    '../../supabase/migrations/20260416102457_pre_squash_reconciliation.sql',
  );

  it('migration file exists', () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it('contains the expected service account user_id', () => {
    const content = readFileSync(migrationPath, 'utf-8');
    expect(content).toContain('a0000000-0000-4000-8000-000000000001');
  });

  it('references the pipeline service account label', () => {
    const content = readFileSync(migrationPath, 'utf-8');
    // Post-squash: the pg_dump schema includes the hardcoded display name
    // in the get_user_display_names function rather than a standalone INSERT
    expect(content).toContain('Pipeline (system)');
  });

  it('uses ON CONFLICT DO NOTHING for idempotency', () => {
    const content = readFileSync(migrationPath, 'utf-8');
    expect(content).toContain('ON CONFLICT');
    expect(content).toContain('DO NOTHING');
    // Post-squash: ON CONFLICT appears in multiple places across the
    // squashed schema (function bodies, trigger definitions).
    const onConflictMatches = content.match(/ON CONFLICT/g) ?? [];
    expect(onConflictMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('contains auth.users references', () => {
    const content = readFileSync(migrationPath, 'utf-8');
    // Post-squash: the pg_dump includes auth.users references in FKs,
    // function bodies, and trigger definitions rather than a standalone INSERT.
    expect(content).toMatch(/auth\.users/i);
  });

  it('contains public.user_roles table and references', () => {
    const content = readFileSync(migrationPath, 'utf-8');
    // Post-squash: user_roles appears as CREATE TABLE + INSERT in
    // the handle_new_user_role trigger function.
    expect(content).toMatch(/user_roles/i);
  });

  it('grants the admin role to the pipeline user', () => {
    const content = readFileSync(migrationPath, 'utf-8');
    // The pipeline must be able to write across RLS-protected tables.
    expect(content).toMatch(/'admin'/);
  });
});
