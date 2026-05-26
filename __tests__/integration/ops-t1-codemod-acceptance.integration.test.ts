/**
 * OPS-T1 codemod acceptance gate — the standing continuous real-corpus probe,
 * re-finalised under the Option-4 model (Subtask 32.27).
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md §8 (AC-8/9/10).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §11 — the probe
 *     definition (apply against a temp copy + run the route unit suite).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PLAN.md §0 — the continuous
 *     real-corpus probe mandate (runs from the FIRST slice, not a final gate).
 *
 * ── THE OPTION-4 MODEL (Subtask 32.27 re-finalisation) ──────────────────────
 * This gate validates the codemod on a TEMP COPY only — it NEVER wraps the
 * working-tree corpus. The full working-tree rollout (wrap the remaining
 * routes + migrate the test call-sites + add the generic `defineRoute` ctx
 * type) is Task ID-50, NOT this gate. The temp-copy harness proves the
 * codemod's mechanical correctness end-to-end without committing the
 * migration.
 *
 * What this exercises (the B4 reinterpretation, INV-PT):
 *
 *   1. `git archive HEAD | tar -x` the working tree into a `mkdtempSync` dir
 *      (the working tree is NEVER mutated).
 *   2. Overlay the IN-FLIGHT `lib/api/define-route.ts` (the pass-through
 *      wrapper) onto the temp copy.
 *   3. Symlink `node_modules` into the temp copy.
 *   4. Run the codemod `--apply` against the temp copy (wraps the MECHANISABLE
 *      routes with `defineRoute(...)`).
 *   5. Gate the migrated copy: AC-8 (route suite), AC-9 (lint-delta +
 *      non-vacuous ts-morph no-undef), AC-10 (type-drift-detect).
 *
 * ── CANARY RETIRED (Subtask 32.27) ─────────────────────────────────────────
 * The S262 ESCALATION CANARY asserted that a full-corpus `--apply` ABORTS on
 * `app/api/freshness/recalculate-all/route.ts` (the `withRequestContextBare`
 * classifier false-positive, defect B1). B1 is FIXED on this branch — the
 * classifier now exact-matches the `withRequestContext` AST callee, so
 * `withRequestContextBare` routes classify `UNKNOWN_WRAPPER` (MANUAL, left
 * untouched) and the apply runs to completion (exit 0). The canary is
 * therefore STALE and has been DELETED, and the AC-8/9/10 `it.fails`
 * tripwires are now LIVE assertions (the auto-flip design served its purpose).
 *
 * ── THE DOCUMENTED STRICTNESS-DRIFT SET (AC-8) ──────────────────────────────
 * Under the INV-FP loud-in-test policy the migrated route suite surfaces a
 * small, DOCUMENTED set of `ResponseSchemaValidationError` (RSVE) failures —
 * routes whose REAL return payload drifts from the (now-strict) bound schema.
 * Per OQ-1 (Liam-ratified) these are the net WORKING outcome: the gate
 * deliberately leaves them loud, to be reconciled as part of the ID-50 corpus
 * rollout. AC-8's contract is therefore:
 *   (a) ZERO non-RSVE failures (zero defect-B4 double-wraps) — the {32.25}
 *       pass-through guarantee; AND
 *   (b) the RSVE failures are confined to the DOCUMENTED_DRIFT_FILES set —
 *       NO NEW drift beyond it.
 * A new double-wrap (non-RSVE) OR new drift outside the documented set fails
 * the gate.
 *
 * ── AC-9 NON-VACUOUS (PRODUCT §8) ───────────────────────────────────────────
 * The lint-delta alone is insufficient (B3 unresolved-name defects were
 * invisible to ESLint). AC-9 ALSO runs a targeted ts-morph
 * `getPreEmitDiagnostics` over the migrated `app/api/**\/route.ts` files
 * (OQ-1 scope) and asserts ZERO no-undef diagnostics (TS2304/2552/2503/2307)
 * — every emitted `defineRoute(...)` resolves its `z` + schema imports. The
 * `+WRC` ctx-contravariance errors (TS2345 — the destructured `{ params }`
 * ctx param is not assignable to the generic `RouteHandlerContext`) are
 * EXCLUDED: they need the generic `defineRoute` ctx type, which is Task ID-50
 * scope. AC-9 asserts those are the ONLY residual diagnostics.
 *
 * Placement: spins up `bun`/`vitest` sub-processes over a full-corpus temp
 * copy — far too heavy for the sharded `quality-test` unit budget. Lives under
 * `__tests__/integration/` and runs via `bun run test:integration` (sequential
 * forks, generous timeout). The full `--apply` cold-start is ~75-90s.
 * Behaviour-first per docs/reference/test-philosophy.md.
 *
 * Test invocation: `bun run test:integration` — NOT `bun test`.
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
import { Project } from 'ts-morph';

const REPO_ROOT = resolve(__dirname, '../..');
const CODEMOD_CLI = resolve(REPO_ROOT, 'scripts/codemods/wrap-define-route.ts');
const AST_DATAFLOW_CLI = resolve(REPO_ROOT, 'scripts/ast-dataflow-cli.ts');
const VITEST_BIN = resolve(REPO_ROOT, 'node_modules/.bin/vitest');

/** Long-running hook budget — the corpus build + full `--apply` + the route
 *  suite cost ~3-4 minutes cold. */
const SETUP_HOOK_TIMEOUT_MS = 600_000;
const AC_TEST_TIMEOUT_MS = 240_000;

/**
 * The DOCUMENTED strictness-drift route-test files (AC-8, OQ-1). These tests
 * surface RSVE failures because the route's REAL return payload drifts from
 * the now-strict bound schema — the loud INV-FP catch. They are reconciled as
 * part of the ID-50 corpus rollout; this gate asserts NO drift appears OUTSIDE
 * this set (and NO non-RSVE failure appears at all). Matched by path SUFFIX so
 * the absolute temp-copy prefix is irrelevant.
 */
const DOCUMENTED_DRIFT_FILES = [
  '__tests__/api/intelligence/profiles.test.ts',
  '__tests__/api/intelligence/sources-test-poll-web.test.ts',
  '__tests__/api/intelligence/sources.test.ts',
  '__tests__/api/intelligence/workspaces.test.ts',
  '__tests__/api/procurement-responses-crud.test.ts',
  '__tests__/api/review.test.ts',
  '__tests__/api/review/assignments.test.ts',
] as const;

/**
 * ts-morph diagnostic codes that signal a B3 NO-UNDEF defect — an emitted
 * `defineRoute(...)` referencing an unresolved name / module. AC-9's
 * non-vacuous contract: ZERO of these on the migrated routes.
 *   - 2304: Cannot find name 'X'.
 *   - 2552: Cannot find name 'X'. Did you mean 'Y'?
 *   - 2503: Cannot find namespace 'X'.
 *   - 2307: Cannot find module 'X' or its type declarations.
 */
const NO_UNDEF_CODES = new Set([2304, 2552, 2503, 2307]);

/**
 * The `+WRC` ctx-contravariance diagnostic code (TS2345). The destructured
 * `{ params }` ctx parameter of a +WRC route handler is not assignable to the
 * generic `RouteHandlerContext` parameter `defineRoute` declares. Resolving
 * this needs the generic `defineRoute` ctx type — Task ID-50 scope. AC-9
 * EXCLUDES these and asserts they are the ONLY residual diagnostics.
 */
const WRC_CTX_CONTRAVARIANCE_CODE = 2345;

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
    env: { ...process.env, NODE_OPTIONS: '' } as NodeJS.ProcessEnv,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
  };
}

/**
 * Materialise a temp copy of the working tree at HEAD, overlay the in-flight
 * pass-through wrapper, and symlink node_modules. Returns the temp root.
 */
function buildTempCorpus(): string {
  const root = mkdtempSync(join(tmpdir(), 'ops-t1-codemod-acceptance-'));

  // 1. Snapshot the working tree at HEAD into the temp copy (never mutates the
  //    working tree — `git archive` writes to a tar piped into the temp dir).
  const archive = spawnSync(
    'bash',
    ['-c', `git -C "${REPO_ROOT}" archive HEAD | tar -x -C "${root}"`],
    { encoding: 'utf8' },
  );
  if (archive.status !== 0) {
    throw new Error(`git archive failed: ${archive.stderr}`);
  }

  // 2. Overlay the IN-FLIGHT define-route.ts so the probe runs against the
  //    pass-through wrapper (HEAD may still carry the prior contract until the
  //    slice commits).
  cpSync(
    resolve(REPO_ROOT, 'lib/api/define-route.ts'),
    join(root, 'lib/api/define-route.ts'),
  );

  // 3. Symlink node_modules (the exact pattern TECH §11 mandates).
  symlinkSync(resolve(REPO_ROOT, 'node_modules'), join(root, 'node_modules'));

  return root;
}

/** Count ESLint errors under a path inside the corpus. Returns -1 on a parse
 *  failure so callers can surface a setup problem distinctly from 0 errors. */
function lintErrorCount(cwd: string, target: string): number {
  const r = run('bun', ['run', 'eslint', target, '--format=json'], cwd);
  const start = r.stdout.indexOf('[');
  if (start < 0) return -1;
  try {
    const report = JSON.parse(r.stdout.slice(start)) as Array<{
      errorCount: number;
    }>;
    return report.reduce((sum, f) => sum + (f.errorCount ?? 0), 0);
  } catch {
    return -1;
  }
}

/**
 * Parse the Vitest JSON reporter output into a numeric pass/fail summary, the
 * set of distinct assertion-failure messages, and the set of test FILES that
 * carried a failure (used to confine the RSVE drift to the documented set).
 */
interface SuiteResult {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  failureMessages: string[];
  failedFilePaths: string[];
}

function runRouteSuite(corpusRoot: string): SuiteResult {
  const reportPath = join(corpusRoot, 'vitest-route-report.json');
  run(
    VITEST_BIN,
    ['run', '__tests__/api', '--reporter=json', `--outputFile=${reportPath}`],
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
      name?: string;
      testFilePath?: string;
      assertionResults: Array<{
        status: string;
        failureMessages: string[];
      }>;
    }>;
  };

  const failureMessages: string[] = [];
  const failedFilePaths: string[] = [];
  for (const file of report.testResults) {
    const filePath = file.name ?? file.testFilePath ?? '';
    let fileHasFailure = false;
    for (const assertion of file.assertionResults) {
      if (assertion.status === 'failed') {
        failureMessages.push(...assertion.failureMessages);
        fileHasFailure = true;
      }
    }
    if (fileHasFailure) failedFilePaths.push(filePath);
  }

  return {
    numTotalTests: report.numTotalTests,
    numPassedTests: report.numPassedTests,
    numFailedTests: report.numFailedTests,
    failureMessages,
    failedFilePaths,
  };
}

/** A single ts-morph pre-emit diagnostic on a migrated route, flattened. */
interface RouteDiagnostic {
  file: string;
  code: number;
}

/**
 * Run a targeted ts-morph type-check over the migrated `app/api/**\/route.ts`
 * files on the temp copy and return their pre-emit diagnostics (AC-9
 * non-vacuous check). Scoped to the route files only per OQ-1 — NOT a
 * full-project tsc.
 */
function migratedRouteDiagnostics(corpusRoot: string): RouteDiagnostic[] {
  const project = new Project({
    tsConfigFilePath: resolve(corpusRoot, 'tsconfig.json'),
  });
  const routeFiles = project.getSourceFiles().filter((sf) => {
    const rel = sf.getFilePath().replace(`${corpusRoot}/`, '');
    return rel.startsWith('app/api/') && rel.endsWith('/route.ts');
  });
  const diagnostics: RouteDiagnostic[] = [];
  for (const sf of routeFiles) {
    for (const d of sf.getPreEmitDiagnostics()) {
      const dFile = d.getSourceFile();
      diagnostics.push({
        file: dFile
          ? dFile.getFilePath().replace(`${corpusRoot}/`, '')
          : '(global)',
        code: d.getCode(),
      });
    }
  }
  return diagnostics;
}

/** True when a failing test-file path ends with one of the documented set. */
function isDocumentedDriftFile(filePath: string): boolean {
  const normalised = filePath.replace(/\\/g, '/');
  return DOCUMENTED_DRIFT_FILES.some((suffix) => normalised.endsWith(suffix));
}

interface GateState {
  corpus: string;
  applyStatus: number;
  applyStderrTail: string;
  suite: SuiteResult;
  lintErrorsBefore: number;
  lintErrorsAfter: number;
  routeDiagnostics: RouteDiagnostic[];
}

describe('OPS-T1 codemod acceptance gate — apply-against-temp-copy, Option-4 (Subtask 32.27)', () => {
  let state: GateState;

  beforeAll(() => {
    const corpus = buildTempCorpus();

    // AC-9 BEFORE measurement: lint the migrated set on the PRISTINE copy
    // (pre-apply) so AC-9 can assert the post-apply DELTA (after <= before).
    const lintErrorsBefore = lintErrorCount(corpus, 'app/api');

    // Apply the codemod against the temp copy (wraps MECHANISABLE routes).
    // The codemod is a `.ts` entry point — invoke it through `bun`. B1 is
    // fixed on this branch, so this runs to completion (exit 0); the canary
    // that asserted an abort is retired.
    const apply = run('bun', [CODEMOD_CLI, '--apply'], corpus);

    // AC-9 AFTER measurement: lint the migrated set on the applied copy.
    const lintErrorsAfter = lintErrorCount(corpus, 'app/api');

    // AC-8: run the route unit suite against the migrated copy.
    const suite = runRouteSuite(corpus);

    // AC-9 (non-vacuous): targeted ts-morph diagnostics over migrated routes.
    const routeDiagnostics = migratedRouteDiagnostics(corpus);

    state = {
      corpus,
      applyStatus: apply.status,
      applyStderrTail: apply.stderr.split('\n').slice(-6).join('\n'),
      suite,
      lintErrorsBefore,
      lintErrorsAfter,
      routeDiagnostics,
    };

    console.log(
      `[32.27 gate setup] apply status=${apply.status} ` +
        `route suite total=${suite.numTotalTests} passed=${suite.numPassedTests} failed=${suite.numFailedTests} ` +
        `lintBefore=${lintErrorsBefore} lintAfter=${lintErrorsAfter} ` +
        `routeDiagnostics=${routeDiagnostics.length}`,
    );
  }, SETUP_HOOK_TIMEOUT_MS);

  afterAll(() => {
    if (state?.corpus) rmSync(state.corpus, { recursive: true, force: true });
  });

  it('apply: the codemod --apply runs to completion against the temp corpus (exit 0; canary retired — no withRequestContextBare abort)', () => {
    expect(state.applyStatus, state.applyStderrTail).toBe(0);
  });

  it('probe wiring sanity: the migrated route suite is collected and run (non-trivial test count)', () => {
    // Guards against a silently-empty run masquerading as "green".
    expect(state.suite.numTotalTests).toBeGreaterThan(1500);
  });

  it(
    'AC-8a (INV-PT): the pass-through wrapper introduces ZERO defect-B4 double-wrap regressions (zero non-RSVE failures)',
    () => {
      // Defect B4's signature is a re-wrapped response: an inline NextResponse
      // error double-wrapped into a 200 envelope, or a payload-return 500. The
      // {32.25} pass-through contract eliminates that entire class. Every
      // residual failure must be a `ResponseSchemaValidationError` (the
      // INV-FP loud-in-test throw on schema drift), NEVER a double-wrap.
      const nonRsveFailures = state.suite.failureMessages.filter(
        (msg) => !msg.includes('ResponseSchemaValidationError'),
      );
      expect(nonRsveFailures).toEqual([]);
    },
    AC_TEST_TIMEOUT_MS,
  );

  it(
    'AC-8b (OQ-1): the RSVE strictness-drift failures are confined to the documented ID-50 set (no NEW drift)',
    () => {
      // All failures are RSVE (proven by AC-8a). The remaining contract: every
      // RSVE failure lives in a DOCUMENTED_DRIFT_FILES test file. A new RSVE
      // failure in any OTHER route test = NEW drift the gate must catch.
      const allFailuresAreRsve = state.suite.failureMessages.every((msg) =>
        msg.includes('ResponseSchemaValidationError'),
      );
      expect(allFailuresAreRsve).toBe(true);
      expect(state.suite.numFailedTests).toBe(
        state.suite.failureMessages.length,
      );

      const undocumentedDriftFiles = state.suite.failedFilePaths.filter(
        (filePath) => !isDocumentedDriftFile(filePath),
      );
      expect(
        undocumentedDriftFiles,
        `NEW strictness drift outside the documented ID-50 set: ${undocumentedDriftFiles.join(', ')}`,
      ).toEqual([]);

      // The documented set is the net WORKING outcome per OQ-1 — do NOT
      // require all-green. Bound the residual so a corpus-wide regression
      // cannot hide here (the 7 documented files carry ~24 RSVE failures).
      expect(state.suite.numFailedTests).toBeGreaterThan(0);
      expect(state.suite.numFailedTests).toBeLessThan(
        state.suite.numTotalTests / 10,
      );
    },
    AC_TEST_TIMEOUT_MS,
  );

  it(
    'AC-9a: no NEW lint errors after --apply (delta after <= before on migrated app/api routes)',
    () => {
      // OQ-3 RESOLVED (S262): AC-9 lint check is the DELTA, not absolute-0.
      expect(state.lintErrorsBefore).toBeGreaterThanOrEqual(0); // setup sanity
      expect(state.lintErrorsAfter).toBeGreaterThanOrEqual(0);
      expect(state.lintErrorsAfter).toBeLessThanOrEqual(state.lintErrorsBefore);
    },
    AC_TEST_TIMEOUT_MS,
  );

  it('AC-9b (NON-VACUOUS, PRODUCT §8): every emitted defineRoute(...) resolves its z + schema imports — ZERO no-undef diagnostics on migrated routes', () => {
    // B3 unresolved-name defects were invisible to ESLint; this is the
    // load-bearing non-vacuous check. ZERO TS2304/2552/2503/2307.
    const noUndef = state.routeDiagnostics.filter((d) =>
      NO_UNDEF_CODES.has(d.code),
    );
    expect(
      noUndef,
      `B3 no-undef diagnostics on migrated routes: ${JSON.stringify(noUndef)}`,
    ).toEqual([]);
  });

  it('AC-9c: the ONLY residual route diagnostics are the +WRC ctx-contravariance class (TS2345) — owned by Task ID-50', () => {
    // The destructured `{ params }` ctx param is not assignable to the
    // generic `RouteHandlerContext` `defineRoute` declares; resolving it
    // needs the generic ctx type tracked in ID-50. Assert these are the
    // ONLY residual diagnostics — anything else is an unexpected regression.
    const unexpected = state.routeDiagnostics.filter(
      (d) => d.code !== WRC_CTX_CONTRAVARIANCE_CODE,
    );
    expect(
      unexpected,
      `unexpected non-+WRC route diagnostics (not ID-50 scope): ${JSON.stringify(unexpected)}`,
    ).toEqual([]);
    // And the +WRC class must actually be present — proving the check ran
    // against migrated routes (not a vacuous empty diagnostics set).
    const wrc = state.routeDiagnostics.filter(
      (d) => d.code === WRC_CTX_CONTRAVARIANCE_CODE,
    );
    expect(wrc.length).toBeGreaterThan(0);
  });

  it(
    'AC-10: type-drift-detect --update-baseline then --ci passes against the migrated temp copy',
    () => {
      // Regenerate the baseline to reflect the post-apply fetcher-only set,
      // then the --ci gate must pass (exit 0). Runs against the migrated copy.
      const updateBaseline = run(
        'bun',
        [AST_DATAFLOW_CLI, 'type-drift-detect', '--update-baseline'],
        state.corpus,
      );
      expect(updateBaseline.status, updateBaseline.stderr.slice(-400)).toBe(0);

      const ci = run(
        'bun',
        [AST_DATAFLOW_CLI, 'type-drift-detect', '--ci'],
        state.corpus,
      );
      expect(ci.status, ci.stderr.slice(-400)).toBe(0);
    },
    AC_TEST_TIMEOUT_MS,
  );
});
