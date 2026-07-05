/**
 * Static shape check for
 * supabase/migrations/20260706160000_bl398_governance_tombstone_filter.sql
 * (BL-398, S450, owner-directed fix-and-delete). This is a SQL-only
 * migration — not applied by this Subtask (author-only, owner-gated apply
 * lands later in the GO sequence) — so there is no live DB to assert
 * behaviour against yet. This test instead pins the migration file's textual
 * shape: all three RPCs (`get_freshness_breakdown`, `get_review_breakdown_stats`,
 * `get_content_owner_stats`) are re-created with the admission_status
 * tombstone guard, and the erasure/reaper functions are deliberately absent.
 *
 * Cheap and deliberately non-exhaustive: a regression guard against the
 * migration file being edited in a way that drops the guard or the
 * signature, not a substitute for the real post-apply verification that
 * happens once the owner-gated GO sequence applies this migration for real.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations/20260706160000_bl398_governance_tombstone_filter.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

describe('20260706160000_bl398_governance_tombstone_filter.sql', () => {
  it('re-creates all three governance/freshness/review RPCs with the exact signature', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."get_freshness_breakdown"\(\) RETURNS TABLE\("freshness" "text", "count" bigint\)/,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."get_review_breakdown_stats"\(\) RETURNS json/,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."get_content_owner_stats"\(\) RETURNS TABLE\("owner_id" "uuid", "total_items" integer, "fresh_count" integer, "aging_count" integer, "stale_count" integer, "expired_count" integer, "unverified_count" integer\)/,
    );
  });

  it('excludes tombstoned rows from get_freshness_breakdown alongside the existing archived_at guard', () => {
    const fnBody = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION "public"."get_freshness_breakdown"',
      ),
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION "public"."get_review_breakdown_stats"',
      ),
    );
    expect(fnBody).toMatch(/sd\.archived_at IS NULL/);
    expect(fnBody).toMatch(/sd\.admission_status <> 'tombstoned'/);
  });

  it('guards every source_documents join in get_review_breakdown_stats except the join-less flagged branch', () => {
    const fnBody = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION "public"."get_review_breakdown_stats"',
      ),
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION "public"."get_content_owner_stats"',
      ),
    );

    // LEFT JOIN branches (total/verified/draft/by_domain) use the
    // sd.id-IS-NULL-safe guard so q_a_pair-owner rows are never dropped.
    const leftJoinGuardCount = (
      fnBody.match(
        /\(sd\.id IS NULL OR sd\.admission_status <> 'tombstoned'\)/g,
      ) ?? []
    ).length;
    expect(leftJoinGuardCount).toBe(4); // total, verified, draft, by_domain

    // overdue extends its existing owner_kind/archived_at guard.
    expect(fnBody).toMatch(
      /\(rl\.owner_kind <> 'source_document' OR \(sd\.archived_at IS NULL AND sd\.admission_status <> 'tombstoned'\)\)/,
    );

    // source_document-only INNER JOIN branches (by_content_type/
    // by_source_file/by_source_document) each add a plain guard. The
    // `AND sd.admission_status <> 'tombstoned'` substring also appears once
    // more embedded inside the overdue guard asserted above (`archived_at IS
    // NULL AND sd.admission_status <> 'tombstoned'`), so this count is 4:
    // by_content_type, by_source_file, by_source_document, plus overdue's.
    const plainGuardCount = (
      fnBody.match(/AND sd\.admission_status <> 'tombstoned'/g) ?? []
    ).length;
    expect(plainGuardCount).toBe(4);

    // 'flagged' has no source_documents join — confirm it stays untouched.
    const flaggedBlock = fnBody.slice(
      fnBody.indexOf("'flagged', ("),
      fnBody.indexOf("'draft', ("),
    );
    expect(flaggedBlock).not.toMatch(/source_documents/);
  });

  it('extends the existing owner_kind guard in get_content_owner_stats with admission_status', () => {
    const fnBody = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION "public"."get_content_owner_stats"',
      ),
    );
    expect(fnBody).toMatch(
      /\(rl\.owner_kind <> 'source_document' OR \(sd\.archived_at IS NULL AND sd\.admission_status <> 'tombstoned'\)\)/,
    );
  });

  it('does NOT touch the erasure/reaper functions (they must keep seeing tombstoned rows)', () => {
    // The file header documents these two functions BY NAME as deliberately
    // out of scope (prose only) — assert there's no CREATE/DROP touching
    // either, not that the name never appears in a comment.
    expect(sql).not.toMatch(
      /(CREATE|DROP) (OR REPLACE )?FUNCTION[^;]*tombstone_source_document/,
    );
    expect(sql).not.toMatch(
      /(CREATE|DROP) (OR REPLACE )?FUNCTION[^;]*reap_orphaned_source_documents/,
    );
  });

  it('documents author-only status (no apply in this Subtask)', () => {
    expect(sql).toMatch(/AUTHORED, NOT APPLIED/);
    expect(sql).toMatch(/BL-398/);
  });
});
