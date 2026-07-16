/**
 * Tests for scripts/check-migration-fn-table-refs.ts — ID-145 {145.37} SLICE B
 * pre-push gate: a live SQL function whose BODY still references a table a
 * pending migration renamed/dropped away.
 *
 * All fixtures are SYNTHETIC (`widgets`/`gadgets`/`search_widgets`) — the
 * detector is exercised as a pure function over `{path, sql}` pairs, so
 * these tests need no real files, no git, and no real schema. Behaviour
 * under test, not implementation: each case asserts what the gate DECIDES
 * (flag / don't-flag), not which regex fired.
 */
import { describe, expect, it } from 'vitest';

import {
  detectStaleTableRefsInFunctions,
  type MigrationFile,
} from '@/scripts/check-migration-fn-table-refs';

const RENAME_WIDGETS_TO_GADGETS: MigrationFile = {
  path: 'supabase/migrations/20260201000000_rename_widgets.sql',
  sql: `ALTER TABLE "public"."widgets" RENAME TO "gadgets";`,
};

function fnMigration(
  path: string,
  name: string,
  fromTable: string,
): MigrationFile {
  return {
    path,
    sql: `CREATE OR REPLACE FUNCTION "public"."${name}"() RETURNS void
    LANGUAGE "plpgsql"
    AS $function$
BEGIN
  PERFORM 1 FROM "public"."${fromTable}";
END;
$function$;`,
  };
}

describe('detectStaleTableRefsInFunctions', () => {
  it('flags a live function whose body still references a table the pending migration renamed away', () => {
    const staleFn = fnMigration(
      'supabase/migrations/20260115000000_search_widgets.sql',
      'search_widgets',
      'widgets',
    );
    const offenders = detectStaleTableRefsInFunctions(
      [staleFn, RENAME_WIDGETS_TO_GADGETS],
      [RENAME_WIDGETS_TO_GADGETS.path],
    );
    expect(offenders).toEqual([
      {
        functionKey: 'public.search_widgets',
        definedAt: `${staleFn.path}:1`,
        removedTable: 'widgets',
        removedBy: RENAME_WIDGETS_TO_GADGETS.path,
      },
    ]);
  });

  it('reports zero offenders once the LAST-WRITER definition is re-pointed to the new name', () => {
    const staleFn = fnMigration(
      'supabase/migrations/20260115000000_search_widgets.sql',
      'search_widgets',
      'widgets',
    );
    // Chronologically AFTER staleFn — this is the fix migration, and it is
    // the last-writer for `public.search_widgets`, so its clean body is what
    // the detector must see, not the stale one still sitting in history.
    const fixedFn = fnMigration(
      'supabase/migrations/20260301000000_repoint_search_widgets.sql',
      'search_widgets',
      'gadgets',
    );
    const offenders = detectStaleTableRefsInFunctions(
      [staleFn, RENAME_WIDGETS_TO_GADGETS, fixedFn],
      [RENAME_WIDGETS_TO_GADGETS.path],
    );
    expect(offenders).toEqual([]);
  });

  it('does not fold a CREATE TRIGGER ... ON <table> clause after the function body into that function', () => {
    const fnWithTrailingTrigger: MigrationFile = {
      path: 'supabase/migrations/20260115000000_widgets_audit.sql',
      sql: `CREATE OR REPLACE FUNCTION "public"."widgets_audit_fn"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE TRIGGER "widgets_audit_trigger"
    AFTER UPDATE ON "public"."widgets"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."widgets_audit_fn"();`,
    };
    const offenders = detectStaleTableRefsInFunctions(
      [fnWithTrailingTrigger, RENAME_WIDGETS_TO_GADGETS],
      [RENAME_WIDGETS_TO_GADGETS.path],
    );
    expect(offenders).toEqual([]);
  });

  it('ignores a mention of the removed table inside a SQL comment, not a real body reference', () => {
    const commentOnlyFn: MigrationFile = {
      path: 'supabase/migrations/20260115000000_commented_widgets.sql',
      sql: `CREATE OR REPLACE FUNCTION "public"."search_widgets"() RETURNS void
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- historically this read from widgets before the rename; no longer true
  PERFORM 1;
END;
$$;`,
    };
    const offenders = detectStaleTableRefsInFunctions(
      [commentOnlyFn, RENAME_WIDGETS_TO_GADGETS],
      [RENAME_WIDGETS_TO_GADGETS.path],
    );
    expect(offenders).toEqual([]);
  });

  it('does not match an identifier that merely starts with the removed table name (whole-word only)', () => {
    const prefixCollisionFn: MigrationFile = {
      path: 'supabase/migrations/20260115000000_widgets_summary.sql',
      sql: `CREATE OR REPLACE FUNCTION "public"."search_widgets"() RETURNS void
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  PERFORM 1 FROM "public"."widgets_summary";
END;
$$;`,
    };
    const offenders = detectStaleTableRefsInFunctions(
      [prefixCollisionFn, RENAME_WIDGETS_TO_GADGETS],
      [RENAME_WIDGETS_TO_GADGETS.path],
    );
    expect(offenders).toEqual([]);
  });

  it('excludes a function that was DROPped at final state, even if its last body referenced the removed table', () => {
    const staleFn = fnMigration(
      'supabase/migrations/20260115000000_search_widgets.sql',
      'search_widgets',
      'widgets',
    );
    const dropIt: MigrationFile = {
      path: 'supabase/migrations/20260301000000_retire_search_widgets.sql',
      sql: `DROP FUNCTION IF EXISTS "public"."search_widgets"();`,
    };
    const offenders = detectStaleTableRefsInFunctions(
      [staleFn, RENAME_WIDGETS_TO_GADGETS, dropIt],
      [RENAME_WIDGETS_TO_GADGETS.path],
    );
    expect(offenders).toEqual([]);
  });
});
