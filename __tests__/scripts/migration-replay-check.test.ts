import { describe, it, expect } from 'vitest';
import {
  extractFailingMigration,
  shouldDeleteBranch,
} from '@/scripts/migration-replay-check';

describe('extractFailingMigration', () => {
  it('returns the last "Applying migration <file>" filename before failure', () => {
    const out = [
      'Applying migration 20260101000001_first.sql',
      'Applying migration 20260101000002_second.sql',
      'Applying migration 20260101000003_third.sql',
      'ERROR: relation "foo" does not exist',
    ].join('\n');
    expect(extractFailingMigration(out)).toBe('20260101000003_third.sql');
  });

  it('returns undefined when no Applying-migration line is present', () => {
    expect(extractFailingMigration('connection refused')).toBeUndefined();
  });
});

describe('shouldDeleteBranch (S19 WP1.4)', () => {
  const prNumber = '42';
  const runId = '12345';

  describe('exact scope (post-job cleanup-only)', () => {
    it('matches only the current-run branch', () => {
      expect(
        shouldDeleteBranch('ci-replay-42-12345', prNumber, runId, 'exact'),
      ).toBe(true);
    });

    it('does not match a different run id for the same PR', () => {
      expect(
        shouldDeleteBranch('ci-replay-42-99999', prNumber, runId, 'exact'),
      ).toBe(false);
    });

    it('does not match a different PR with the same run id', () => {
      expect(
        shouldDeleteBranch('ci-replay-7-12345', prNumber, runId, 'exact'),
      ).toBe(false);
    });
  });

  describe('prefix scope (pre-flight orphan sweep)', () => {
    it('matches a leaked previous-run branch on the same PR', () => {
      expect(
        shouldDeleteBranch('ci-replay-42-99999', prNumber, runId, 'prefix'),
      ).toBe(true);
    });

    it('does NOT match the current-run branch (current run owns it)', () => {
      expect(
        shouldDeleteBranch('ci-replay-42-12345', prNumber, runId, 'prefix'),
      ).toBe(false);
    });

    it('does NOT match a different PR scope', () => {
      expect(
        shouldDeleteBranch('ci-replay-7-99999', prNumber, runId, 'prefix'),
      ).toBe(false);
    });

    it('does NOT match the persistent staging branch or main', () => {
      expect(shouldDeleteBranch('staging', prNumber, runId, 'prefix')).toBe(
        false,
      );
      expect(shouldDeleteBranch('main', prNumber, runId, 'prefix')).toBe(false);
    });
  });
});
