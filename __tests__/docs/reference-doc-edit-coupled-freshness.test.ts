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
