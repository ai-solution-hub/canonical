#!/usr/bin/env bun
/**
 * `wrap-define-route` — OPS-T1 codemod scaffold.
 *
 * Spec:
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PRODUCT.md
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/TECH.md
 *
 * Scope (cumulative through Subtask 32.13):
 *   - CLI argv parsing via `node:util` `parseArgs` — `--apply`, `--scope`,
 *     `--help` flags (TECH §5 / §9). [32.5]
 *   - `--help` output and exit 0; exit code 1 on fatal init failure.
 *   - ts-morph `Project` initialisation from the working tree's
 *     `tsconfig.json` (TECH §2.1). [32.5]
 *   - Route enumeration via `app/api/.*\/route.ts$` regex over
 *     `project.getSourceFiles()` (TECH §2.2) with optional `--scope` filter.
 *     [32.5]
 *   - `classifyRoute()` shape classifier — 17 RouteShape variants per TECH
 *     §2.3 with body-detection AST refactor from 32.17. [32.6 + 32.17]
 *   - `inferSchema()` Source A inference (`.type-drift-baseline.json` →
 *     `${interfaceName}Schema` lookup with NEEDS_SCHEMA fall-back). [32.8]
 *   - `buildRouteRecords()` per-route assembly + `emitDryRunReport()` +
 *     `emitNeedsManualReport()` — both artefacts emitted on EVERY run per
 *     PRODUCT AC-4. [32.12]
 *   - `isAlreadyWrapped(sf, method)` idempotency detector — direct form
 *     (`defineRoute(...)`) + `withRequestContext(defineRoute(...))` AC-7
 *     composition. Routes whose every method is already wrapped land in
 *     the SKIPPED bucket of the dry-run report with no needs-manual entry
 *     per PRODUCT §4. [32.13]
 *
 * Downstream Subtasks add:
 *   - 32.9 Source B inference (return-type annotation, optional) — DONE
 *   - 32.10 / 32.11 handler rewrite (single / multi-method) — DONE
 *   - 32.13 idempotency check (`isAlreadyWrapped`) — DONE
 *   - 32.14 apply mode + format pass (`applyAll` / `runFormatPass`) — DONE
 *     (this Subtask)
 *
 * Under `--apply` the module rewrites + `sf.saveSync()`s the MECHANISABLE /
 * NEEDS-REVIEW routes, then runs `bun run format` over the modified set; in
 * dry-run mode it performs NO file rewrite — only artefact emission to
 * `docs/generated/` (or the test-injected `CODEMOD_OUTPUT_DIR` override).
 *
 * Usage:
 *   bun scripts/codemods/wrap-define-route.ts [--apply] [--scope <path>]
 *   bun scripts/codemods/wrap-define-route.ts --help
 */

import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  type Expression,
  Project,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph';
import {
  inferSchemaSourceA,
  type InferSchemaOptions,
  type InferSchemaResult,
} from './inference-source-a';
import { inferSchemaSourceB } from './inference-source-b';
import {
  emitDryRunReport,
  type DryRunReportContext,
  type RouteReportEntry,
} from './emit-dry-run';
import {
  emitNeedsManualReport,
  reasonForShape,
  type NeedsManualEntry,
} from './emit-needs-manual';
import { rewriteMultiMethod } from './rewrite-multi-method';
import { rewriteSingleMethod } from './rewrite-single-method';
import type { NeedsManualReason, RouteShape } from './types';

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Repo-root-anchored route matcher (S262 fix B3). The path RELATIVE to the
 * enumeration root must begin with `app/api/` and end with `/route.ts`. Anchored
 * with `^` so it matches the repo-root `app/api/` directory ONLY — NOT fixture
 * routes nested under `tools/ast-dataflow/__tests__/fixtures/.../app/api/.../route.ts`,
 * which the pre-fix unanchored `app/api/.*\/route\.ts$` swept in (inflating the
 * live corpus 195 → 198).
 */
const ROUTE_FILE_PATTERN = /^app\/api\/.*\/route\.ts$/;

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
  'UNKNOWN_WRAPPER',
]);

/**
 * The outer-wrapper callee identifiers the codemod knows how to handle when an
 * exported method is bound as `export const METHOD = <Call>(...)`:
 *
 *   - `withRequestContext` — the recognised +WRC wrapper; the rewrite
 *     surgically wraps the INNER argument with `defineRoute(...)` while
 *     preserving the outer call (TECH §8.1 / AC-7).
 *   - `defineRoute` — the codemod's own output; an already-wrapped route the
 *     idempotency overlay (Subtask 32.13) treats as SKIPPED.
 *
 * Any OTHER outer callee (e.g. `withRequestContextBare`) is an unknown wrapper
 * the codemod cannot safely transform — see `hasUnknownOuterWrapper()` (S262
 * fix B1). The pre-fix bug was a `getFullText().includes('withRequestContext')`
 * substring scan that matched `withRequestContextBare`, mis-flagging such
 * routes as `+WRC` and then aborting `--apply` when the rewrite threw.
 */
const RECOGNISED_OUTER_WRAPPERS: ReadonlySet<string> = new Set<string>([
  'withRequestContext',
  'defineRoute',
]);

const EXIT_OK = 0;
const EXIT_FATAL = 1;

/**
 * Default output directory for both artefacts. Per TECH §6 the canonical
 * location is `docs/generated/`; tests redirect via the
 * `CODEMOD_OUTPUT_DIR` environment variable to a `tmpdir()` location so
 * `bun run test` never dirties the committed `docs/generated/` tree.
 *
 * Resolved against `process.cwd()` at run time so the same constant works
 * from any invocation directory.
 */
const DEFAULT_OUTPUT_DIR = 'docs/generated';
const DRY_RUN_REPORT_FILENAME = 'codemod-dry-run.md';
const NEEDS_MANUAL_REPORT_FILENAME = 'codemod-needs-manual.json';

const USAGE = `wrap-define-route — OPS-T1 codemod for Knowledge Hub

Usage:
  bun scripts/codemods/wrap-define-route.ts [options]

Options:
  --apply          Write changes to disk (default: dry-run only)
  --scope <path>   Restrict to routes whose path contains this fragment
                   (e.g. 'app/api/intelligence')
  --help           Show this message

Output files (always written, even in dry-run — PRODUCT.md AC-4):
  docs/generated/codemod-dry-run.md         Human-readable diff preview
  docs/generated/codemod-needs-manual.json  Structured MANUAL/NEEDS-REVIEW report

Override the output directory via the CODEMOD_OUTPUT_DIR environment
variable; tests redirect emission to a tmpdir().

Status: rewrite emitters (Subtasks 32.10 / 32.11), inference wiring
(32.8 + 32.9), idempotency (32.13), and apply-mode (32.14) have all
landed. With --apply the codemod rewrites + saves the MECHANISABLE /
NEEDS-REVIEW routes and runs 'bun run format' over the modified set;
MANUAL (CRON / NAKED_NO_AUTH / MCP) and already-wrapped routes are left
byte-identical. Both artefacts are still emitted on every run (AC-4).
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
export function createCodemodProject(
  tsConfigFilePath = 'tsconfig.json',
): Project {
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
 * Per TECH §2.2 the canonical route matcher excludes pages, page-route
 * segments, and non-route helpers inside `app/api/`. Match against the file's
 * POSIX path so the same filter works on macOS / Linux CI / Windows-style
 * paths uniformly.
 *
 * Repo-root anchoring (S262 fix B3): the matcher is applied to the path made
 * RELATIVE to `rootDir` (default `process.cwd()`, the repo root in production).
 * Only paths that sit directly under `<rootDir>/app/api/` qualify — fixture
 * routes nested under `tools/ast-dataflow/__tests__/fixtures/.../app/api/.../route.ts`
 * are excluded because their root-relative path starts with `__tests__/`, not
 * `app/api/`. The pre-fix unanchored regex `app/api/.*\/route\.ts$` matched
 * those fixtures as a substring, inflating the live corpus 195 → 198.
 *
 * Tests that build a tmpdir-rooted corpus pass that tmpdir as `rootDir` so the
 * anchoring fires against the synthetic root.
 */
export function enumerateRouteFiles(
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

  const all = project.getSourceFiles().filter((sf) => {
    const relativePath = toRootRelative(sf.getFilePath());
    return ROUTE_FILE_PATTERN.test(relativePath);
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
 * Detect whether a route source file calls `request.json()` or `parseBody(...)`
 * in EXECUTABLE code (i.e. excluding JSDoc, line comments, and string
 * literals). Returns `true` when at least one such call is present.
 *
 * Subtask 32.17 — AST refactor of the body-detection signal: pre-32.17 the
 * classifier used `sf.getFullText().includes('request.json()')` /
 * `.includes('parseBody(')`, which scanned ALL file text (comments and string
 * literals included). That tainted classification on any route mentioning the
 * discriminator substrings in JSDoc / comments. Post-refactor the detection
 * walks `getDescendantsOfKind(SyntaxKind.CallExpression)` and matches:
 *
 *   - `<receiver>.json(...)` — PropertyAccessExpression callee where the
 *     property name is `json`. The original substring `request.json()` matched
 *     any receiver text equal to `request`; for AST symmetry we accept any
 *     receiver whose text contains `request` or `req` (covers `request`, `req`,
 *     and `_request` synonyms — these are conservative widenings since the
 *     classifier already accepts those param names in production routes).
 *     In practice the receiver match is the literal `request` substring rule
 *     bound to executable code only.
 *   - `parseBody(...)` — either a direct `Identifier` callee named
 *     `parseBody` or a `PropertyAccessExpression` callee whose name is
 *     `parseBody` (covers both bare `parseBody(...)` and module-style
 *     `helpers.parseBody(...)` invocations, mirroring the original substring
 *     `parseBody(` which would have matched the property-access form too).
 *
 * Comments and string literals are not `CallExpression` nodes — by
 * construction they are excluded from the walk. JSDoc tags such as `@example`
 * are JSDoc syntax nodes and not call expressions.
 */
function hasBodyCall(sf: SourceFile): boolean {
  const callExprs = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const callExpr of callExprs) {
    const expr = callExpr.getExpression();

    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      // PropertyAccessExpression: <object>.<name>
      const propAccess = expr.asKind(SyntaxKind.PropertyAccessExpression);
      if (!propAccess) continue;
      const name = propAccess.getName();
      if (name === 'json') {
        // Match `<receiver>.json(...)` where the receiver text contains
        // `request` — covers `request`, `req`, `_request`, and any other
        // production-route convention. The original substring scan keyed
        // off the verbatim `request.json()` token, so the receiver gate
        // keeps the post-refactor signal proportionate.
        const receiverText = propAccess.getExpression().getText();
        if (receiverText.includes('request') || receiverText.includes('req')) {
          return true;
        }
      }
      if (name === 'parseBody') {
        // Module-style invocation, e.g. `helpers.parseBody(...)`.
        return true;
      }
    } else if (expr.getKind() === SyntaxKind.Identifier) {
      // Bare `parseBody(...)` call.
      if (expr.getText() === 'parseBody') {
        return true;
      }
    }
  }
  return false;
}

/**
 * The outer-call callee identifier of an `export const METHOD = <Call>(...)`
 * binding, or `null` when the method is not an exported `const` initialised by
 * a direct `CallExpression` (e.g. a `FunctionDeclaration` form, a bare arrow,
 * or an identifier reference).
 *
 * "Outer call" means the topmost `CallExpression` initialiser — for
 * `withRequestContext(defineRoute(...))` this returns `'withRequestContext'`,
 * not `'defineRoute'`. Used by the +WRC detector and the unknown-wrapper guard
 * (S262 fix B1).
 */
function exportedMethodOuterCallee(
  sf: SourceFile,
  method: string,
): string | null {
  for (const stmt of sf.getVariableStatements()) {
    if (!stmt.isExported()) continue;
    const decl = stmt.getDeclarations().find((d) => d.getName() === method);
    if (!decl) continue;
    const initialiser = decl.getInitializer();
    if (!initialiser || initialiser.getKind() !== SyntaxKind.CallExpression) {
      return null;
    }
    const callExpr = initialiser.asKind(SyntaxKind.CallExpression);
    if (!callExpr) return null;
    return callExpr.getExpression().getText();
  }
  return null;
}

/**
 * Detect whether any exported HTTP-method handler on `sf` is bound as
 * `export const METHOD = withRequestContext(...)` with `withRequestContext` as
 * the EXACT outer callee (S262 fix B1).
 *
 * Replaces the pre-fix `sf.getFullText().includes('withRequestContext')`
 * substring scan, which matched the DIFFERENT `withRequestContextBare`
 * function (and any comment / string-literal occurrence of the substring). The
 * exact AST-callee match never matches `withRequestContextBare` — the callee
 * text is compared with `===`, not `includes`.
 *
 * Mirrors the body-detection AST precedent from Subtask 32.17 (`hasBodyCall`):
 * detection is anchored to executable AST nodes, never raw file text.
 */
function hasWithRequestContextWrapper(
  sf: SourceFile,
  methods: string[],
): boolean {
  return methods.some(
    (m) => exportedMethodOuterCallee(sf, m) === 'withRequestContext',
  );
}

/**
 * Detect whether any exported HTTP-method handler on `sf` is bound as
 * `export const METHOD = <unknownCall>(...)` where the outer callee is neither
 * a recognised wrapper (`withRequestContext`) nor the codemod's own output
 * (`defineRoute`) — see `RECOGNISED_OUTER_WRAPPERS` (S262 fix B1).
 *
 * The canonical example is `withRequestContextBare` (used by
 * `app/api/freshness/recalculate-all/route.ts`): a single-argument decorator
 * the codemod cannot mechanically rewrite without understanding its wrapping
 * contract. Such routes classify as `UNKNOWN_WRAPPER` (MANUAL) so the apply
 * loop skips them instead of throwing.
 *
 * `FunctionDeclaration`-form methods (`export async function METHOD(...)`) and
 * bare-arrow / identifier initialisers return `null` from
 * `exportedMethodOuterCallee()` and are NOT treated as unknown wrappers — they
 * are the codemod's normal mechanisable inputs.
 */
function hasUnknownOuterWrapper(sf: SourceFile, methods: string[]): boolean {
  return methods.some((m) => {
    const callee = exportedMethodOuterCallee(sf, m);
    return callee !== null && !RECOGNISED_OUTER_WRAPPERS.has(callee);
  });
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
 * `+WRC` is appended for MECHANISABLE / NEEDS-REVIEW shapes whose exported
 * method is wrapped with `withRequestContext` as its EXACT outer callee
 * (TECH §2.3 / §8.1; S262 fix B1 made this an AST match rather than a
 * `getFullText()` substring scan, so `withRequestContextBare` and comment /
 * string-literal occurrences no longer taint the suffix). It is NEVER appended
 * to MANUAL shapes because the codemod does not rewrite those routes — the
 * outer-wrap concern is moot.
 *
 * A route whose exported method uses an UNRECOGNISED outer wrapper (any outer
 * callee that is neither `withRequestContext` nor `defineRoute`, e.g.
 * `withRequestContextBare`) classifies as `UNKNOWN_WRAPPER` (MANUAL) — the
 * codemod skips it during apply rather than attempting a transform it cannot
 * safely perform (S262 fix B1).
 *
 * Body detection per Subtask 32.17 (AST refactor of the TECH §2.3 sample):
 * a `CallExpression` walk over the source file matching `<receiver>.json(...)`
 * or `parseBody(...)` / `*.parseBody(...)`. Excludes JSDoc, line comments,
 * and string literals — see `hasBodyCall()` above for the full predicate.
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
    if (!moduleSpecifier.includes('@/lib/auth/client')) return false;
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

  // Priority 3.5 — UNKNOWN_WRAPPER (MANUAL), S262 fix B1.
  //
  // A route whose exported method is bound as
  // `export const METHOD = <unrecognisedCall>(...)` (an outer callee that is
  // neither `withRequestContext` nor `defineRoute`) cannot be mechanically
  // rewritten — the codemod does not know how to preserve the wrapping
  // contract. The canonical example is `withRequestContextBare` (used by
  // `app/api/freshness/recalculate-all/route.ts`). Classify it MANUAL so the
  // apply loop skips it instead of throwing. This check sits AFTER the auth
  // gate (the route has auth) and BEFORE the mechanisable / +WRC branches.
  if (hasUnknownOuterWrapper(sf, methods)) return 'UNKNOWN_WRAPPER';

  const isParameterised = path.includes('[');
  // Body detection now walks the AST (CallExpression-only) per Subtask 32.17 —
  // discriminator substrings in JSDoc / comments / string literals no longer
  // taint classification.
  const hasBody = hasBodyCall(sf);
  // +WRC detection is an EXACT AST outer-callee match (S262 fix B1), NOT the
  // pre-fix `getFullText().includes('withRequestContext')` substring scan. The
  // substring scan matched the DIFFERENT `withRequestContextBare` function (and
  // any comment / string-literal occurrence), mis-flagging bare-wrapped routes
  // as `+WRC` and aborting `--apply` when the rewrite threw. The exact match
  // only fires for `export const METHOD = withRequestContext(...)`.
  const hasWithRequestContext = hasWithRequestContextWrapper(sf, methods);

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

// ── ResponseSchema inference ──────────────────────────────────────────────

/**
 * Infer the `ResponseSchema` argument for a route handler.
 *
 * Composes Source A (repo-root `.type-drift-baseline.json` URL-matcher,
 * Subtask 32.8) with Source B (existing `Promise<NextResponse<X>>` return-
 * type annotation, Subtask 32.9). Source C (handler return-statement walk)
 * is explicitly out of scope per PLAN.md §4 Subtask 32.9 OQ-2 / TECH §3.C.
 *
 * Chain order (per TECH §3 recommended ranking + Subtask 32.9 testStrategy):
 *
 *   1. Source B is tried first. When the handler carries an explicit
 *      `Promise<NextResponse<X>>` return-type annotation, the developer's
 *      stated type is authoritative — it beats Source A's heuristic URL
 *      matcher because the annotation is unambiguous syntactic intent.
 *      Source B returns `null` when the annotation is absent, signalling
 *      the chain should fall through.
 *
 *   2. Source A runs when Source B returns `null`. Source A's URL matcher
 *      binds the route file to its `${interfaceName}` via the fetcher
 *      walk, then looks up `${interfaceName}Schema` / `${interfaceName}ZodSchema`
 *      via name convention. Source A's own fall-back (no baseline match,
 *      or no co-located Schema constant) is the final `z.unknown()` +
 *      `NEEDS_SCHEMA` outcome.
 *
 * Both sources land on the same fall-back shape
 * (`{ schema: 'z.unknown()', reason: 'NEEDS_SCHEMA' }`) so the rewrite
 * emitters (Subtasks 32.10 / 32.11) do not need to distinguish between
 * "Source B failed schema lookup" and "Source A failed schema lookup" —
 * both produce the same AC-6 TODO comment behaviour.
 *
 * Per PRODUCT.md AC-5 / AC-6:
 *   - AC-5: routes whose interface IS in the baseline AND has a
 *     `${interfaceName}Schema` constant get the schema identifier verbatim.
 *   - AC-6: routes that fall back to `z.unknown()` carry the
 *     `NEEDS_SCHEMA` reason code so the 32.12 emitter can attach the
 *     `// TODO(OPS-T1): author ResponseSchema` comment.
 */
export function inferSchema(
  sf: SourceFile,
  method: string,
  project: Project,
  options?: InferSchemaOptions,
): InferSchemaResult {
  // Source B is opportunistic — the developer's explicit annotation beats
  // Source A's URL matcher when present. The `schemasPath` is the only
  // option both sources share at the chain level; tests inject it via
  // Source A's `options.schemasPath` and the same value is forwarded.
  const sourceBResult = inferSchemaSourceB(sf, method, project, {
    ...(options?.schemasPath ? { schemasPath: options.schemasPath } : {}),
  });
  if (sourceBResult !== null) {
    return sourceBResult;
  }
  return inferSchemaSourceA(sf, method, project, options);
}

// ── Handler rewrite — single-method ──────────────────────────────────────

/**
 * Single-method handler rewrite for the four MECHANISABLE single-method
 * shapes (`AUTH_PLAIN`, `PARAM_BODY`, `BODY_VALIDATED`, `PARAM`) plus the
 * `+WRC` sub-variant of each. Implementation lives in
 * `rewrite-single-method.ts` (extracted from `wrap-define-route.ts` per the
 * Subtask 32.10 brief's "exceeds 80 LOC" carve-out — total module size is
 * ~285 LOC including helper documentation).
 *
 * Re-exported here so the call-site contract in the codemod (and the test
 * suite's import path) stays `wrap-define-route.ts`-anchored — the
 * extraction is an internal organisation decision, not a public-API change.
 *
 * Multi-method rewrites land via Subtask 32.11's `rewriteMultiMethod` —
 * the per-method dispatch in 32.11 invokes this same `rewriteSingleMethod`
 * once per exported method.
 */
export { rewriteSingleMethod };

/**
 * Multi-method handler rewrite for the three multi-method NEEDS-REVIEW shapes
 * (`MULTI_PARAM_BODY` / `MULTI_BODY` / `MULTI_PARAM`) plus their `+WRC`
 * sub-variants. Implementation lives in `rewrite-multi-method.ts` per the
 * Subtask 32.11 brief's file-ownership boundary; each exported method is
 * rewritten independently by delegating to `rewriteSingleMethod` once per
 * method, and one `NeedsManualEntry` per method is returned for the
 * codemod-needs-manual.json artefact (TECH §6.2 — reason
 * `MULTI_METHOD_SCHEMA`).
 *
 * Re-exported here so the call-site contract in the codemod (and the test
 * suite's import path) stays `wrap-define-route.ts`-anchored — the
 * extraction is an internal organisation decision, not a public-API change.
 */
export { rewriteMultiMethod };

// ── Idempotency check (Subtask 32.13) ─────────────────────────────────────

/**
 * The wrapper callee identifier text we recognise as "already wrapped"
 * (PRODUCT §4). Centralised so any future rename of the wrapper function
 * (e.g. `defineRoute` → `defineApiRoute`) flips this constant and the
 * downstream rewrite emitters in `rewrite-single-method.ts` /
 * `rewrite-multi-method.ts` together.
 */
const DEFINE_ROUTE_CALLEE_TEXT = 'defineRoute';

/**
 * The outer wrapper callee identifier text recognised as a legitimate AC-7
 * composition (`withRequestContext(defineRoute(...))`). Per TECH §8.1 the
 * outer-wrap order is the load-bearing invariant — `withRequestContext`
 * stays outermost; `defineRoute` lives inside.
 */
const WITH_REQUEST_CONTEXT_CALLEE_TEXT = 'withRequestContext';

/**
 * Detect whether the exported handler `method` on `sf` has already been
 * wrapped with `defineRoute(...)` per PRODUCT §4 (idempotency guarantee).
 *
 * Two AST forms qualify as wrapped:
 *
 *   (a) Direct form — `export const METHOD = defineRoute(Schema, async (req)
 *       => { ... });`. The `VariableStatement` initialiser is a
 *       `CallExpression` whose callee identifier text is `defineRoute`.
 *
 *   (b) +WRC composition — `export const METHOD = withRequestContext(
 *         defineRoute(Schema, async (req) => { ... })
 *       );`. The initialiser is a `CallExpression` whose callee is
 *       `withRequestContext` AND whose first argument is a `CallExpression`
 *       with callee `defineRoute`. This is the post-32.10 AC-7-compliant
 *       output for the +WRC sub-variant — re-running the codemod on a
 *       partially-migrated tree MUST short-circuit it.
 *
 * Returns `false` for:
 *   - `FunctionDeclaration` form (`export async function METHOD(...)`) —
 *     by definition not wrapped; there is no initialiser to inspect.
 *   - `VariableStatement` initialisers that are not `defineRoute(...)` or
 *     `withRequestContext(defineRoute(...))` (e.g. raw arrow function,
 *     `withRequestContext(asyncArrow)` without an inner `defineRoute`).
 *   - Method names that do not appear as an exported handler in `sf` at
 *     all — defensive no-op, consistent with treating "no method found" as
 *     "no wrapped method found".
 *
 * Called by `buildRouteRecords()` (the per-route discovery loop) and
 * short-circuits the action verdict to `'SKIPPED'` before the rewrite
 * emitters (32.10 / 32.11) get a chance to mutate the source. The
 * `codemod-needs-manual.json` artefact does NOT carry SKIPPED routes
 * (PRODUCT §4 explicit guarantee).
 *
 * Spec:
 *   - PRODUCT.md §4 (idempotency contract).
 *   - PRODUCT.md §8 AC-3 (re-applying produces no further file changes).
 *   - TECH.md §8.1 (outer-wrap order for +WRC).
 *   - PLAN.md §4 Subtask 32.13 (this function).
 */
export function isAlreadyWrapped(sf: SourceFile, method: string): boolean {
  // FunctionDeclaration form is never wrapped — it has no initialiser. Skip
  // straight to the VariableStatement search.
  const fnDecl = sf.getFunction(method);
  if (fnDecl && fnDecl.isExported()) {
    return false;
  }

  // Locate `export const METHOD = X` — the only form that can carry a
  // wrapper call. Mirrors `findExportedMethodVariableStatement` in
  // rewrite-single-method.ts but lives here so the discovery loop can
  // query it without pulling in the rewrite helper's internals.
  let initialiser: Expression | undefined;
  for (const stmt of sf.getVariableStatements()) {
    if (!stmt.isExported()) continue;
    const decl = stmt.getDeclarations().find((d) => d.getName() === method);
    if (decl) {
      initialiser = decl.getInitializer();
      break;
    }
  }
  if (!initialiser) {
    // No exported `const METHOD = ...` binding — not wrapped (and not even
    // present; the caller's `getExportedMethods` would not have enumerated
    // this method if it did not exist).
    return false;
  }

  if (initialiser.getKind() !== SyntaxKind.CallExpression) {
    // Bare arrow function, identifier reference, etc. Not wrapped.
    return false;
  }
  const callExpr = initialiser.asKind(SyntaxKind.CallExpression);
  if (!callExpr) return false;

  const calleeText = callExpr.getExpression().getText();

  // Direct form — `defineRoute(...)`.
  if (calleeText === DEFINE_ROUTE_CALLEE_TEXT) {
    return true;
  }

  // +WRC composition — `withRequestContext(defineRoute(...))`. The outer
  // call must be `withRequestContext`; its first argument must be a
  // `CallExpression` whose callee is `defineRoute`. Anything else (e.g.
  // `withRequestContext(asyncArrow)` without an inner `defineRoute`) is
  // NOT wrapped — the codemod still has to rewrite the inner arrow.
  if (calleeText === WITH_REQUEST_CONTEXT_CALLEE_TEXT) {
    const args = callExpr.getArguments();
    if (args.length === 0) return false;
    const innerArg = args[0]!;
    if (innerArg.getKind() !== SyntaxKind.CallExpression) return false;
    const innerCall = innerArg.asKind(SyntaxKind.CallExpression);
    if (!innerCall) return false;
    return innerCall.getExpression().getText() === DEFINE_ROUTE_CALLEE_TEXT;
  }

  return false;
}

// ── Per-route assembly ───────────────────────────────────────────────────

/**
 * Mapping from `RouteShape` verdict to the codemod's intended action.
 *
 * MANUAL shapes (`CRON` / `NAKED_NO_AUTH` / `MCP`) are skipped during apply
 * mode per PRODUCT §6.1. MULTI_* and *+WRC variants are wrapped but flagged
 * NEEDS_REVIEW so the developer confirms before merging (PRODUCT §6.2).
 * Single-method MECHANISABLE shapes (`AUTH_PLAIN` / `PARAM_BODY` /
 * `BODY_VALIDATED` / `PARAM`) are TRANSFORM — the codemod rewrites them
 * cleanly.
 *
 * The SKIPPED verdict (PRODUCT §4 idempotency) is NOT derived here — it
 * is overlaid by `buildRouteRecords()` via the `isAlreadyWrapped()` check
 * (Subtask 32.13). This helper returns the SHAPE-derived action; the
 * caller may flip TRANSFORM / NEEDS_REVIEW to SKIPPED when every exported
 * method already calls `defineRoute(...)`.
 */
function shapeToAction(shape: RouteShape): RouteReportEntry['action'] {
  if (MANUAL_SHAPES.has(shape)) {
    return 'MANUAL';
  }
  if (shape.startsWith('MULTI_') || shape.endsWith('+WRC')) {
    return 'NEEDS_REVIEW';
  }
  return 'TRANSFORM';
}

/**
 * Resolve a source file's absolute path to a repo-relative POSIX path so
 * the emitted artefacts read consistently across operating systems.
 *
 * Falls back to the absolute path if the file does not live under the
 * current working directory (defensive — should never fire in practice
 * since the ts-morph project loads from the working-tree tsconfig).
 */
function toRepoRelativePosixPath(absolutePath: string): string {
  const cwdPosix = process.cwd().replace(/\\/g, '/');
  const filePosix = absolutePath.replace(/\\/g, '/');
  if (filePosix.startsWith(`${cwdPosix}/`)) {
    return filePosix.slice(cwdPosix.length + 1);
  }
  return filePosix;
}

/**
 * Build the per-route discovery record set the emitters consume.
 *
 * For Subtask 32.12 the record is derived from `classifyRoute()` +
 * `getExportedMethods()` only. Inference (Source A/B) and rewrite-diff
 * narration land via subsequent Subtasks; the record shape is forward-
 * compatible — `schemaSource`, `schemaIdentifier`, and `notes` are
 * optional fields that those upstream slices populate when wired.
 *
 * NEEDS_SCHEMA reasons surfaced by `inferSchema` will be merged into
 * `needsManualEntries` by the rewrite-loop callers (Subtasks 32.10 /
 * 32.11). The shape-derived entries built here are the floor — they do not
 * subsume inference-derived ones.
 */
export function buildRouteRecords(routeFiles: readonly SourceFile[]): {
  reportEntries: RouteReportEntry[];
  needsManualEntries: NeedsManualEntry[];
} {
  const reportEntries: RouteReportEntry[] = [];
  const needsManualEntries: NeedsManualEntry[] = [];

  for (const sf of routeFiles) {
    const shape = classifyRoute(sf);
    const methods = getExportedMethods(sf);
    const shapeAction = shapeToAction(shape);
    const route = toRepoRelativePosixPath(sf.getFilePath());

    // Subtask 32.13 idempotency gate: for MECHANISABLE / NEEDS-REVIEW shapes,
    // check whether EVERY exported method is already wrapped per PRODUCT §4.
    // If so, the route is a no-op and lands in the SKIPPED bucket — no
    // needs-manual entry (idempotent successes are not unhandled cases).
    //
    // MANUAL shapes (CRON / NAKED_NO_AUTH / MCP) bypass the idempotency
    // check: the codemod never rewrites them, so they cannot be "already
    // wrapped" in the codemod's sense (the developer migrates them by
    // hand under a different model). Running the check on MANUAL would
    // be inert at best and misleading at worst.
    //
    // Partial-migration semantics: a multi-method route where SOME methods
    // are wrapped and OTHERS are not is NOT SKIPPED — the rewrite loop
    // still has work to do on the un-wrapped methods. We require
    // `every(method, isAlreadyWrapped)` so the SKIPPED bucket is reserved
    // for true no-ops.
    const isIdempotentSkip =
      shapeAction !== 'MANUAL' &&
      methods.length > 0 &&
      methods.every((m) => isAlreadyWrapped(sf, m));

    const action: RouteReportEntry['action'] = isIdempotentSkip
      ? 'SKIPPED'
      : shapeAction;

    const reason: NeedsManualReason | null = reasonForShape(shape);
    const reportEntry: RouteReportEntry = {
      route,
      shape,
      methods,
      action,
    };
    // `reason` is reserved for NEEDS_REVIEW / MANUAL entries per
    // emit-dry-run.ts RouteReportEntry contract; SKIPPED routes do NOT
    // carry one (PRODUCT §4 — they are idempotent successes).
    if (reason && (action === 'NEEDS_REVIEW' || action === 'MANUAL')) {
      reportEntry.reason = reason;
    }
    reportEntries.push(reportEntry);

    // needs-manual.json carries NEEDS-REVIEW and MANUAL routes ONLY.
    // SKIPPED routes are explicitly omitted per PRODUCT §4.
    if (reason && (action === 'NEEDS_REVIEW' || action === 'MANUAL')) {
      const entry: NeedsManualEntry = {
        route,
        shape,
        reason,
      };
      // Multi-method routes need per-method visibility per TECH §6.2
      // (MULTI_METHOD_SCHEMA reason). Single-method NEEDS-REVIEW entries
      // (e.g. AUTH_PLAIN+WRC with WRC_COMPOSITION) omit the field because
      // there is only one method.
      if (shape.startsWith('MULTI_')) {
        entry.methods = methods;
      }
      needsManualEntries.push(entry);
    }
  }

  return { reportEntries, needsManualEntries };
}

// ── Apply mode (Subtask 32.14) ────────────────────────────────────────────

/**
 * Options forwarded to `applyAll`'s per-method `inferSchema()` calls. Tests
 * inject `baseline` / `schemasPath` so Source A/B resolution can be exercised
 * deterministically; production callers omit it and the chain falls through to
 * the on-disk repo-root `.type-drift-baseline.json` (or the `z.unknown()`
 * + `NEEDS_SCHEMA` fall-back when no source resolves).
 */
type ApplyOptions = InferSchemaOptions;

/**
 * A per-route apply failure absorbed by `applyAll()` (S262 fix B1,
 * defense-in-depth). Records the route whose rewrite threw plus the error
 * message so the caller can surface it in the needs-manual report instead of
 * aborting the whole apply run. The route's file is left in whatever state the
 * partial rewrite produced (not saved) — `applyAll()` does NOT `sf.save()` a
 * route whose rewrite threw, so the on-disk file stays byte-identical.
 */
export interface ApplyError {
  /** Repo-relative POSIX path of the route whose rewrite threw. */
  route: string;
  /** The thrown error message (or stringified non-Error throw). */
  message: string;
}

/**
 * Result of an `applyAll()` run (S262 fix B1). The modified-path set drives
 * `runFormatPass()`; the apply-error set is merged into the needs-manual report
 * by `runScaffold()` so a per-route rewrite failure is recorded for manual
 * follow-up rather than aborting the run.
 */
export interface ApplyResult {
  /**
   * Absolute paths of the files mutated + saved, in route iteration order, for
   * `runFormatPass()` to format. SKIPPED + MANUAL routes are omitted, as are
   * routes whose rewrite threw (recorded in `applyErrors` instead).
   */
  modifiedFilePaths: string[];
  /** Per-route rewrite failures absorbed during the run (empty on a clean run). */
  applyErrors: ApplyError[];
}

/**
 * Apply the codemod to disk for every MECHANISABLE (`TRANSFORM`) and
 * NEEDS-REVIEW route, then persist each modified file via `sf.save()`.
 *
 * Disposition mirrors `buildRouteRecords()`: a route is classified, mapped to
 * a SHAPE-derived action via `shapeToAction()`, then the idempotency overlay
 * (Subtask 32.13) flips any all-methods-wrapped route to SKIPPED. Only
 * TRANSFORM + NEEDS_REVIEW routes are rewritten and saved:
 *
 *   - MANUAL shapes (`CRON` / `NAKED_NO_AUTH` / `MCP`) are NOT rewritten and
 *     NOT saved — left byte-identical on disk per PRODUCT §6.1 / AC-2.
 *   - SKIPPED routes (every exported method already wrapped) are NOT saved —
 *     left byte-identical per PRODUCT §4 / AC-3 (re-apply is a no-op).
 *
 * Rewrite dispatch is by shape per the Subtask 32.14 brief:
 *   - `MULTI_*` shapes → `rewriteMultiMethod()` (per-method delegation).
 *   - every other rewritable shape (single-method MECHANISABLE + the
 *     single-method `+WRC` NEEDS_REVIEW sub-variant) → `rewriteSingleMethod()`
 *     once per exported method.
 *
 * Per-method `ResponseSchema` inference runs via `inferSchema()` (Source B →
 * Source A → `z.unknown()` fall-back). A route that yields only `z.unknown()`
 * fall-backs is still rewritten (AC-6 attaches the TODO comment) and still
 * saved — the apply path does not gate on schema confidence.
 *
 * Import ordering: `sf.organizeImports()` is invoked before `sf.save()` per
 * TECH §8.5 so the freshly-added `defineRoute` import lands in a
 * Prettier-compatible position; `runFormatPass()` then normalises quoting /
 * spacing across the saved set.
 *
 * Dry-run mode never calls this function — `runScaffold()` only invokes it
 * when `args.apply === true`. In dry-run the diff preview is computed from the
 * report entries instead (no `sf.save()`).
 *
 * Apply-loop resilience (S262 fix B1): each route's rewrite + save is wrapped
 * in a try/catch. A single route's rewrite failure NO LONGER aborts the whole
 * run — the failure is recorded to `applyErrors` (with an `APPLY_ERROR`-style
 * reason surfaced by `runScaffold()`) and the loop continues. This guarantees
 * one pathological route can never lose the other good rewrites. The
 * `rewriteSingleMethod` throw stays as a last-resort invariant guard; this
 * loop absorbs it per-route. A route whose rewrite throws is NOT saved, so its
 * on-disk file stays byte-identical.
 *
 * @param routes  The route `SourceFile`s to consider (already enumerated +
 *                scope-filtered by `enumerateRouteFiles()`).
 * @param project The owning ts-morph `Project` — required by `inferSchema()`
 *                for the Source A/B cross-file walks.
 * @param options Optional inference overrides (test injection).
 * @returns An {@link ApplyResult}: the absolute paths of files mutated + saved
 *          (in route iteration order, for `runFormatPass()`) plus any per-route
 *          apply errors absorbed during the run. SKIPPED + MANUAL routes are
 *          omitted from `modifiedFilePaths`.
 */
export function applyAll(
  routes: readonly SourceFile[],
  project: Project,
  options?: ApplyOptions,
): ApplyResult {
  const modifiedFilePaths: string[] = [];
  const applyErrors: ApplyError[] = [];

  for (const sf of routes) {
    const shape = classifyRoute(sf);
    const shapeAction = shapeToAction(shape);

    // MANUAL shapes are never rewritten — leave the file untouched on disk.
    // This now includes UNKNOWN_WRAPPER (S262 fix B1): a route wrapped in an
    // outer call the codemod does not recognise (e.g. withRequestContextBare)
    // is skipped here, never reaching the rewrite path that would throw.
    if (shapeAction === 'MANUAL') continue;

    const methods = getExportedMethods(sf);
    if (methods.length === 0) continue;

    // Idempotency overlay (Subtask 32.13): a route whose EVERY exported method
    // is already wrapped is a no-op — skip the rewrite + save so re-applying
    // an already-migrated tree produces zero further file changes (AC-3).
    const isIdempotentSkip = methods.every((m) => isAlreadyWrapped(sf, m));
    if (isIdempotentSkip) continue;

    const route = toRepoRelativePosixPath(sf.getFilePath());

    // Apply-loop resilience (S262 fix B1): absorb a per-route rewrite/save
    // failure so one pathological route cannot abort the whole run. A genuine
    // throw from the rewrite helpers (last-resort invariant guard) is recorded
    // and the loop continues; the route's file is left unsaved (byte-identical).
    try {
      if (shape.startsWith('MULTI_')) {
        // Multi-method: resolve each method's schema independently, then let
        // rewriteMultiMethod() delegate per-method to rewriteSingleMethod().
        const schemas: Record<string, InferSchemaResult> = {};
        for (const method of methods) {
          schemas[method] = inferSchema(sf, method, project, options);
        }
        rewriteMultiMethod(sf, methods, schemas, route, shape);
      } else {
        // Single-method MECHANISABLE shapes + the single-method +WRC
        // NEEDS_REVIEW sub-variant: rewrite each exported method in place. A
        // genuinely single-method route has one entry; the loop is defensive
        // against a shape that exports more than one method without being
        // MULTI_*.
        for (const method of methods) {
          const schema = inferSchema(sf, method, project, options);
          rewriteSingleMethod(sf, method, schema);
        }
      }

      // Normalise import ordering before persisting (TECH §8.5) so the
      // freshly-added `defineRoute` import does not land in a non-Prettier
      // position; runFormatPass() handles quoting + spacing across the set.
      sf.organizeImports();
      sf.saveSync();
      modifiedFilePaths.push(sf.getFilePath());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[wrap-define-route] apply skipped ${route}: ${message} — recorded as APPLY_ERROR; continuing.`,
      );
      applyErrors.push({ route, message });
    }
  }

  return { modifiedFilePaths, applyErrors };
}

/**
 * Run `bun run format` against the modified file set after the apply save
 * loop completes (TECH §8.5 / AC-9). Prettier normalises the quoting +
 * spacing of ts-morph's emitted output so the post-apply tree lands lint-clean.
 *
 * No-op when `modifiedFilePaths` is empty (a fully-idempotent or all-MANUAL
 * run produces nothing to format). Returns the spawn status so the caller can
 * surface a non-zero formatter exit without aborting the run (the files are
 * already saved; a formatter failure is a quality-of-output issue, not a
 * correctness one).
 *
 * @param modifiedFilePaths Absolute paths returned by `applyAll()`.
 * @returns The `bun run format` exit status, or `0` when there is nothing to
 *          format.
 */
export function runFormatPass(modifiedFilePaths: readonly string[]): number {
  if (modifiedFilePaths.length === 0) return 0;
  const result = spawnSync('bun', ['run', 'format', ...modifiedFilePaths], {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  return result.status ?? 0;
}

// ── Output-path resolution ────────────────────────────────────────────────

/**
 * Resolve the directory where both artefacts should land.
 *
 * Precedence:
 *   1. Explicit `outputDir` argument from the caller (test injection).
 *   2. `CODEMOD_OUTPUT_DIR` environment variable (test override at the
 *      process boundary — survives `bun scripts/...` spawning).
 *   3. `DEFAULT_OUTPUT_DIR` (`docs/generated/`) resolved against the
 *      current working directory.
 *
 * Tests use either (1) the in-process API path or (2) the env-var
 * override so the committed `docs/generated/` tree is never touched by
 * `bun run test`.
 */
export function resolveOutputDir(outputDir?: string): string {
  if (outputDir) return resolve(outputDir);
  const envOverride = process.env['CODEMOD_OUTPUT_DIR'];
  if (envOverride && envOverride.length > 0) {
    return resolve(envOverride);
  }
  return resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
}

// ── Main entry point ──────────────────────────────────────────────────────

export interface RunScaffoldResult {
  routeCount: number;
  apply: boolean;
  scope?: string;
  dryRunReportPath: string;
  needsManualReportPath: string;
  reportEntries: RouteReportEntry[];
  needsManualEntries: NeedsManualEntry[];
}

/**
 * Run the codemod against the working tree.
 *
 * Per Subtask 32.12 the scaffold now:
 *   1. Loads the ts-morph project from `tsconfig.json`.
 *   2. Enumerates route files (with optional `--scope` filter).
 *   3. Classifies each route via `classifyRoute()`.
 *   4. Builds the per-route discovery records.
 *   5. Emits both artefacts (`codemod-dry-run.md` +
 *      `codemod-needs-manual.json`) on EVERY run (dry-run AND apply) per
 *      PRODUCT.md AC-4.
 *
 * Returns metadata about the run; throws on fatal init failure (ts-morph
 * cannot load tsconfig, file write permission, etc.). The CLI wrapper
 * converts thrown errors into exit code 1.
 *
 * `outputDir` accepts a test-injected override; production callers omit it
 * to consume `CODEMOD_OUTPUT_DIR` env or fall through to `docs/generated/`.
 */
export async function runScaffold(
  args: ParsedCliArgs,
  options: { outputDir?: string } = {},
): Promise<RunScaffoldResult> {
  const project = createCodemodProject();
  const routeFiles = enumerateRouteFiles(project, args.scope);

  console.log(
    `${routeFiles.length} route(s) discovered${args.scope ? ` (scoped to ${args.scope})` : ''}.`,
  );

  // Apply mode (Subtask 32.14): rewrite + save the MECHANISABLE / NEEDS-REVIEW
  // routes to disk, then run the format pass over the modified set. The
  // discovery + artefact emission below still runs on every invocation
  // (PRODUCT AC-4), so the dry-run report reflects the just-applied tree.
  // MANUAL + SKIPPED routes are left byte-identical by `applyAll()`.
  let applyErrors: ApplyError[] = [];
  if (args.apply) {
    const applyResult = applyAll(routeFiles, project);
    applyErrors = applyResult.applyErrors;
    console.log(
      `Applied defineRoute() to ${applyResult.modifiedFilePaths.length} route file(s).`,
    );
    if (applyErrors.length > 0) {
      console.warn(
        `[wrap-define-route] ${applyErrors.length} route(s) recorded as APPLY_ERROR (skipped, not aborted) — see codemod-needs-manual.json.`,
      );
    }
    const formatStatus = runFormatPass(applyResult.modifiedFilePaths);
    if (formatStatus !== 0) {
      console.warn(
        `[wrap-define-route] format pass exited ${formatStatus} — files were saved but may need a manual 'bun run format'.`,
      );
    }
  }

  const { reportEntries, needsManualEntries } = buildRouteRecords(routeFiles);

  // Merge per-route apply failures (S262 fix B1) into the needs-manual report
  // so a rewrite that threw mid-apply is recorded for manual follow-up rather
  // than silently lost (the apply loop already absorbed the throw to keep the
  // run going). De-duplicated against any shape-derived entry for the same
  // route — the APPLY_ERROR signal is the more actionable one.
  for (const applyError of applyErrors) {
    const existingIndex = needsManualEntries.findIndex(
      (e) => e.route === applyError.route,
    );
    const entry: NeedsManualEntry = {
      route: applyError.route,
      shape: 'UNKNOWN_WRAPPER',
      reason: 'APPLY_ERROR',
    };
    if (existingIndex >= 0) {
      needsManualEntries[existingIndex] = entry;
    } else {
      needsManualEntries.push(entry);
    }
  }

  // Artefact emission per AC-4 — on EVERY run, dry-run or apply.
  const outputDir = resolveOutputDir(options.outputDir);
  const dryRunReportPath = resolve(outputDir, DRY_RUN_REPORT_FILENAME);
  const needsManualReportPath = resolve(
    outputDir,
    NEEDS_MANUAL_REPORT_FILENAME,
  );

  // Ensure the output directory exists. `recursive: true` is a no-op when
  // the directory already exists (the normal case for `docs/generated/`)
  // and creates intermediate directories when tests inject a `tmpdir()`
  // sub-path that does not yet exist.
  mkdirSync(dirname(dryRunReportPath), { recursive: true });

  const reportContext: DryRunReportContext = {
    apply: args.apply,
    ...(args.scope ? { scope: args.scope } : {}),
  };
  emitDryRunReport(reportEntries, dryRunReportPath, reportContext);
  emitNeedsManualReport(needsManualEntries, needsManualReportPath);

  console.log(`Wrote ${dryRunReportPath}.`);
  console.log(`Wrote ${needsManualReportPath}.`);

  return {
    routeCount: routeFiles.length,
    apply: args.apply,
    ...(args.scope ? { scope: args.scope } : {}),
    dryRunReportPath,
    needsManualReportPath,
    reportEntries,
    needsManualEntries,
  };
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
