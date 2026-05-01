/**
 * S217 W1C guard — `get_filter_counts` widening to publication_status='published'.
 *
 * Background:
 *   The S216 W3 §5.2 Phase 3 widening (20260430192325_widen_search_rpcs_visibility_filter.sql)
 *   intentionally punted `get_filter_counts` to a follow-up. Pre-W1C, this
 *   RPC filtered on `archived_at IS NULL`, which expanded to {draft, in_review,
 *   published}. W3 default search semantics narrow to `publication_status='published'`,
 *   so browse-sidebar counts and search results drifted on the same surface.
 *
 *   S217 W1C migration (20260501173008_widen_get_filter_counts_publication_status.sql)
 *   replaces the `archived_at IS NULL` predicate with `publication_status='published'`
 *   in all three sub-aggregations (domain, content_type, platform), and
 *   revokes anon EXECUTE per `feedback_supabase_pg_default_acl_anon_execute`.
 *
 * What this test enforces:
 *   1. The W1C migration file exists with the expected name.
 *   2. The function definition references `publication_status = 'published'`
 *      at least three times (one per sub-aggregation).
 *   3. The function definition does NOT reference `archived_at IS NULL` —
 *      the historical predicate must be removed, not coexisting.
 *   4. The migration includes `REVOKE EXECUTE ... FROM anon` per the
 *      pg_default_acl feedback pattern.
 *
 * Why a file-content test, not an integration test:
 *   The integration test would require a live DB + service-role key + seeded
 *   fixtures across all four publication states, none of which are available
 *   in the default `bun run test` runner (see feedback_test_runners_split).
 *   This guard catches the most common regression — someone reverting the
 *   migration body in a future cleanup — at the file-content level, fast and
 *   environmentally portable.
 *
 * Companion behavioural coverage lives in
 *   __tests__/integration/publication-status-rpc-visibility.integration.test.ts
 * which already exercises hybrid_search / search_for_bid_response /
 *   search_content_chunks. Future S217 work can extend that file with a
 *   `get_filter_counts` block; this guard captures the structural invariant
 *   in the meantime.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../supabase/migrations/20260501173008_widen_get_filter_counts_publication_status.sql',
);

describe('S217 W1C — get_filter_counts widening to publication_status=published', () => {
  it('migration file exists', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  const migration = existsSync(MIGRATION_PATH)
    ? readFileSync(MIGRATION_PATH, 'utf-8')
    : '';

  it('function body references publication_status = published in all three sub-aggregations', () => {
    // Three sub-aggregations: domain, content_type, platform.
    const matches = migration.match(/publication_status\s*=\s*'published'/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('function body does NOT reference the legacy archived_at IS NULL predicate', () => {
    // The migration's HEADER comment mentions `archived_at IS NULL` while
    // explaining the historical state, but the function BODY (between AS $$
    // and $$;) must not.
    const bodyMatch = migration.match(/AS\s+\$\$([\s\S]*?)\$\$;/);
    expect(bodyMatch).not.toBeNull();
    const body = bodyMatch?.[1] ?? '';
    expect(body).not.toMatch(/archived_at\s+IS\s+NULL/i);
  });

  it('migration revokes anon EXECUTE per pg_default_acl feedback pattern', () => {
    expect(migration).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_filter_counts\(\)\s+FROM\s+anon/i,
    );
  });

  it('migration grants EXECUTE to authenticated and service_role', () => {
    expect(migration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_filter_counts\(\)\s+TO\s+authenticated/i,
    );
    expect(migration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_filter_counts\(\)\s+TO\s+service_role/i,
    );
  });

  it('function declaration sets the canonical search_path', () => {
    expect(migration).toMatch(
      /SET\s+search_path\s+TO\s+'public',\s*'extensions'/i,
    );
  });
});
