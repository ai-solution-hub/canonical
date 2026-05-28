/**
 * OPS-T1 defect-B5 binding-correction — temp-copy acceptance proof (ID-32.28).
 *
 * Spec:
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PLAN.md §0 — the continuous
 *     real-corpus probe pattern (apply against a temp git-archive copy).
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/TECH.md §11 — temp-copy probe
 *     definition (git archive → overlay in-flight files → symlink node_modules
 *     → codemod --apply → run the route suite).
 *   - task-list.json ID-32.28 (RE-SCOPED, OQ-10).
 *
 * What this proves (the ID-32.28 acceptance bar):
 *
 *   The 32.20 Source-A URL-matcher bound a schema describing a DIFFERENT
 *   entity to 5 routes (6 method-bindings). ID-32.28 corrects this at codemod-
 *   inference time via the route+method override in
 *   `scripts/codemods/inference-source-a.ts`, binding the 6 hand-authored
 *   schemas in `lib/validation/schemas.ts`. The WORKING TREE routes are
 *   deliberately NOT wrapped (OQ-10 re-scope — the corpus rollout is Task
 *   ID-49); the correction must be PROVABLE without touching the working tree.
 *
 *   This probe applies the codemod `--apply` against a temp git-archive copy
 *   (the working tree is NEVER mutated), then:
 *     1. greps the 5 migrated route files and asserts each `defineRoute(...)`
 *        call now references the CORRECT schema (and none of the WRONG ones:
 *        `PatchResponseSchema` / `EntityDetailSchema`);
 *     2. runs the 5 routes' unit suite against the migrated copy and asserts
 *        ZERO `ResponseSchemaValidationError` (wrong-binding RSVE) for them.
 *
 * Placement: spins up `bun`/`vitest` sub-processes over a full-corpus temp
 * copy — too heavy for the sharded `quality-test` unit budget. Lives under
 * `__tests__/integration/` and runs via `bun run test:integration`.
 * Behaviour-first per docs/reference/test-philosophy.md.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../..');
const CODEMOD_CLI = resolve(REPO_ROOT, 'scripts/codemods/wrap-define-route.ts');
const VITEST_BIN = resolve(REPO_ROOT, 'node_modules/.bin/vitest');

/**
 * The 5 routes (6 method-bindings) defect-B5 corrects, each with the route
 * file path and the schema the corrected inference MUST emit per method.
 */
const CORRECTED_BINDINGS: ReadonlyArray<{
  route: string;
  expectedSchemas: readonly string[];
}> = [
  {
    route: 'app/api/entities/co-occurrence/route.ts',
    expectedSchemas: ['EntityCoOccurrenceResponseSchema'],
  },
  {
    // GET stays TargetsResponseSchema (correct); PUT is the corrected binding.
    route: 'app/api/coverage/targets/route.ts',
    expectedSchemas: [
      'TargetsResponseSchema',
      'CoverageTargetsPutResponseSchema',
    ],
  },
  {
    route: 'app/api/items/[id]/route.ts',
    expectedSchemas: ['ItemPatchResponseSchema', 'ItemDeleteResponseSchema'],
  },
  {
    route: 'app/api/items/batch-review/route.ts',
    expectedSchemas: ['BatchReviewResponseSchema'],
  },
  {
    route: 'app/api/items/batch-workspaces/route.ts',
    expectedSchemas: ['BatchWorkspacesResponseSchema'],
  },
];

/** Schema identifiers that must NEVER appear bound to the 5 routes post-fix. */
const FORBIDDEN_SCHEMAS = ['PatchResponseSchema', 'EntityDetailSchema'];

/** Run `cmd` in `cwd` with the Vitest worker flags cleared from the child. */
function run(
  cmd: string,
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // Clear the parent Vitest worker-pool env so a spawned sub-vitest starts
    // standalone and writes its own JSON reporter file (rather than binding to
    // this integration run's worker pool and never emitting the report).
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      VITEST_WORKER_ID: undefined,
      VITEST_POOL_ID: undefined,
      VITEST_FILE_ID: undefined,
      VITEST_THREAD_ID: undefined,
      TEST_WORKER_ORIGIN: undefined,
    } as NodeJS.ProcessEnv,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
  };
}

/**
 * Materialise a temp copy of the working tree at HEAD, overlay the IN-FLIGHT
 * ID-32.28 source (the corrected inference + the 6 new schemas + the codemod
 * entry point + the pass-through wrapper) so the probe runs against the
 * slice's actual changes (HEAD may still predate this commit), and symlink
 * node_modules. The working tree is NEVER mutated (`git archive` pipes a tar
 * into the temp dir; overlays are `cpSync` INTO the temp dir).
 */
function buildTempCorpus(): string {
  const root = mkdtempSync(join(tmpdir(), 'ops-t1-defect-b5-'));

  const archive = spawnSync(
    'bash',
    ['-c', `git archive HEAD | tar -x -C "${root}"`],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  if (archive.status !== 0) {
    throw new Error(`git archive failed: ${archive.stderr}`);
  }

  // Overlay the in-flight ID-32.28 files + the {32.25} pass-through wrapper.
  for (const rel of [
    'lib/validation/schemas.ts',
    'scripts/codemods/inference-source-a.ts',
    'scripts/codemods/wrap-define-route.ts',
    'lib/api/define-route.ts',
  ]) {
    cpSync(resolve(REPO_ROOT, rel), join(root, rel));
  }

  symlinkSync(resolve(REPO_ROOT, 'node_modules'), join(root, 'node_modules'));
  return root;
}

interface SuiteResult {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  failureMessages: string[];
}

/** Run the 5 corrected routes' unit suite against the migrated copy. */
function runCorrectedRouteSuite(corpusRoot: string): SuiteResult {
  const reportPath = join(corpusRoot, 'vitest-defect-b5-report.json');
  run(
    VITEST_BIN,
    [
      'run',
      // The unit suites for the 5 corrected routes (one test file each). These
      // are the ACTUAL on-disk paths — bare directory paths (e.g.
      // `__tests__/api/coverage`) do not exist and would collect 0 tests.
      '__tests__/api/entity-co-occurrence.test.ts',
      '__tests__/api/coverage-targets.test.ts',
      '__tests__/api/items.test.ts',
      '__tests__/api/batch-review.test.ts',
      '__tests__/api/items/batch-workspaces.test.ts',
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ],
    corpusRoot,
  );

  if (!existsSync(reportPath)) {
    throw new Error('Vitest JSON report was not produced by the route suite.');
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    testResults: Array<{
      assertionResults: Array<{ status: string; failureMessages: string[] }>;
    }>;
  };

  const failureMessages: string[] = [];
  for (const file of report.testResults) {
    for (const assertion of file.assertionResults) {
      if (assertion.status === 'failed') {
        failureMessages.push(...assertion.failureMessages);
      }
    }
  }

  return {
    numTotalTests: report.numTotalTests,
    numPassedTests: report.numPassedTests,
    numFailedTests: report.numFailedTests,
    failureMessages,
  };
}

describe('OPS-T1 defect-B5 binding correction — temp-copy proof (ID-32.28)', () => {
  let corpus: string;
  let applyStatus: number;
  let routeTexts: Map<string, string>;
  let suite: SuiteResult;

  beforeAll(() => {
    corpus = buildTempCorpus();

    const apply = run('bun', [CODEMOD_CLI, '--apply'], corpus);
    applyStatus = apply.status;

    routeTexts = new Map();
    for (const { route } of CORRECTED_BINDINGS) {
      const p = join(corpus, route);
      routeTexts.set(route, existsSync(p) ? readFileSync(p, 'utf8') : '');
    }

    suite = runCorrectedRouteSuite(corpus);
  }, 600_000);

  afterAll(() => {
    if (corpus) rmSync(corpus, { recursive: true, force: true });
  });

  it('the codemod --apply runs to completion against the temp corpus', () => {
    expect(applyStatus).toBe(0);
  });

  it('each of the 5 routes is wrapped with defineRoute referencing the CORRECT schema', () => {
    for (const { route, expectedSchemas } of CORRECTED_BINDINGS) {
      const text = routeTexts.get(route) ?? '';
      expect(text, `${route} should exist + be wrapped`).toContain(
        'defineRoute(',
      );
      for (const schema of expectedSchemas) {
        // The schema identifier must appear as a defineRoute argument — either
        // inline `defineRoute(<Schema>,` or on the following line for the
        // multi-line emit shape (`defineRoute(\n  <Schema>,`).
        const bound =
          new RegExp(`defineRoute\\(\\s*${schema}\\b`).test(text) ||
          new RegExp(`defineRoute\\([^)]*\\n\\s*${schema}\\b`).test(text) ||
          new RegExp(`^\\s*${schema},`, 'm').test(text);
        expect(bound, `${route} should bind ${schema}`).toBe(true);
      }
    }
  });

  it('NONE of the 5 routes bind a wrong (defect-B5) schema after the fix', () => {
    for (const { route } of CORRECTED_BINDINGS) {
      const text = routeTexts.get(route) ?? '';
      for (const forbidden of FORBIDDEN_SCHEMAS) {
        // A forbidden schema must not appear as a defineRoute argument. (It may
        // legitimately appear nowhere; assert it is not bound.)
        const wronglyBound =
          new RegExp(`defineRoute\\(\\s*${forbidden}\\b`).test(text) ||
          new RegExp(`defineRoute\\([^)]*\\n\\s*${forbidden}\\b`).test(text) ||
          new RegExp(`^\\s*${forbidden},`, 'm').test(text);
        expect(wronglyBound, `${route} must NOT bind ${forbidden}`).toBe(false);
      }
    }
  });

  it('the 5 corrected routes throw ZERO wrong-binding ResponseSchemaValidationError', () => {
    const rsveFailures = suite.failureMessages.filter((msg) =>
      msg.includes('ResponseSchemaValidationError'),
    );
    expect(rsveFailures).toEqual([]);
    // And the suite collected a non-trivial number of route tests (guards
    // against a silently-empty run masquerading as green).
    expect(suite.numTotalTests).toBeGreaterThan(50);
    expect(suite.numFailedTests).toBe(0);
  });
});
