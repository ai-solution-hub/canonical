import { describe, it, expect } from 'vitest';
import {
  extractFailingMigration,
  shouldDeleteBranch,
  isIntermediateBranchStatus,
  isReadyBranchStatus,
  INTERMEDIATE_BRANCH_STATUSES,
  READY_BRANCH_STATUSES,
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

describe('branch-status classification (S22 WP-G4.5 polling fix)', () => {
  it('treats CREATING_PROJECT as intermediate (regression guard)', () => {
    // Migration replay smoke runs 25260265369 + 25260575282 both failed
    // on attempt 1 with status='CREATING_PROJECT'. The polling loop must
    // accept it as transient and keep waiting until ACTIVE_HEALTHY.
    expect(isIntermediateBranchStatus('CREATING_PROJECT')).toBe(true);
    expect(INTERMEDIATE_BRANCH_STATUSES).toContain('CREATING_PROJECT');
  });

  it('treats RUNNING_MIGRATIONS as intermediate (regression guard)', () => {
    // Migration replay smoke run 25264335446 failed on attempt 34 with
    // status='RUNNING_MIGRATIONS'. The polling loop must accept it as
    // transient — it is the in-progress sibling of MIGRATIONS_PASSED /
    // MIGRATIONS_FAILED.
    expect(isIntermediateBranchStatus('RUNNING_MIGRATIONS')).toBe(true);
    expect(INTERMEDIATE_BRANCH_STATUSES).toContain('RUNNING_MIGRATIONS');
  });

  it('treats other documented Supabase Management API statuses as intermediate', () => {
    expect(isIntermediateBranchStatus('CREATING')).toBe(true);
    expect(isIntermediateBranchStatus('COMING_UP')).toBe(true);
    expect(isIntermediateBranchStatus('MIGRATIONS_PASSED')).toBe(true);
    expect(isIntermediateBranchStatus('MIGRATIONS_FAILED')).toBe(true);
  });

  it('treats ACTIVE_HEALTHY and FUNCTIONS_DEPLOYED as ready', () => {
    expect(isReadyBranchStatus('ACTIVE_HEALTHY')).toBe(true);
    expect(isReadyBranchStatus('FUNCTIONS_DEPLOYED')).toBe(true);
    expect(READY_BRANCH_STATUSES).toEqual([
      'ACTIVE_HEALTHY',
      'FUNCTIONS_DEPLOYED',
    ]);
  });

  it('does not classify unknown statuses as ready or intermediate', () => {
    // Unknown statuses fall through both predicates and trigger the
    // "unexpected status" error path in waitForBranchReady — preserves
    // the loud-fail behaviour for genuinely-novel API states.
    expect(isReadyBranchStatus('SOMETHING_NEW')).toBe(false);
    expect(isIntermediateBranchStatus('SOMETHING_NEW')).toBe(false);
  });
});
