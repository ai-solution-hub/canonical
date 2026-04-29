/**
 * Edit-coupled reference-doc freshness guard.
 *
 * For every tracked canonical reference and runbook doc, asserts that the
 * most recent commit touching the file ALSO modified the
 * `<!-- Last verified: ... -->` header line in the same commit. Commits whose
 * message body contains the literal string `[skip-doc-freshness-guard]` are
 * exempt — this is how the WP2a seed commit (`943eb13b`) is excluded, since
 * it planted the header for the first time and has no prior value to bump.
 *
 * Pattern: same as `__tests__/validation/pipeline-parity.test.ts` — drives
 * iteration from a shared constant (`TRACKED_REFERENCE_DOCS`) so the test
 * list cannot drift from the consumer list. Reference:
 * `feedback_guard_test_iteration_list_drift`.
 */

import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { TRACKED_REFERENCE_DOCS } from '@/lib/docs/tracked-reference-docs';

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });
}

describe('Reference doc edit-coupled freshness', () => {
  it.each(TRACKED_REFERENCE_DOCS)(
    '%s last touch must bump Last verified',
    (doc) => {
      const sha = git(['log', '-1', '--format=%H', '--', doc]).trim();
      expect(
        sha,
        `No commit found touching ${doc}. ` +
          'The tracked-doc list may be out of sync with the working tree.',
      ).not.toBe('');

      const message = git(['show', '-s', '--format=%B', sha]);
      if (message.includes('[skip-doc-freshness-guard]')) {
        // skipped: seed commit (or an explicit one-off skip) — no bump required.
        expect(true).toBe(true);
        return;
      }

      const patch = git(['show', '--format=', sha, '--', doc]);
      const headerAdded = patch
        .split('\n')
        .some((line) => line.startsWith('+<!-- Last verified:'));
      expect(
        headerAdded,
        `Tracked doc ${doc} was last modified by ${sha}, but that commit ` +
          'did not bump the `<!-- Last verified: ... -->` header. ' +
          'Run `/kpf:refresh-reference-docs` (or update the header by hand) ' +
          'and amend the commit. To intentionally skip this guard for a ' +
          'one-off commit, include `[skip-doc-freshness-guard]` in the ' +
          'commit message body.',
      ).toBe(true);
    },
  );
});

/**
 * Migration-coupled SCHEMA-QUICK-REFERENCE.md freshness guard.
 *
 * Source: S210 ref-doc-optimisation, agent B scoping doc
 * (`.planning/.research/s210-ref-doc-optimisation/B-schema-quick-ref-automation.md`)
 * §4.4 "Option (d) stronger CI freshness gate" — the cheap-insurance fallback
 * shipped immediately while the full marker-based regeneration programme
 * (Option b) is deferred (roadmap §9.18).
 *
 * Asserts the most recent commit touching `supabase/migrations/*.sql` ALSO
 * touched `docs/reference/SCHEMA-QUICK-REFERENCE.md` (or has the explicit
 * `[skip-doc-freshness-guard]` escape hatch in its commit body — same
 * convention as the existing guard above).
 *
 * Escape-hatch use cases:
 *   - Pure DML backfills (no DDL impact, e.g. UPDATE-only migrations)
 *   - Index renames or other cosmetic migrations
 *   - Migrations that only re-affirm existing schema (idempotent guards)
 *
 * Why this exists: per the scoping doc, 19 of the last 20 migration commits
 * did NOT pair with a SCHEMA-QUICK-REF bump, and the doc has been touched
 * 16 times in April 2026 alone via after-the-fact catch-up. This gate makes
 * the manual "remember to update the schema doc" workflow non-optional.
 */
describe('Migration-coupled SCHEMA-QUICK-REF freshness', () => {
  const SCHEMA_DOC = 'docs/reference/SCHEMA-QUICK-REFERENCE.md';

  it('most recent migration commit must also bump SCHEMA-QUICK-REF', () => {
    const sha = git([
      'log',
      '-1',
      '--format=%H',
      '--',
      'supabase/migrations/*.sql',
    ]).trim();
    expect(
      sha,
      'No commit found touching supabase/migrations/*.sql. ' +
        'The migration directory may be empty or the test is running outside a git checkout.',
    ).not.toBe('');

    const message = git(['show', '-s', '--format=%B', sha]);
    if (message.includes('[skip-doc-freshness-guard]')) {
      // skipped: pure DML backfill, cosmetic migration (e.g. index rename),
      // or otherwise schema-noop. Same convention as the seed-commit escape
      // hatch in the parameterised guard above.
      expect(true).toBe(true);
      return;
    }

    const filesTouched = git([
      'show',
      '--name-only',
      '--format=',
      sha,
    ])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const docTouched = filesTouched.includes(SCHEMA_DOC);
    expect(
      docTouched,
      `Migration commit ${sha} touched supabase/migrations/*.sql but did NOT ` +
        `also touch ${SCHEMA_DOC}. ` +
        'Bump the schema doc (column tables, CHECK enums, RLS, RPC sigs, ' +
        'trigger bodies, indexes, FKs, views — whichever the migration ' +
        'affects) and the `<!-- Last verified: ... -->` header in the same ' +
        'commit. If the migration is non-schema-impacting (pure DML ' +
        'backfill, index rename only, idempotent guard re-affirm), include ' +
        '`[skip-doc-freshness-guard]` in the commit message body to skip ' +
        'this check. Source: ' +
        '`.planning/.research/s210-ref-doc-optimisation/B-schema-quick-ref-automation.md` §4.4.',
    ).toBe(true);
  });
});
