/**
 * ID-9.19 — `regenerate-stats` job shape guard for `.github/workflows/ci.yml`.
 *
 * Successor to `/update-docs` function (c) (`bun run stats` +
 * `bun run generate:mcp-inventory`). Spec: TECH §5.2, PRODUCT Inv-45, OQ-6
 * (direct-commit Option A with side-PR Option B fallback).
 *
 * The job is append-only glue: this guard asserts the job's gating shape
 * without touching the rest of the CI topology (parent owns ci.yml).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const ciYmlPath = join(process.cwd(), '.github/workflows/ci.yml');
const raw = readFileSync(ciYmlPath, 'utf8');
const doc = parse(raw) as {
  jobs: Record<
    string,
    {
      if?: string;
      needs?: string[];
      'runs-on'?: string;
      'timeout-minutes'?: number;
      permissions?: Record<string, string>;
      steps?: Array<{ name?: string; run?: string; uses?: string }>;
    }
  >;
};

const job = doc.jobs['regenerate-stats'];

describe('ci.yml regenerate-stats job (ID-9.19 / Inv-45)', () => {
  it('defines the regenerate-stats job', () => {
    expect(job).toBeDefined();
  });

  it('runs only on push to main (not on PRs)', () => {
    expect(job.if).toContain("github.event_name == 'push'");
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
  });

  it('runs on ubuntu-latest with a timeout', () => {
    expect(job['runs-on']).toBe('ubuntu-latest');
    expect(job['timeout-minutes']).toBeGreaterThan(0);
  });

  it('grants contents:write (direct commit) and pull-requests:write (side-PR fallback)', () => {
    expect(job.permissions?.contents).toBe('write');
    expect(job.permissions?.['pull-requests']).toBe('write');
  });

  it('depends on the gating jobs before regenerating', () => {
    expect(job.needs).toEqual(
      expect.arrayContaining([
        'quality-precheck',
        'quality-test',
        'ci-summary',
      ]),
    );
  });

  it('regenerates both stats and the MCP inventory', () => {
    const runScript = (job.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(runScript).toContain('bun run stats');
    expect(runScript).toContain('bun run generate:mcp-inventory');
  });

  it('commits with a [skip ci] suffix to avoid an infinite CI loop', () => {
    const runScript = (job.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(runScript).toContain('[skip ci]');
  });

  it('implements the OQ-6 direct-commit path with a side-PR fallback', () => {
    const runScript = (job.steps ?? []).map((s) => s.run ?? '').join('\n');
    // Direct commit (Option A): push straight to main.
    expect(runScript).toContain('git push origin main');
    // Side-PR fallback (Option B): on push failure, open a PR.
    expect(runScript).toMatch(/if ! git push origin main/);
    expect(runScript).toContain('gh pr create');
  });
});
