/**
 * OPS-T1 codemod ↔ `type-drift-detect` verifier integration (Subtask 32.15).
 *
 * Spec: `docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md` §7 (verifier
 * sub-section + 7-step workflow), §8 AC-10; PLAN.md §4 Subtask 32.15.
 *
 * What this exercises (end-to-end, through the PUBLIC CLIs — never internal
 * helpers, per test-philosophy §1: behaviour, not implementation):
 *
 *   1. `bun scripts/codemods/wrap-define-route.ts`           (dry-run)
 *   2. review the emitted `codemod-dry-run.md`               (artefact assert)
 *   3. `bun scripts/codemods/wrap-define-route.ts --apply`   (apply)
 *   4. `bun run ast-dataflow type-drift-detect --pretty`     (human review)
 *   5. update the baseline to reflect the closed gaps        (--update-baseline)
 *   6. `bun run ast-dataflow type-drift-detect --ci`         (gate → exit 0)
 *
 * Both CLIs resolve their `repoRoot` / tsconfig / baseline path from
 * `process.cwd()`, so the whole pipeline is run against a SELF-CONTAINED
 * temporary corpus (`mkdtempSync(tmpdir())`) with its own `tsconfig.json`,
 * `app/api/<route>/route.ts` fixtures, `lib/query/fetchers.ts`, and
 * `docs/generated/type-drift-baseline.json`. The working tree is never
 * touched — apply runs against the temp copy only (testStrategy constraint).
 *
 * The assertion is non-vacuous: the test first proves the `--ci` gate FAILS
 * (exit 1) against a stale baseline, then proves it PASSES (exit 0) only
 * after the baseline is updated to reflect the post-apply fetcher-only set.
 * A verifier that ignored the baseline diff would fail the first assertion.
 *
 * Placement rationale (PLAN §4 Subtask 32.16 note): this test cold-starts a
 * `bun` sub-process FIVE times, and each invocation spins up a fresh ts-morph
 * `Project` over the corpus. That per-process cost would blow the 4-shard
 * `quality-test` Vitest budget, so the test lives under `__tests__/integration/`
 * as a `*.integration.test.ts` and runs via `bun run test:integration`
 * (120s timeout, sequential forks) — NOT the sharded unit suite.
 *
 * Test invocation: `bun run test:integration` (Vitest integration config) —
 * NOT `bun test` (Bun's built-in runner). Per CLAUDE.md Gotchas — Testing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';

// Absolute paths to the two CLIs under test, resolved against THIS file so
// the corpus cwd can differ from the repo root without breaking resolution.
const REPO_ROOT = resolve(__dirname, '../..');
const CODEMOD_CLI = resolve(REPO_ROOT, 'scripts/codemods/wrap-define-route.ts');
const AST_DATAFLOW_CLI = resolve(REPO_ROOT, 'scripts/ast-dataflow-cli.ts');

/**
 * Run a `bun <script> [...args]` sub-process with `cwd` set to the temp
 * corpus so both CLIs resolve their `repoRoot`/tsconfig/baseline against it.
 * `NODE_OPTIONS` is cleared so Vitest's worker flags do not leak into the
 * child (mirrors the unit-suite `runCodemod` helper).
 */
function run(
  script: string,
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('bun', [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' } as NodeJS.ProcessEnv,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
  };
}

/** Repo-relative path to the type-drift baseline both CLIs read/write. */
const BASELINE_REL = 'docs/generated/type-drift-baseline.json';

/** Write a file, creating parent directories as needed. */
function writeCorpusFile(root: string, relPath: string, contents: string) {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
}

/**
 * Materialise a minimal but faithful corpus the verifier can classify:
 *
 *   - `app/api/insights/route.ts`  — an AUTH_PLAIN MECHANISABLE route the
 *     codemod wraps with `defineRoute(...)`.
 *   - `types/insights.ts`          — the `InsightsResponse` candidate interface.
 *   - `lib/query/fetchers.ts`      — a `fetchJson<InsightsResponse>('/api/insights')`
 *     call so the detector buckets the interface as `fetcher-only`.
 *   - `lib/validation/schemas.ts`  — co-located `InsightsResponseSchema` (Source A).
 *   - `lib/auth.ts` / `lib/api/define-route.ts` — import targets for the
 *     wrapped route so the corpus type-checks at the ts-morph level.
 *   - `tsconfig.json`              — a recursive `.ts` include glob plus the
 *     `@/` path alias, mirroring the repo's resolution so both CLIs load the
 *     corpus files.
 *   - `package.json`               — a no-op `format` script so the codemod's
 *     post-apply `bun run format` pass is silent (it shells out to it).
 */
function buildCorpus(root: string) {
  writeCorpusFile(
    root,
    'tsconfig.json',
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          skipLibCheck: true,
          paths: { '@/*': ['./*'] },
        },
        include: ['**/*.ts'],
      },
      null,
      2,
    ),
  );

  writeCorpusFile(
    root,
    'package.json',
    JSON.stringify(
      {
        name: 'ops-t1-codemod-verifier-fixture',
        private: true,
        // The codemod runs `bun run format` over the modified set under
        // --apply; a no-op keeps that pass silent in the temp corpus.
        scripts: { format: 'true' },
      },
      null,
      2,
    ),
  );

  writeCorpusFile(
    root,
    'app/api/insights/route.ts',
    `import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';

export async function GET(_request: NextRequest) {
  const auth = await getAuthorisedClient(['admin']);
  if (!auth.success) return authFailureResponse(auth);
  return NextResponse.json({ ok: true });
}
`,
  );

  writeCorpusFile(
    root,
    'types/insights.ts',
    `export interface InsightsResponse {
  ok: boolean;
}
`,
  );

  writeCorpusFile(
    root,
    'lib/query/fetchers.ts',
    `import type { InsightsResponse } from '@/types/insights';

declare function fetchJson<T>(url: string): Promise<T>;

export function getInsights(): Promise<InsightsResponse> {
  return fetchJson<InsightsResponse>('/api/insights');
}
`,
  );

  writeCorpusFile(
    root,
    'lib/validation/schemas.ts',
    `import { z } from 'zod';

export const InsightsResponseSchema = z.object({ ok: z.boolean() });
`,
  );

  writeCorpusFile(
    root,
    'lib/auth.ts',
    `export async function getAuthorisedClient(
  _roles: string[],
): Promise<{ success: boolean }> {
  return { success: true };
}

export function authFailureResponse(_auth: unknown): Response {
  return new Response();
}
`,
  );

  writeCorpusFile(
    root,
    'lib/api/define-route.ts',
    `export function defineRoute<S, H>(_schema: S, handler: H): H {
  return handler;
}
`,
  );

  // The R-WP17 baseline is a PRE-EXISTING artefact in the real workflow: the
  // codemod's Source A inference reads it during dry-run AND apply (it errors
  // ENOENT if absent), and the verifier diffs against it. Seed it listing the
  // InsightsResponse fetcher-only gap so dry-run/apply succeed. The test later
  // overwrites this file to drive the stale → updated baseline transition.
  writeCorpusFile(
    root,
    BASELINE_REL,
    JSON.stringify(
      [
        {
          interface: 'InsightsResponse',
          declaredAt: { file: 'types/insights.ts' },
        },
      ],
      null,
      2,
    ),
  );
}

describe('OPS-T1 codemod → type-drift-detect verifier integration (Subtask 32.15)', () => {
  let corpus: string;

  beforeAll(() => {
    corpus = mkdtempSync(join(tmpdir(), 'ops-t1-codemod-verifier-'));
    buildCorpus(corpus);
  });

  afterAll(() => {
    if (corpus) rmSync(corpus, { recursive: true, force: true });
  });

  it('type-drift-detect --ci passes after the codemod applies and the baseline is updated', () => {
    const routePath = join(corpus, 'app/api/insights/route.ts');
    const baselinePath = join(corpus, BASELINE_REL);

    // ── Step 1: dry-run. Route must NOT change on disk (PRODUCT §7 step 1). ──
    const beforeText = readFileSync(routePath, 'utf8');
    const dryRun = run(CODEMOD_CLI, [], corpus);
    expect(dryRun.status).toBe(0);
    expect(readFileSync(routePath, 'utf8')).toBe(beforeText);
    expect(dryRun.stdout).toContain('route(s) discovered');

    // ── Step 2: review codemod-dry-run.md (artefact emitted on every run). ──
    const dryRunReportPath = join(corpus, 'docs/generated/codemod-dry-run.md');
    expect(existsSync(dryRunReportPath)).toBe(true);
    expect(readFileSync(dryRunReportPath, 'utf8')).toContain(
      'Codemod dry-run report',
    );

    // ── Step 4 (apply): --apply rewrites + saves the MECHANISABLE route. ──
    const apply = run(CODEMOD_CLI, ['--apply'], corpus);
    expect(apply.status).toBe(0);
    const appliedText = readFileSync(routePath, 'utf8');
    // The route is now wrapped with defineRoute(...) — the apply landed.
    expect(appliedText).toContain('defineRoute(');
    expect(appliedText).not.toBe(beforeText);

    // ── Step 5: type-drift-detect --pretty for human review. ──
    // The detector still buckets InsightsResponse as fetcher-only: the
    // verifier recognises route annotations via the handler RETURN TYPE,
    // and the defineRoute() wrap does not add one. This is exactly why
    // PRODUCT §7 step 5/6 require an explicit baseline update to record the
    // closed gap — the detector does not infer closure from the wrap alone.
    const pretty = run(
      AST_DATAFLOW_CLI,
      ['type-drift-detect', '--pretty'],
      corpus,
    );
    expect(pretty.status).toBe(0);
    expect(pretty.stdout).toContain('InsightsResponse');
    expect(pretty.stdout).toContain('fetcher-only');

    // ── Non-vacuous guard: a STALE baseline must FAIL the --ci gate. ──
    // Seed a stub baseline that does NOT list InsightsResponse, so the
    // detector sees it as a NEW fetcher-only drift and the gate must trip.
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(
      baselinePath,
      JSON.stringify(
        [
          {
            interface: 'StaleResponse',
            declaredAt: { file: 'types/stale.ts' },
          },
        ],
        null,
        2,
      ),
    );
    const ciStale = run(
      AST_DATAFLOW_CLI,
      ['type-drift-detect', '--ci'],
      corpus,
    );
    expect(ciStale.status).toBe(1);
    expect(ciStale.stderr).toContain('InsightsResponse');

    // ── Step 6: update the baseline to reflect the closed gaps. ──
    // The CLI's --update-baseline regenerates the baseline from the current
    // fetcher-only set — the canonical "update docs/generated/
    // type-drift-baseline.json" step. (This is the public-CLI equivalent of
    // a developer hand-editing the file to remove closed-gap entries.)
    const updateBaseline = run(
      AST_DATAFLOW_CLI,
      ['type-drift-detect', '--update-baseline'],
      corpus,
    );
    expect(updateBaseline.status).toBe(0);
    const updatedBaseline = JSON.parse(
      readFileSync(baselinePath, 'utf8'),
    ) as Array<{ interface: string }>;
    expect(updatedBaseline.map((e) => e.interface)).toContain(
      'InsightsResponse',
    );

    // ── Step 8: the --ci gate now passes (exit 0) — AC-10. ──
    const ciFinal = run(
      AST_DATAFLOW_CLI,
      ['type-drift-detect', '--ci'],
      corpus,
    );
    expect(ciFinal.status).toBe(0);
  });
});
