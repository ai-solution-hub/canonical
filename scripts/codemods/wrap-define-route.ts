#!/usr/bin/env bun
/**
 * `wrap-define-route` — OPS-T1 codemod scaffold.
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md
 *
 * Scope (Subtask 32.5): SCAFFOLD ONLY. This file implements:
 *   - CLI argv parsing via `node:util` `parseArgs` (TECH §5 / §9).
 *   - `--help` output and exit 0.
 *   - ts-morph `Project` initialisation from the working tree's
 *     `tsconfig.json` (TECH §2.1).
 *   - Route enumeration via `app/api/.*\/route.ts$` regex over
 *     `project.getSourceFiles()` (TECH §2.2) with optional `--scope` filter.
 *   - Exit code 0 on success / 1 on fatal init failure (TECH §5).
 *
 * Downstream Subtasks add:
 *   - 32.6 shape classifier
 *   - 32.8 ResponseSchema inference (Source A)
 *   - 32.10 / 32.11 handler rewrite (single / multi-method)
 *   - 32.12 dry-run + needs-manual artefact emitters
 *   - 32.13 idempotency check
 *   - 32.14 apply mode + format pass
 *
 * This scaffold MUST NOT rewrite any file. It is purely a discovery walk.
 *
 * Usage:
 *   bun scripts/codemods/wrap-define-route.ts [--apply] [--scope <path>]
 *   bun scripts/codemods/wrap-define-route.ts --help
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { Project, type SourceFile } from 'ts-morph';
import type { RouteShape } from './types';

// ── Constants ──────────────────────────────────────────────────────────────

const ROUTE_FILE_PATTERN = /app\/api\/.*\/route\.ts$/;

/**
 * Valid HTTP method names recognised as route exports per TECH §8.3.
 * `export const maxDuration / dynamic / runtime` are NOT methods and must be
 * skipped during both classification and rewrite.
 */
const HTTP_METHOD_NAMES: ReadonlySet<string> = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

/**
 * Shapes that are MANUAL per route-shape-inventory.md §6 (codemod skips them
 * entirely) — these MUST NOT carry the `+WRC` suffix even if the source file
 * happens to import or reference `withRequestContext`. The +WRC discriminator
 * is a rewrite concern (preserving outer-wrap order, per TECH §8.1); for
 * MANUAL shapes the codemod emits a needs-manual entry and bails, so the
 * suffix would only add noise to the dry-run report.
 */
const MANUAL_SHAPES: ReadonlySet<RouteShape> = new Set<RouteShape>([
  'CRON',
  'NAKED_NO_AUTH',
  'MCP',
]);

const EXIT_OK = 0;
const EXIT_FATAL = 1;

const USAGE = `wrap-define-route — OPS-T1 codemod for Knowledge Hub

Usage:
  bun scripts/codemods/wrap-define-route.ts [options]

Options:
  --apply          Write changes to disk (default: dry-run only)
  --scope <path>   Restrict to routes whose path contains this fragment
                   (e.g. 'app/api/intelligence')
  --help           Show this message

Output files (always written by full implementation, NOT by this scaffold):
  docs/generated/codemod-dry-run.md         Human-readable diff preview
  docs/generated/codemod-needs-manual.json  Structured MANUAL/NEEDS-REVIEW report

Status: SCAFFOLD ONLY (Subtask 32.5). This invocation enumerates routes but
performs no rewrite. Downstream Subtasks add the classifier, inference,
rewrite, idempotency check, and apply-mode logic.
`;

// ── CLI argv parsing ──────────────────────────────────────────────────────

interface ParsedCliArgs {
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

// ── ts-morph Project init ─────────────────────────────────────────────────

/**
 * Initialise a ts-morph `Project` from the working tree's `tsconfig.json`.
 * `skipAddingFilesFromTsConfig: false` (the default) is preserved per TECH
 * §2.1 so `app/**\/*.ts` (which includes `app/api/**\/route.ts`) loads
 * automatically.
 *
 * Throws if the tsconfig cannot be located or parsed — the CLI converts the
 * exception into exit code 1.
 */
export function createCodemodProject(tsConfigFilePath = 'tsconfig.json'): Project {
  return new Project({
    tsConfigFilePath: resolve(process.cwd(), tsConfigFilePath),
    skipAddingFilesFromTsConfig: false,
  });
}

// ── Route enumeration ─────────────────────────────────────────────────────

/**
 * Enumerate the API route files in the project, optionally filtered by a
 * path-fragment scope.
 *
 * Per TECH §2.2 the regex `app/api/.*\/route\.ts$` is the canonical route
 * matcher (excludes pages, page-route segments, and non-route helpers
 * inside `app/api/`). Match against the file's POSIX path so the same
 * filter works on macOS / Linux CI / Windows-style paths uniformly.
 */
export function enumerateRouteFiles(
  project: Project,
  scope?: string,
): SourceFile[] {
  const all = project.getSourceFiles().filter((sf) => {
    const posixPath = sf.getFilePath().replace(/\\/g, '/');
    return ROUTE_FILE_PATTERN.test(posixPath);
  });
  if (!scope) return all;
  const scopeNormalised = scope.replace(/\\/g, '/');
  return all.filter((sf) => {
    const posixPath = sf.getFilePath().replace(/\\/g, '/');
    return posixPath.includes(scopeNormalised);
  });
}

// ── Shape classification ──────────────────────────────────────────────────

/**
 * Enumerate the HTTP-method exports of a route file.
 *
 * Recognises both Next.js export forms per TECH §2.3:
 *   - `export async function METHOD(req: NextRequest) { ... }`
 *     (`FunctionDeclaration`)
 *   - `export const METHOD = withRequestContext(async (req) => { ... });`
 *     and `export const METHOD = defineRoute(Schema, async (req) => ...);`
 *     (`VariableStatement` with an exported `VariableDeclaration`)
 *
 * Non-method `export const` route-config constants (`maxDuration`,
 * `dynamic`, `runtime`) are filtered out per TECH §8.3 — the gate is the
 * export name, not its initialiser shape.
 *
 * Order is not specified: the classifier branches only on `length > 1` and
 * downstream rewrite emitters (32.10 / 32.11) iterate over the full set, so
 * a stable insertion order is sufficient. Callers needing deterministic
 * order should sort the returned array.
 */
export function getExportedMethods(sf: SourceFile): string[] {
  const methods: string[] = [];

  for (const fnDecl of sf.getFunctions()) {
    if (!fnDecl.isExported()) continue;
    const name = fnDecl.getName();
    if (name && HTTP_METHOD_NAMES.has(name)) {
      methods.push(name);
    }
  }

  for (const varStmt of sf.getVariableStatements()) {
    if (!varStmt.isExported()) continue;
    for (const decl of varStmt.getDeclarations()) {
      const name = decl.getName();
      if (HTTP_METHOD_NAMES.has(name)) {
        methods.push(name);
      }
    }
  }

  return methods;
}

/**
 * Classify a route source file into one of the 17 `RouteShape` variants per
 * TECH §2.3.
 *
 * Priority order (first match wins, per route-shape-inventory.md §2):
 *   1. Path under `/cron/`  → `CRON`     (MANUAL — different auth model)
 *   2. Path under `/mcp/`   → `MCP`      (MANUAL — protocol handler)
 *   3. No `@/lib/auth` import → `NAKED_NO_AUTH` (MANUAL — no wrapper)
 *   4. `>1` exported HTTP method → multi-method variant, sub-discriminated
 *      by `isParameterised × hasBody`.
 *   5. Single-method → sub-discriminated by `isParameterised × hasBody`.
 *
 * `+WRC` is appended for MECHANISABLE / NEEDS-REVIEW shapes whose source
 * contains a `withRequestContext` substring (TECH §2.3 / §8.1). It is
 * NEVER appended to MANUAL shapes because the codemod does not rewrite
 * those routes — the outer-wrap concern is moot.
 *
 * Body detection per TECH §2.3 sample: substring `request.json()` or
 * `parseBody(` in the file's full text — matches the corpus convention.
 *
 * Path parameterisation per TECH §2.3 sample: `[` in the file path —
 * detects the Next.js dynamic-segment syntax (`[id]`, `[...slug]`, etc.).
 */
export function classifyRoute(sf: SourceFile): RouteShape {
  const path = sf.getFilePath();

  // Priority 1 — CRON (MANUAL)
  if (path.includes('/cron/')) return 'CRON';

  // Priority 2 — MCP (MANUAL)
  if (path.includes('/mcp/')) return 'MCP';

  // Priority 3 — NAKED_NO_AUTH (MANUAL)
  // Per TECH §2.3 sample, the auth signal is an `@/lib/auth` import with
  // either `getAuthorisedClient` or `getAuthenticatedClient` as a named
  // import. Both helpers are covered per TECH §8.4.
  const hasAuth = sf.getImportDeclarations().some((decl) => {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    if (!moduleSpecifier.includes('@/lib/auth')) return false;
    return decl
      .getNamedImports()
      .some((named) =>
        ['getAuthorisedClient', 'getAuthenticatedClient'].includes(
          named.getName(),
        ),
      );
  });
  if (!hasAuth) return 'NAKED_NO_AUTH';

  // Mechanisable + needs-review classification signals
  const methods = getExportedMethods(sf);
  const isParameterised = path.includes('[');
  const fullText = sf.getFullText();
  const hasBody =
    fullText.includes('request.json()') || fullText.includes('parseBody(');
  const hasWithRequestContext = fullText.includes('withRequestContext');

  // Priority 4 — multi-method.
  //
  // Sub-discrimination by (isParameterised, hasBody):
  //   - (true,  true ) → MULTI_PARAM_BODY
  //   - (true,  false) → MULTI_PARAM
  //   - (false, true ) → MULTI_BODY
  //   - (false, false) → MULTI_BODY (defensive fall-back; see note below)
  //
  // The (false, false) cell does not appear in the route-shape-inventory.md
  // §3 distribution (4 MULTI_PARAM + 17 MULTI_BODY + 19 MULTI_PARAM_BODY =
  // 40 NEEDS-REVIEW total). The brief's `RouteShape` union deliberately
  // omits a `MULTI_PLAIN` member (TECH §2.3 names it but never instantiates
  // it). We pin the fall-back to `MULTI_BODY` so the classifier never
  // returns an out-of-union literal; if a non-param non-body multi-method
  // route ever materialises in the corpus, 32.11 / 32.12 will flag it
  // under the `MULTI_METHOD_SCHEMA` reason regardless.
  if (methods.length > 1) {
    let variant: RouteShape;
    if (isParameterised && hasBody) variant = 'MULTI_PARAM_BODY';
    else if (isParameterised) variant = 'MULTI_PARAM';
    else variant = 'MULTI_BODY';
    return hasWithRequestContext ? (`${variant}+WRC` as RouteShape) : variant;
  }

  // Priority 5 — single-method
  let variant: RouteShape;
  if (isParameterised && hasBody) variant = 'PARAM_BODY';
  else if (isParameterised) variant = 'PARAM';
  else if (hasBody) variant = 'BODY_VALIDATED';
  else variant = 'AUTH_PLAIN';

  // +WRC suffix applies to MECHANISABLE / NEEDS-REVIEW shapes only.
  if (hasWithRequestContext && !MANUAL_SHAPES.has(variant)) {
    return `${variant}+WRC` as RouteShape;
  }
  return variant;
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Run the codemod scaffold against the working tree.
 *
 * Returns the discovered route count (0+) on success; throws on fatal init
 * failure (ts-morph cannot load tsconfig, etc.). The CLI wrapper converts
 * thrown errors into exit code 1.
 */
export async function runScaffold(
  args: ParsedCliArgs,
): Promise<{ routeCount: number; apply: boolean }> {
  if (args.apply) {
    // Apply mode is not implemented in the scaffold — emit a notice and
    // continue with dry-run enumeration so the scaffold's exit-code-0
    // contract is preserved. Downstream Subtask 32.14 wires real apply
    // behaviour.
    console.log(
      '[scaffold] --apply not yet implemented (Subtask 32.14); running discovery only.',
    );
  }

  const project = createCodemodProject();
  const routeFiles = enumerateRouteFiles(project, args.scope);

  // Discovery-only output. The full dry-run report (PRODUCT §5 / TECH §6.1)
  // is emitted by Subtask 32.12. For Subtask 32.5 we only need the count
  // to confirm enumeration works against the live corpus.
  console.log(
    `${routeFiles.length} route(s) discovered${args.scope ? ` (scoped to ${args.scope})` : ''}.`,
  );

  return { routeCount: routeFiles.length, apply: args.apply };
}

// ── CLI bootstrap ──────────────────────────────────────────────────────────

/**
 * Detect whether this module is being executed directly (vs imported by a
 * test). When imported, `process.argv[1]` will be the test runner's path,
 * not this file's path.
 */
function isDirectInvocation(): boolean {
  const argv1 = process.argv[1] ?? '';
  return argv1.endsWith('wrap-define-route.ts');
}

if (isDirectInvocation()) {
  (async () => {
    try {
      const args = parseCliArgs(process.argv.slice(2));
      if (args.help) {
        console.log(USAGE);
        process.exit(EXIT_OK);
      }
      await runScaffold(args);
      process.exit(EXIT_OK);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[wrap-define-route] fatal: ${message}`);
      process.exit(EXIT_FATAL);
    }
  })();
}
