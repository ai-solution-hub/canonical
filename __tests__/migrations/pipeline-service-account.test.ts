/**
 * SI-H2: Pipeline service account migration guard
 *
 * Pure file-content test that verifies the migration which provisions the
 * pipeline service account (used by the SI pipeline for classifyContent
 * audit attribution) is present and well-formed. This test guards against
 * accidental deletion or content drift on the migration that re-creates
 * `pipeline@system.knowledge-hub.internal` on fresh environments.
 *
 * Why a file-content test:
 *   The migration is a one-shot provisioning step. We do not need to
 *   exercise it against a live Supabase instance — we only need to make
 *   sure the SQL contract (user_id, email, idempotency, both target
 *   tables) survives future refactors.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('Pipeline service account migration', () => {
  const migrationPath = resolve(
    __dirname,
    '../../supabase/migrations/20260406180000_create_pipeline_service_account.sql',
  );

  it('migration file exists', () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it('contains the expected service account user_id', () => {
    const content = readFileSync(migrationPath, 'utf-8');
    expect(content).toContain('a0000000-0000-4000-8000-000000000001');
  });

  it('contains the expected service account email', () => {
    const content = readFileSync(migrationPath, 'utf-8');
    expect(content).toContain('pipeline@system.knowledge-hub.internal');
  });

  it('uses ON CONFLICT DO NOTHING for idempotency', () => {
    const content = readFileSync(migrationPath, 'utf-8');
    expect(content).toContain('ON CONFLICT');
    expect(content).toContain('DO NOTHING');
    // Both inserts must be idempotent — we expect at least two
    // ON CONFLICT clauses (auth.users + public.user_roles).
    const onConflictMatches = content.match(/ON CONFLICT/g) ?? [];
    expect(onConflictMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('inserts into auth.users', () => {
    const content = readFileSync(migrationPath, 'utf-8');
    expect(content).toMatch(/INSERT\s+INTO\s+auth\.users/i);
  });

  it('inserts into public.user_roles', () => {
    const content = readFileSync(migrationPath, 'utf-8');
    expect(content).toMatch(/INSERT\s+INTO\s+public\.user_roles/i);
  });

  it('grants the admin role to the pipeline user', () => {
    const content = readFileSync(migrationPath, 'utf-8');
    // The pipeline must be able to write across RLS-protected tables.
    expect(content).toMatch(/'admin'/);
  });
});
