#!/usr/bin/env bun
/**
 * `wrap-define-route` — OPS-T1 codemod scaffold.
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md
 *
 * Scope (cumulative through Subtask 32.12):
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
 *   - `inferSchema()` Source A inference (`type-drift-baseline.json` →
 *     `${interfaceName}Schema` lookup with NEEDS_SCHEMA fall-back). [32.8]
 *   - `buildRouteRecords()` per-route assembly + `emitDryRunReport()` +
 *     `emitNeedsManualReport()` — both artefacts emitted on EVERY run per
 *     PRODUCT AC-4. [32.12]
 *
 * Downstream Subtasks add:
 *   - 32.9 Source B inference (return-type annotation, optional)
 *   - 32.10 / 32.11 handler rewrite (single / multi-method)
 *   - 32.13 idempotency check (`isAlreadyWrapped`)
 *   - 32.14 apply mode + format pass
 *
 * This module still performs NO file rewrite — only artefact emission to
 * `docs/generated/` (or the test-injected `CODEMOD_OUTPUT_DIR` override).
 *
 * Usage:
 *   bun scripts/codemods/wrap-define-route.ts [--apply] [--scope <path>]
 *   bun scripts/codemods/wrap-define-route.ts --help
 */

import { parseArgs } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Project, type SourceFile, SyntaxKind } from 'ts-morph';
import {
  inferSchemaSourceA,
  type InferSchemaOptions,
  type InferSchemaResult,
} from './inference-source-a';
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
(32.8 already landed; 32.9 optional), idempotency (32.13), and apply-mode
(32.14) are downstream. Subtask 32.12 covers CLI flags + both artefact
emitters; the discovery loop captures shape + methods + reason, and the
emitters render whatever metadata is present.
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
  // Body detection now walks the AST (CallExpression-only) per Subtask 32.17 —
  // discriminator substrings in JSDoc / comments / string literals no longer
  // taint classification.
  const hasBody = hasBodyCall(sf);
  // `withRequestContext` import detection is orthogonal and remains a
  // substring scan: the +WRC suffix tracks "does the source IMPORT the
  // helper" which captures both call-site and outer-wrap usage in a single
  // signal. Switching to an AST walk here is out of scope for 32.17.
  const hasWithRequestContext = sf.getFullText().includes('withRequestContext');

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
 * Currently exposes Source A (`docs/generated/type-drift-baseline.json`)
 * only. Sources B (return-type annotation, Subtask 32.9) and C (return-
 * statement walk, post-32 backlog) chain off this entry point if added —
 * the public contract stays `inferSchema(sf, method, project, options?)`
 * so downstream call sites in 32.10 / 32.11 / 32.12 do not change shape
 * when those sources land.
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
 * comes from `isAlreadyWrapped()` once Subtask 32.13 lands. For Subtask
 * 32.12 the classifier branch is the only signal.
 */
function shapeToAction(shape: RouteShape): RouteReportEntry['action'] {
  if (shape === 'CRON' || shape === 'NAKED_NO_AUTH' || shape === 'MCP') {
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
    const action = shapeToAction(shape);
    const route = toRepoRelativePosixPath(sf.getFilePath());

    const reason: NeedsManualReason | null = reasonForShape(shape);
    const reportEntry: RouteReportEntry = {
      route,
      shape,
      methods,
      action,
    };
    if (reason && (action === 'NEEDS_REVIEW' || action === 'MANUAL')) {
      reportEntry.reason = reason;
    }
    reportEntries.push(reportEntry);

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

  console.log(
    `${routeFiles.length} route(s) discovered${args.scope ? ` (scoped to ${args.scope})` : ''}.`,
  );

  const { reportEntries, needsManualEntries } = buildRouteRecords(routeFiles);

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
