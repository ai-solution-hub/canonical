/**
 * `align-test-paths` — move every test under `__tests__/app/` to the path
 * implied by the production module it exercises.
 *
 * The repo convention (docs/reference/testing/test-philosophy.md §3) is that a
 * test's path under `__tests__/` equals its production path from the repo root.
 * `__tests__/app/api/procurement/procurement-export.test.ts` therefore belongs
 * at `__tests__/app/api/procurement/[id]/export/route.test.ts`.
 *
 * WHY ts-morph AND NOT REGEX: the subject under test must be distinguished from
 * modules that are merely *mocked*. A regex prototype counted
 * `vi.mock('@/app/item/new/batch/batch-create-client')` as a second subject for
 * `new-item-tabs.test.tsx`, which would have sent the file to the wrong
 * directory. Only statically or dynamically *imported* `@/app/**` modules are
 * subjects; `vi.mock()` / `vi.doMock()` arguments are dependencies. That
 * distinction is an AST property, not a textual one.
 *
 * Mirrors the `wrap-define-route.ts` house pattern: dry-run by default,
 * `--apply` to write, `--scope` to restrict, both artefacts emitted on every
 * run, `CODEMOD_OUTPUT_DIR` override for tests.
 *
 * Moves are performed with `git mv` so git records them as renames and file
 * history survives.
 *
 * Usage:
 *   bun scripts/codemods/align-test-paths.ts [--apply] [--scope <path>]
 *   bun scripts/codemods/align-test-paths.ts --help
 */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, basename, posix } from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { Node, Project, SyntaxKind, type SourceFile } from 'ts-morph';

// ── Vocabulary ─────────────────────────────────────────────────────────────

/**
 * Per-file outcome.
 *
 * `OK` files are already correct and are not touched. `MOVE` and `RENAME` are
 * mechanisable. Everything else is reported for a human decision and left
 * byte-identical, because the correct answer needs judgement the AST cannot
 * supply (what to call a file, or which of two overlapping files wins).
 */
export type AlignVerdict =
  | 'OK'
  | 'MOVE'
  | 'RENAME'
  | 'BOUNDARY'
  | 'CROSS_CUTTING'
  | 'MANUAL';

export type ManualReason =
  /** Two or more source files derive the same target; needs an aspect suffix. */
  | 'COLLISION_NEEDS_ASPECT'
  /** Target already exists on disk as a different file. */
  | 'TARGET_EXISTS'
  /** No `@/app/**` import — the subject cannot be derived. */
  | 'NO_SUBJECT_IMPORT'
  /** Several subjects under a shared route dir; the filename needs a human. */
  | 'MULTI_SUBJECT_NAME'
  /** A catch-all bucket that needs splitting by hand, not relocating. */
  | 'NEEDS_CONTENT_SPLIT';

export interface AlignPlanEntry {
  /** Repo-relative current path. */
  source: string;
  /** Repo-relative destination, or `undefined` when nothing should move. */
  target?: string;
  verdict: AlignVerdict;
  reason?: ManualReason;
  /** The `@/app/**` modules this file imports (not the ones it mocks). */
  subjects: string[];
}

export interface NeedsManualEntry {
  file: string;
  reason: ManualReason;
  suggestion?: string;
  subjects: string[];
}

const EXIT_OK = 0;
const EXIT_FATAL = 1;

const DEFAULT_OUTPUT_DIR = 'docs/generated';
const DRY_RUN_REPORT_FILENAME = 'align-test-paths-dry-run.md';
const NEEDS_MANUAL_REPORT_FILENAME = 'align-test-paths-needs-manual.json';

/** Next.js special files that make a test a boundary test rather than a unit. */
const BOUNDARY_MODULES: ReadonlySet<string> = new Set([
  'error',
  'loading',
  'not-found',
  'global-error',
]);

const TEST_FILE_PATTERN = /^__tests__\/app\/.*\.test\.tsx?$/;

/**
 * Catch-all buckets that must be split by hand rather than moved.
 *
 * These files cover several unrelated routes, so their common ancestor is
 * `app/api` and the cross-cutting rule below would file them under
 * `_cross-cutting/`. That directory asserts something specific — "this test
 * proves a property shared across routes" — which is true of `auth.test.ts` and
 * `validation.test.ts` but false of a bucket that simply accumulated routes
 * with no home. Relocating them would launder a naming problem into a
 * semantic claim, so they are reported instead.
 *
 * Splitting them is a content change (each destination needs its own hoisted
 * `vi.mock()` declarations, which cannot be shared via a helper), so it is out
 * of scope for a path codemod.
 */
const NEEDS_CONTENT_SPLIT: ReadonlySet<string> = new Set([
  '__tests__/app/api/remaining-routes.test.ts',
]);

const USAGE = `align-test-paths — align test paths to production paths

Usage:
  bun scripts/codemods/align-test-paths.ts [options]

Options:
  --apply          Perform the moves via 'git mv' (default: dry-run only)
  --scope <path>   Restrict to test files whose path contains this fragment
                   (e.g. '__tests__/app/api/procurement')
  --help           Show this message

Output files (always written, even in dry-run):
  docs/generated/align-test-paths-dry-run.md          Human-readable move plan
  docs/generated/align-test-paths-needs-manual.json   Files needing a decision

Override the output directory via the CODEMOD_OUTPUT_DIR environment variable.

Only OK / MOVE / RENAME / BOUNDARY / CROSS_CUTTING files are touched under
--apply. MANUAL files are reported and left byte-identical.
`;

// ── CLI argv parsing ───────────────────────────────────────────────────────

export interface ParsedCliArgs {
  apply: boolean;
  help: boolean;
  scope: string | undefined;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      apply: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      scope: { type: 'string' },
    },
    allowPositionals: false,
  });
  return {
    apply: values.apply === true,
    help: values.help === true,
    scope: values.scope,
  };
}

// ── ts-morph project init ──────────────────────────────────────────────────

export function createCodemodProject(
  tsConfigFilePath = 'tsconfig.json',
): Project {
  return new Project({
    tsConfigFilePath: resolve(process.cwd(), tsConfigFilePath),
    skipAddingFilesFromTsConfig: false,
  });
}

// ── Test-file enumeration ──────────────────────────────────────────────────

/**
 * Enumerate test files under `__tests__/app/`, anchored to `rootDir` so
 * fixture corpora nested elsewhere never match (the same anchoring bug
 * `wrap-define-route` hit in S262).
 */
export function enumerateTestFiles(
  project: Project,
  scope?: string,
  rootDir: string = process.cwd(),
): SourceFile[] {
  const rootPosix = rootDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const toRootRelative = (absolute: string): string => {
    const posixPath = absolute.replace(/\\/g, '/');
    return posixPath.startsWith(`${rootPosix}/`)
      ? posixPath.slice(rootPosix.length + 1)
      : posixPath;
  };

  const all = project
    .getSourceFiles()
    .filter((sf) => TEST_FILE_PATTERN.test(toRootRelative(sf.getFilePath())));

  if (!scope) return all;
  const scopeNormalised = scope.replace(/\\/g, '/');
  return all.filter((sf) =>
    sf.getFilePath().replace(/\\/g, '/').includes(scopeNormalised),
  );
}

// ── Subject discovery (the part regex gets wrong) ───────────────────────────

/** Collect every `vi.mock(...)` / `vi.doMock(...)` module specifier. */
function collectMockedSpecifiers(sf: SourceFile): Set<string> {
  const mocked = new Set<string>();
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    if (calleeText !== 'vi.mock' && calleeText !== 'vi.doMock') continue;
    const [arg] = call.getArguments();
    if (arg && Node.isStringLiteral(arg)) mocked.add(arg.getLiteralValue());
  }
  return mocked;
}

/**
 * The `@/app/**` modules this test actually exercises.
 *
 * Includes static `import` declarations and dynamic `import()` calls; excludes
 * anything that appears as a `vi.mock()` argument, because a stubbed module is
 * a dependency, not the subject under test.
 */
export function findSubjectModules(sf: SourceFile): string[] {
  const mocked = collectMockedSpecifiers(sf);
  const subjects = new Set<string>();

  const consider = (spec: string): void => {
    if (spec.startsWith('@/app/') && !mocked.has(spec)) subjects.add(spec);
  };

  for (const imp of sf.getImportDeclarations()) {
    consider(imp.getModuleSpecifierValue());
  }

  // Dynamic `import('...')` — a CallExpression whose callee is the `import`
  // keyword. Several route tests use this to defer module evaluation until
  // after `vi.mock()` factories are registered.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const [arg] = call.getArguments();
    if (arg && Node.isStringLiteral(arg)) consider(arg.getLiteralValue());
  }

  return [...subjects].sort();
}

// ── Target derivation ──────────────────────────────────────────────────────

/** `@/app/api/x/route` -> `app/api/x/route` */
function specToProdPath(spec: string): string {
  return spec.replace(/^@\//, '');
}

/** Longest common directory prefix of several production paths. */
function commonAncestorDir(prodPaths: string[]): string {
  const dirs = prodPaths.map((p) => posix.dirname(p).split('/'));
  const out: string[] = [];
  for (let i = 0; i < dirs[0].length; i++) {
    const seg = dirs[0][i];
    if (dirs.every((d) => d[i] === seg)) out.push(seg);
    else break;
  }
  return out.join('/');
}

function testExtension(file: string): string {
  return file.endsWith('.tsx') ? '.test.tsx' : '.test.ts';
}

/** Strip `.test.ts` / `.test.tsx` to get the filename stem. */
function testStem(file: string): string {
  return basename(file).replace(/\.test\.tsx?$/, '');
}

/**
 * Derive where a single test file belongs.
 *
 * Recognises the dot-suffix aspect form (`layout.branding.test.tsx`) as already
 * correct so it is never "corrected" to `layout.test.tsx`.
 */
export function derivePlan(
  sourceRel: string,
  subjects: string[],
): AlignPlanEntry {
  const ext = testExtension(sourceRel);
  const stem = testStem(sourceRel);
  const currentDir = posix.dirname(sourceRel);

  if (NEEDS_CONTENT_SPLIT.has(sourceRel)) {
    return {
      source: sourceRel,
      verdict: 'MANUAL',
      reason: 'NEEDS_CONTENT_SPLIT',
      subjects,
    };
  }

  if (subjects.length === 0) {
    return {
      source: sourceRel,
      verdict: 'MANUAL',
      reason: 'NO_SUBJECT_IMPORT',
      subjects,
    };
  }

  const prods = subjects.map(specToProdPath);

  // ── Single subject: the common case. ────────────────────────────────────
  if (prods.length === 1) {
    const prod = prods[0];
    const targetDir = posix.join('__tests__', posix.dirname(prod));
    const targetStem = basename(prod);

    // Already correct, either exactly or in dot-suffix aspect form.
    const isDotAspect = stem.startsWith(`${targetStem}.`);
    if (currentDir === targetDir && (stem === targetStem || isDotAspect)) {
      return { source: sourceRel, verdict: 'OK', subjects };
    }

    // A hyphen-suffixed variant (`page-mobile`) carries a real aspect that must
    // be preserved, not flattened to the bare module name. Renaming it to
    // `page.test.tsx` would silently discard the fact that the file covers the
    // mobile viewport specifically — and would then read as the canonical page
    // test. Convert to the dot form the convention mandates.
    const isHyphenAspect = stem.startsWith(`${targetStem}-`);
    const finalStem = isDotAspect
      ? stem
      : isHyphenAspect
        ? `${targetStem}.${stem.slice(targetStem.length + 1)}`
        : targetStem;

    const target = `${targetDir}/${finalStem}${ext}`;
    return {
      source: sourceRel,
      target,
      verdict: currentDir === targetDir ? 'RENAME' : 'MOVE',
      subjects,
    };
  }

  // ── Several subjects. ───────────────────────────────────────────────────
  const ancestor = commonAncestorDir(prods);
  const subjectBases = prods.map((p) => basename(p));

  // Boundary test: every subject is a Next.js error/loading special file.
  if (subjectBases.every((b) => BOUNDARY_MODULES.has(b))) {
    const targetDir = posix.join('__tests__', ancestor);
    const target = `${targetDir}/boundaries${ext}`;
    if (sourceRel === target)
      return { source: sourceRel, verdict: 'OK', subjects };
    return { source: sourceRel, target, verdict: 'BOUNDARY', subjects };
  }

  // Cross-cutting: the subjects share no meaningful ancestor, i.e. the file
  // reaches unrelated routes to prove a shared property (auth, validation).
  // `app` and `app/api` are too shallow to be a real home.
  if (ancestor === 'app' || ancestor === 'app/api') {
    const targetDir = '__tests__/app/api/_cross-cutting';
    const target = `${targetDir}/${stem}${ext}`;
    if (sourceRel === target)
      return { source: sourceRel, verdict: 'OK', subjects };
    return { source: sourceRel, target, verdict: 'CROSS_CUTTING', subjects };
  }

  // Several subjects under one real route directory. The directory is
  // derivable but the filename is a judgement call, so escalate rather than
  // invent a name that may violate the no-redundant-prefix rule.
  const suggestedDir = posix.join('__tests__', ancestor);
  if (currentDir === suggestedDir) {
    return { source: sourceRel, verdict: 'OK', subjects };
  }
  return {
    source: sourceRel,
    verdict: 'MANUAL',
    reason: 'MULTI_SUBJECT_NAME',
    subjects,
    target: `${suggestedDir}/<name>${ext}`,
  };
}

// ── Collision detection ────────────────────────────────────────────────────

/**
 * Demote any plan whose target is contested to MANUAL.
 *
 * Two failure modes, both needing the dot-suffix aspect convention:
 *   - two source files derive the same target
 *   - the target already exists on disk as a different file
 */
export function detectCollisions(
  plans: AlignPlanEntry[],
  fileExists: (rel: string) => boolean = (rel) =>
    existsSync(resolve(process.cwd(), rel)),
): AlignPlanEntry[] {
  const byTarget = new Map<string, AlignPlanEntry[]>();
  for (const plan of plans) {
    if (!plan.target || plan.verdict === 'MANUAL' || plan.verdict === 'OK')
      continue;
    const group = byTarget.get(plan.target) ?? [];
    group.push(plan);
    byTarget.set(plan.target, group);
  }

  return plans.map((plan) => {
    if (!plan.target || plan.verdict === 'MANUAL' || plan.verdict === 'OK') {
      return plan;
    }
    const contenders = byTarget.get(plan.target) ?? [];
    if (contenders.length > 1) {
      return { ...plan, verdict: 'MANUAL', reason: 'COLLISION_NEEDS_ASPECT' };
    }
    if (plan.target !== plan.source && fileExists(plan.target)) {
      return { ...plan, verdict: 'MANUAL', reason: 'TARGET_EXISTS' };
    }
    return plan;
  });
}

// ── Artefact emission ──────────────────────────────────────────────────────

const MOVABLE: ReadonlySet<AlignVerdict> = new Set<AlignVerdict>([
  'MOVE',
  'RENAME',
  'BOUNDARY',
  'CROSS_CUTTING',
]);

export function buildDryRunReport(
  plans: AlignPlanEntry[],
  context: { apply: boolean; scope?: string },
): string {
  const tally = new Map<AlignVerdict, number>();
  for (const p of plans) tally.set(p.verdict, (tally.get(p.verdict) ?? 0) + 1);

  const lines: string[] = [
    '# align-test-paths — move plan',
    '',
    `Mode: ${context.apply ? 'APPLY' : 'DRY-RUN'}`,
    ...(context.scope ? [`Scope: \`${context.scope}\``] : []),
    `Files examined: ${plans.length}`,
    '',
    '## Tally',
    '',
  ];

  for (const verdict of [
    'OK',
    'MOVE',
    'RENAME',
    'BOUNDARY',
    'CROSS_CUTTING',
    'MANUAL',
  ] as AlignVerdict[]) {
    const count = tally.get(verdict) ?? 0;
    if (count > 0) lines.push(`- ${verdict}: ${count}`);
  }

  const movable = plans.filter((p) => MOVABLE.has(p.verdict));
  lines.push('', `## Planned moves (${movable.length})`, '');
  for (const p of movable) {
    lines.push(`- \`${p.source}\``, `  -> \`${p.target}\` (${p.verdict})`);
  }

  const manual = plans.filter((p) => p.verdict === 'MANUAL');
  lines.push('', `## Needs a decision (${manual.length})`, '');
  for (const p of manual) {
    lines.push(
      `- \`${p.source}\` — ${p.reason}`,
      ...(p.target ? [`  suggested: \`${p.target}\``] : []),
      `  subjects: ${p.subjects.length === 0 ? '(none)' : p.subjects.map((s) => `\`${s}\``).join(', ')}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

export function buildNeedsManualReport(
  plans: AlignPlanEntry[],
): NeedsManualEntry[] {
  return plans
    .filter((p) => p.verdict === 'MANUAL' && p.reason)
    .map((p) => ({
      file: p.source,
      reason: p.reason as ManualReason,
      ...(p.target ? { suggestion: p.target } : {}),
      subjects: p.subjects,
    }));
}

export function resolveOutputDir(outputDir?: string): string {
  if (outputDir) return resolve(outputDir);
  const envOverride = process.env['CODEMOD_OUTPUT_DIR'];
  if (envOverride && envOverride.length > 0) return resolve(envOverride);
  return resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
}

// ── Apply ──────────────────────────────────────────────────────────────────

/**
 * Move the mechanisable plans with `git mv` so git records renames and file
 * history is preserved. Returns the destination paths actually written.
 */
export function applyMoves(plans: AlignPlanEntry[]): {
  moved: string[];
  failures: { source: string; message: string }[];
} {
  const moved: string[] = [];
  const failures: { source: string; message: string }[] = [];

  for (const plan of plans) {
    if (!MOVABLE.has(plan.verdict) || !plan.target) continue;
    mkdirSync(resolve(process.cwd(), dirname(plan.target)), {
      recursive: true,
    });
    const result = spawnSync('git', ['mv', plan.source, plan.target], {
      encoding: 'utf8',
    });
    if (result.status === 0) {
      moved.push(plan.target);
    } else {
      failures.push({
        source: plan.source,
        message: (result.stderr || result.stdout || 'git mv failed').trim(),
      });
    }
  }

  return { moved, failures };
}

export function runFormatPass(paths: readonly string[]): number {
  if (paths.length === 0) return 0;
  const result = spawnSync('bun', ['run', 'format', ...paths], {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  return result.status ?? 0;
}

// ── Main entry point ───────────────────────────────────────────────────────

export interface RunAlignResult {
  fileCount: number;
  apply: boolean;
  scope?: string;
  plans: AlignPlanEntry[];
  dryRunReportPath: string;
  needsManualReportPath: string;
}

export async function runAlign(
  args: ParsedCliArgs,
  options: { outputDir?: string } = {},
): Promise<RunAlignResult> {
  const project = createCodemodProject();
  const testFiles = enumerateTestFiles(project, args.scope);
  const rootPosix = process.cwd().replace(/\\/g, '/');

  console.log(
    `${testFiles.length} test file(s) discovered${args.scope ? ` (scoped to ${args.scope})` : ''}.`,
  );

  const rawPlans = testFiles.map((sf) => {
    const sourceRel = sf
      .getFilePath()
      .replace(/\\/g, '/')
      .replace(`${rootPosix}/`, '');
    return derivePlan(sourceRel, findSubjectModules(sf));
  });

  const plans = detectCollisions(rawPlans).sort((a, b) =>
    a.source.localeCompare(b.source),
  );

  if (args.apply) {
    const { moved, failures } = applyMoves(plans);
    console.log(`Moved ${moved.length} test file(s).`);
    for (const f of failures) {
      console.warn(
        `[align-test-paths] could not move ${f.source}: ${f.message}`,
      );
    }
    const formatStatus = runFormatPass(moved);
    if (formatStatus !== 0) {
      console.warn(
        `[align-test-paths] format pass exited ${formatStatus} — files moved but may need a manual 'bun run format'.`,
      );
    }
  }

  const outputDir = resolveOutputDir(options.outputDir);
  const dryRunReportPath = resolve(outputDir, DRY_RUN_REPORT_FILENAME);
  const needsManualReportPath = resolve(
    outputDir,
    NEEDS_MANUAL_REPORT_FILENAME,
  );
  mkdirSync(dirname(dryRunReportPath), { recursive: true });

  const reportContext = {
    apply: args.apply,
    ...(args.scope ? { scope: args.scope } : {}),
  };

  writeFileSync(
    dryRunReportPath,
    buildDryRunReport(plans, reportContext),
    'utf8',
  );
  writeFileSync(
    needsManualReportPath,
    `${JSON.stringify(buildNeedsManualReport(plans), null, 2)}\n`,
    'utf8',
  );

  console.log(`Wrote ${dryRunReportPath}.`);
  console.log(`Wrote ${needsManualReportPath}.`);

  return {
    fileCount: testFiles.length,
    apply: args.apply,
    ...(args.scope ? { scope: args.scope } : {}),
    plans,
    dryRunReportPath,
    needsManualReportPath,
  };
}

// ── CLI bootstrap ──────────────────────────────────────────────────────────

function isDirectInvocation(): boolean {
  return (process.argv[1] ?? '').endsWith('align-test-paths.ts');
}

if (isDirectInvocation()) {
  (async () => {
    try {
      const args = parseCliArgs(process.argv.slice(2));
      if (args.help) {
        console.log(USAGE);
        process.exit(EXIT_OK);
      }
      await runAlign(args);
      process.exit(EXIT_OK);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[align-test-paths] fatal: ${message}`);
      process.exit(EXIT_FATAL);
    }
  })();
}
