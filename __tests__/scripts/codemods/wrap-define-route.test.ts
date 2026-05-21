/**
 * Tests for scripts/codemods/wrap-define-route.ts — the OPS-T1 codemod.
 *
 * Spec: docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md §3 (modes),
 * §8 (acceptance criteria AC-1); ops-t1-codemod/TECH.md §2.1, §2.2, §5
 * (CLI design).
 *
 * Scope of THIS file (Subtask 32.5): scaffold-level CLI smoke tests only —
 * `--help` prints usage + exits 0, and the default (dry-run, no args)
 * enumerates the route corpus + exits 0. The full fixture corpus + classifier
 * tests arrive with Subtasks 32.6/32.7; the rewrite snapshot tests with
 * Subtasks 32.10/32.11.
 *
 * Test invocation: `bun run test` (Vitest) — NOT `bun test` (Bun's built-in
 * runner produces a Vitest config mismatch). Per TECH §8.6 / CLAUDE.md
 * Gotchas — Testing.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const CODEMOD_PATH = resolve(
  __dirname,
  '../../../scripts/codemods/wrap-define-route.ts',
);

function runCodemod(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('bun', [CODEMOD_PATH, ...args], {
    encoding: 'utf8',
    // Inherit a clean PATH so `bun` resolves; suppress NODE_OPTIONS to avoid
    // accidentally inheriting Vitest's worker flags.
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
  };
}

describe('wrap-define-route CLI scaffold', () => {
  it('prints usage and exits 0 when invoked with --help', () => {
    const result = runCodemod(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('wrap-define-route');
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('--apply');
    expect(result.stdout).toContain('--scope');
  });

  it('enumerates the route corpus and exits 0 in default dry-run mode', () => {
    const result = runCodemod([]);
    expect(result.status).toBe(0);
    // Per TECH §2.2, ts-morph enumeration over the working tree should
    // discover the full app/api/**/route.ts corpus. Current count is 193
    // (route-shape-inventory.md). Hard floor: 190 to allow minor churn.
    const match = result.stdout.match(/(\d+) route\(s\) discovered/);
    expect(match).not.toBeNull();
    const count = match ? parseInt(match[1]!, 10) : 0;
    expect(count).toBeGreaterThanOrEqual(190);
  });

  it('honours --scope filter to a subdirectory', () => {
    const result = runCodemod(['--scope', 'app/api/items']);
    expect(result.status).toBe(0);
    const match = result.stdout.match(/(\d+) route\(s\) discovered/);
    expect(match).not.toBeNull();
    const count = match ? parseInt(match[1]!, 10) : -1;
    // Scoped to a small subtree — must be strictly smaller than the
    // full-corpus count and at least 1 (the /api/items route itself).
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThan(190);
  });
});
