// __tests__/lib/intelligence/content-type-update.test.ts
//
// SI-L3 residual guard: the content_items_valid_content_type CHECK
// constraint (squashed migration 20260416102457_pre_squash_reconciliation.sql)
// must stay aligned with VALID_CONTENT_TYPES — the single source of truth on
// the application side (lib/validation/schemas.ts).
//
// Note (ID-75 WP-E, BI-11): inferContentType() and the pipeline content_type
// refinement path were retired with the TS legacy promotion — gate-passed
// feed articles now land in the KB via the Python cocoindex walk, not via
// content_items inserts from lib/intelligence/pipeline.ts. The SI-L3
// inference/refinement suites that exercised the deleted code were removed
// with it. This remaining guard protects the DB-constraint <-> schema-constant
// parity relied on by the manual ingest paths.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VALID_CONTENT_TYPES } from '@/lib/validation/schemas';

describe('SI-L3: migration file enforces canonical CHECK constraint', () => {
  // Guard test: if anyone weakens or removes the constraint, this fails.
  // Post-squash: the constraint is inline in the CREATE TABLE statement
  // within the squashed pg_dump file.
  const migrationPath = join(
    process.cwd(),
    'supabase/migrations/20260416102457_pre_squash_reconciliation.sql',
  );

  it('migration file exists', () => {
    expect(() => readFileSync(migrationPath, 'utf-8')).not.toThrow();
  });

  it('contains the canonical content_type constraint name', () => {
    const sql = readFileSync(migrationPath, 'utf-8');
    // Post-squash: the pg_dump format includes the constraint inline
    // in the CREATE TABLE rather than as a separate DROP+ADD pair.
    expect(sql).toMatch(/content_items_valid_content_type/i);
  });

  it('constraint includes all VALID_CONTENT_TYPES', () => {
    const sql = readFileSync(migrationPath, 'utf-8');
    // Confirm the constraint is present
    expect(sql).toMatch(/content_items_valid_content_type/i);
    // Confirm every canonical type appears in the SQL body
    for (const type of VALID_CONTENT_TYPES) {
      expect(sql).toContain(`'${type}'`);
    }
  });
});
