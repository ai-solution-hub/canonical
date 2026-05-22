/**
 * Tests for scripts/codemods/wrap-define-route.ts — the OPS-T1 codemod.
 *
 * Spec: docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md §3 (modes),
 * §8 (acceptance criteria AC-1); ops-t1-codemod/TECH.md §2.1, §2.2, §4
 * (fixture corpus), §5 (CLI design).
 *
 * Scope of THIS file:
 *   - Subtask 32.5: scaffold-level CLI smoke tests — `--help` prints usage +
 *     exits 0; default (dry-run, no args) enumerates the route corpus + exits 0.
 *   - Subtask 32.7: 14-fixture classification harness — loads each fixture from
 *     disk into a virtual ts-morph `Project` (with a synthetic filePath that
 *     encodes the route's would-be runtime location, including `/cron/` and
 *     `/mcp/` discriminators per TECH §2.3 priority order) and asserts
 *     `classifyRoute()` returns the expected `RouteShape`.
 *
 * Subtask 32.6 keeps its own dedicated unit-test file
 * (`wrap-define-route.classifier.test.ts`) for synthetic in-memory classifier
 * tests; this file's fixture harness exercises the same `classifyRoute()`
 * export against ON-DISK fixture sources, which are the inputs the downstream
 * rewrite Subtasks (32.10 / 32.11) consume.
 *
 * Test invocation: `bun run test` (Vitest) — NOT `bun test` (Bun's built-in
 * runner produces a Vitest config mismatch). Per TECH §8.6 / CLAUDE.md
 * Gotchas — Testing.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Project } from 'ts-morph';
import { classifyRoute } from '../../../scripts/codemods/wrap-define-route';
import type { RouteShape } from '../../../scripts/codemods/types';

const CODEMOD_PATH = resolve(
  __dirname,
  '../../../scripts/codemods/wrap-define-route.ts',
);

const FIXTURE_DIR = resolve(
  __dirname,
  'fixtures/wrap-define-route',
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

/**
 * Load a fixture file from disk into a virtual ts-morph `Project` under the
 * supplied synthetic filePath. The synthetic path encodes the route's runtime
 * location (e.g. `/repo/app/api/cron/process-queue/route.ts`) so that the
 * classifier's path-based discriminators (`/cron/`, `/mcp/`, `[id]`) fire
 * correctly, without requiring the fixture file itself to live in a contrived
 * directory tree. Per the Subtask 32.7 brief, option (b) — virtual filePath
 * argument — keeps the fixture's filesystem location decoupled from the
 * classifier's path signal.
 */
function loadFixture(fixtureName: string, syntheticPath: string) {
  const source = readFileSync(resolve(FIXTURE_DIR, fixtureName), 'utf8');
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(syntheticPath, source);
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

// ── Fixture-classification harness (Subtask 32.7) ─────────────────────────

/**
 * One row per fixture authored under
 * `__tests__/scripts/codemods/fixtures/wrap-define-route/` per TECH §4 and
 * PLAN.md §4 Subtask 32.7 file ownership. Each row encodes:
 *
 *   - `fixture`     — the on-disk filename. Source text is read verbatim.
 *   - `path`        — a synthetic ts-morph filePath supplied at load time.
 *                     Encodes the route's runtime location so the classifier
 *                     sees the discriminator signals (e.g. `/cron/`, `/mcp/`,
 *                     `[id]`).
 *   - `expected`    — the `RouteShape` literal `classifyRoute()` must return.
 *   - `title`       — the `it()` title, phrased as observable behaviour per
 *                     test-philosophy §5 ("AUTH_PLAIN fixture classifies as
 *                     AUTH_PLAIN").
 *
 * `already-wrapped.ts` is included alongside the 10 primary shapes + 3 special
 * cases per TECH §4. Its `expected` value is `AUTH_PLAIN` because the
 * `classifyRoute()` contract (32.6) does not have an `ALREADY_WRAPPED` verdict
 * — idempotency-skip detection is the orthogonal concern owned by Subtask
 * 32.13 (`isAlreadyWrapped(sf, method)`). The fixture asserts what the
 * classifier returns TODAY; 32.13's idempotency tests will assert the
 * downstream skip behaviour against the same fixture file.
 */
const FIXTURE_TABLE: ReadonlyArray<{
  fixture: string;
  path: string;
  expected: RouteShape;
  title: string;
}> = [
  // Single-method MECHANISABLE shapes
  {
    fixture: 'auth-plain.ts',
    path: '/repo/app/api/insights/route.ts',
    expected: 'AUTH_PLAIN',
    title: 'auth-plain.ts fixture classifies as AUTH_PLAIN',
  },
  {
    fixture: 'auth-plain-with-wrc.ts',
    path: '/repo/app/api/activity/route.ts',
    expected: 'AUTH_PLAIN+WRC',
    title: 'auth-plain-with-wrc.ts fixture classifies as AUTH_PLAIN+WRC',
  },
  {
    fixture: 'param-body.ts',
    path: '/repo/app/api/items/[id]/classify/route.ts',
    expected: 'PARAM_BODY',
    title: 'param-body.ts fixture classifies as PARAM_BODY',
  },
  {
    fixture: 'body-validated.ts',
    path: '/repo/app/api/search/route.ts',
    expected: 'BODY_VALIDATED',
    title: 'body-validated.ts fixture classifies as BODY_VALIDATED',
  },
  {
    fixture: 'param-only.ts',
    path: '/repo/app/api/entities/[canonical_name]/route.ts',
    expected: 'PARAM',
    title: 'param-only.ts fixture classifies as PARAM',
  },
  // Multi-method NEEDS-REVIEW shapes
  {
    fixture: 'multi-param-body.ts',
    path: '/repo/app/api/items/[id]/route.ts',
    expected: 'MULTI_PARAM_BODY',
    title: 'multi-param-body.ts fixture classifies as MULTI_PARAM_BODY',
  },
  {
    fixture: 'multi-body.ts',
    path: '/repo/app/api/layers/route.ts',
    expected: 'MULTI_BODY',
    title: 'multi-body.ts fixture classifies as MULTI_BODY',
  },
  {
    fixture: 'multi-param.ts',
    path: '/repo/app/api/items/[id]/images/route.ts',
    expected: 'MULTI_PARAM',
    title: 'multi-param.ts fixture classifies as MULTI_PARAM',
  },
  // MANUAL shapes
  {
    fixture: 'cron.ts',
    path: '/repo/app/api/cron/process-queue/route.ts',
    expected: 'CRON',
    title: 'cron.ts fixture classifies as CRON',
  },
  {
    fixture: 'naked-no-auth.ts',
    path: '/repo/app/api/health/route.ts',
    expected: 'NAKED_NO_AUTH',
    title: 'naked-no-auth.ts fixture classifies as NAKED_NO_AUTH',
  },
  {
    fixture: 'mcp.ts',
    path: '/repo/app/api/mcp/[transport]/route.ts',
    expected: 'MCP',
    title: 'mcp.ts fixture classifies as MCP',
  },
  // Idempotency / inference-path special cases
  {
    fixture: 'already-wrapped.ts',
    path: '/repo/app/api/insights/route.ts',
    expected: 'AUTH_PLAIN',
    title:
      'already-wrapped.ts fixture classifies under its underlying shape (idempotency-skip is Subtask 32.13)',
  },
  {
    fixture: 'with-schema-in-baseline.ts',
    path: '/repo/app/api/review/stats/route.ts',
    expected: 'AUTH_PLAIN',
    title:
      'with-schema-in-baseline.ts fixture classifies as AUTH_PLAIN (Source A inference is exercised by Subtask 32.8)',
  },
  {
    fixture: 'with-return-type-annotation.ts',
    path: '/repo/app/api/review/queue/route.ts',
    expected: 'AUTH_PLAIN',
    title:
      'with-return-type-annotation.ts fixture classifies as AUTH_PLAIN (Source B inference is exercised by Subtask 32.9)',
  },
];

describe('wrap-define-route classifier — fixture corpus (Subtask 32.7)', () => {
  // Sanity guard: a typo or missed row in FIXTURE_TABLE would silently shrink
  // the matrix. Per TECH §4 the corpus is exactly 14 fixtures; if this number
  // changes intentionally (e.g. Subtask 32.8 adds the 15th fall-back fixture)
  // both the table and this guard get updated in the same commit.
  it('covers the 14-fixture corpus declared by TECH §4', () => {
    expect(FIXTURE_TABLE).toHaveLength(14);
  });

  it.each(FIXTURE_TABLE)('$title', ({ fixture, path, expected }) => {
    const sf = loadFixture(fixture, path);
    expect(classifyRoute(sf)).toBe(expected);
  });
});
