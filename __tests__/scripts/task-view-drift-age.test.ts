import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * CLI smoke test for scripts/task-view-drift-age.ts (ID-157). The tiering
 * logic itself is covered exhaustively (boundary-by-boundary) in
 * __tests__/scripts/lib/task-view-drift-age.test.ts against the pure
 * computeDriftAge() function; this test only proves the CLI wrapper's argv
 * parsing and JSON-stdout contract, which is what
 * .github/workflows/task-view-vendor-drift.yml actually shells out to.
 */

const REPO_ROOT = resolve(__dirname, '..', '..');
const CLI = resolve(REPO_ROOT, 'scripts/task-view-drift-age.ts');

function runCli(argv: string[]) {
  return spawnSync('bun', [CLI, ...argv], { encoding: 'utf8' });
}

describe('task-view-drift-age.ts CLI', () => {
  it('prints a JSON-parseable drift-age result on stdout given valid flags', () => {
    const result = runCli([
      '--tag-bump-date',
      '2026-07-11T00:00:00Z',
      '--vendor-sync-date',
      '2026-07-01T00:00:00Z',
    ]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toEqual({
      ageDays: 10,
      tier: 'notice',
      message: expect.any(String),
    });
  });

  it('reports in-sync via the CLI when the vendor-sync date is at/after the tag-bump date', () => {
    const result = runCli([
      '--tag-bump-date',
      '2026-07-01T00:00:00Z',
      '--vendor-sync-date',
      '2026-07-11T00:00:00Z',
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim()).tier).toBe('in-sync');
  });

  it('exits non-zero with a usage message when a required flag is missing', () => {
    const result = runCli(['--tag-bump-date', '2026-07-01T00:00:00Z']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Usage:');
  });

  it('exits non-zero when a date flag is unparseable', () => {
    const result = runCli([
      '--tag-bump-date',
      'not-a-date',
      '--vendor-sync-date',
      '2026-07-01T00:00:00Z',
    ]);

    expect(result.status).not.toBe(0);
  });
});
