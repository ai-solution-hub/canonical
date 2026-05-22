/**
 * `rewrite-single-method.ts` — single-method handler rewrite for the
 * `wrap-define-route` codemod.
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §2.4 (handler
 *     rewrite — Step A import-add + Step B function/variable replace).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §8.1
 *     (`withRequestContext` outer-wrap order — AC-7 load-bearing
 *     invariant).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §8.2 (Next.js 15
 *     `Promise<params>` second-argument preservation).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §8.3 (only
 *     `{GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS}` exports are touched
 *     — `maxDuration` / `dynamic` / `runtime` and other config exports are
 *     skipped).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md AC-6 / AC-7
 *     (TODO comment + outer-wrap order).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PLAN.md §4 Subtask 32.10.
 *
 * Scope (Subtask 32.10): the four single-method MECHANISABLE shapes —
 * `AUTH_PLAIN`, `PARAM_BODY`, `BODY_VALIDATED`, `PARAM` — plus the
 * `+WRC` sub-variant of each. The multi-method counterpart
 * (`MULTI_PARAM_BODY` / `MULTI_BODY` / `MULTI_PARAM` and their +WRC
 * variants) is owned by Subtask 32.11 and lives in
 * `rewrite-multi-method.ts` (to be authored).
 *
 * Two exported forms are recognised:
 *
 *   (a) `FunctionDeclaration` — `export async function METHOD(req) { ... }`
 *       Replaced wholesale with
 *       `export const METHOD = defineRoute(Schema, async (req) => { ... });`
 *
 *   (b) `VariableStatement` — `export const METHOD = withRequestContext(
 *         async (req) => { ... });`
 *       The inner arrow argument is replaced with
 *       `defineRoute(Schema, <inner-arrow>)`; the outer
 *       `withRequestContext(...)` call expression is preserved verbatim
 *       per AC-7.
 *
 * Imports:
 *   - `defineRoute` is imported from `@/lib/api/define-route` (TECH §2.4
 *     Step A). The insertion is idempotent — re-running the rewrite on a
 *     file that already has the import is a no-op.
 *
 * TODO comment:
 *   - When the supplied `schema` is `z.unknown()` (the `NEEDS_SCHEMA`
 *     fall-back from Source A / B / C inference per AC-6), a
 *     `// TODO(OPS-T1): author ResponseSchema` comment is placed on the
 *     line preceding the rewritten export. The codemod's
 *     `codemod-needs-manual.json` artefact (Subtask 32.12) carries the
 *     machine-readable counterpart; this in-source TODO is the human-
 *     facing one.
 *
 * Out of scope:
 *   - Multi-method rewrites (Subtask 32.11).
 *   - Already-wrapped idempotency-skip detection (Subtask 32.13's
 *     `isAlreadyWrapped`; this module assumes the caller has already
 *     guarded the no-op case).
 *   - `sf.save()` — apply-mode disk writes are Subtask 32.14.
 *   - Multi-method routes with mixed shapes — covered by 32.11's per-method
 *     dispatch into this same helper.
 */

import type { SourceFile } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import type { InferSchemaResult } from './inference-source-a';

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * The single module-specifier value matched against existing imports per
 * TECH §2.4 Step A. Centralised so the rewrite logic and any downstream
 * idempotency check share the same source of truth.
 */
const DEFINE_ROUTE_MODULE_SPECIFIER = '@/lib/api/define-route';

/**
 * The TODO comment placed on the line preceding the rewritten export when
 * the inferred schema is `z.unknown()` (AC-6 / PRODUCT §6.3).
 */
const NEEDS_SCHEMA_TODO_COMMENT = '// TODO(OPS-T1): author ResponseSchema';

/**
 * `defineRoute` is also added as a named import on the route file (per
 * TECH §2.4 Step A — `addImportDeclaration` is idempotent given the
 * existence guard below).
 */
const DEFINE_ROUTE_NAMED_IMPORT = 'defineRoute';

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Rewrite a single-method route handler to call `defineRoute(Schema, ...)`.
 *
 * @param sf      The route's source file. Mutated in place; caller is
 *                responsible for `sf.save()` (apply mode, Subtask 32.14).
 * @param method  The HTTP method name (`GET` / `POST` / ...). Must be one
 *                of the seven valid Next.js export names per TECH §8.3 —
 *                the caller's rewrite loop is expected to skip
 *                `maxDuration` / `dynamic` / `runtime` and any other
 *                non-method export.
 * @param schema  The inference result from Source A (or B/C, when wired).
 *                A `{ schema: '<IdentifierName>Schema' }` happy-path triggers
 *                a clean rewrite; a `{ schema: 'z.unknown()', reason:
 *                'NEEDS_SCHEMA' }` fall-back additionally inserts the TODO
 *                comment per AC-6.
 *
 * No return value — observable effect is the source-file mutation. The
 * caller asserts on `sf.getFullText()` (snapshot tests) or persists via
 * `sf.save()` (apply mode).
 *
 * Throws if no exported handler with the supplied method name is found —
 * the caller's classifier (32.6) already enumerates the methods, so a
 * mismatch here is a precondition violation, not a recoverable state.
 */
export function rewriteSingleMethod(
  sf: SourceFile,
  method: string,
  schema: InferSchemaResult,
): void {
  // Step A — idempotently add the defineRoute import. Per TECH §2.4 Step A
  // the check is on the module specifier; re-running the rewrite on a file
  // that already has the import is a no-op (the same guard covers Subtask
  // 32.13's idempotency contract for re-applies).
  ensureDefineRouteImport(sf);

  // Step B — locate the exported handler. Two AST forms are recognised:
  //   (1) FunctionDeclaration — `export async function METHOD(...)`
  //   (2) VariableStatement   — `export const METHOD = withRequestContext(
  //                              async (...) => { ... });`
  // Try the FunctionDeclaration form first because it is the dominant
  // shape per route-shape-inventory.md §3 (the +WRC sub-variant is a
  // minority of the 137 MECHANISABLE routes).
  const fnDecl = sf.getFunction(method);
  if (fnDecl && fnDecl.isExported()) {
    rewriteFunctionDeclarationForm(fnDecl, schema);
    return;
  }

  const varStmt = findExportedMethodVariableStatement(sf, method);
  if (varStmt) {
    rewriteWithRequestContextForm(varStmt, method, schema);
    return;
  }

  throw new Error(
    `[rewriteSingleMethod] no exported handler named '${method}' in ${sf.getFilePath()}`,
  );
}

// ── Step A — Import management ────────────────────────────────────────────

/**
 * Add `import { defineRoute } from '@/lib/api/define-route';` to the file if
 * no such import already exists.
 *
 * Implementation note: ts-morph emits double-quoted module specifiers from
 * `addImportDeclaration` by default. This matches the snapshot assertions in
 * `wrap-define-route.test.ts`. If a future Prettier pass re-quotes them to
 * single quotes (the project's Prettier config), the test snapshots and the
 * production output flip together — Subtask 32.14's format pass runs
 * `bun run format` after `sf.save()` to normalise.
 */
function ensureDefineRouteImport(sf: SourceFile): void {
  const existing = sf.getImportDeclaration(
    (decl) => decl.getModuleSpecifierValue() === DEFINE_ROUTE_MODULE_SPECIFIER,
  );
  if (existing) return;

  sf.addImportDeclaration({
    moduleSpecifier: DEFINE_ROUTE_MODULE_SPECIFIER,
    namedImports: [DEFINE_ROUTE_NAMED_IMPORT],
  });
}

// ── Step B — FunctionDeclaration form ─────────────────────────────────────

/**
 * Rewrite `export async function METHOD(args) { body }` →
 * `export const METHOD = defineRoute(Schema, async (args) => { body });`.
 *
 * Preserves:
 *   - The verbatim parameter list (TECH §8.2 — Promise<params> is the
 *     78-of-92 majority pattern).
 *   - The verbatim body text (no AST traversal of the body; the body is
 *     copied as-is including all comments, control flow, and inner
 *     declarations).
 *
 * Drops:
 *   - The `async` keyword on the FunctionDeclaration — re-emitted on the
 *     arrow inside `defineRoute(...)`.
 *   - The `function METHOD` declaration form — replaced by the
 *     `export const METHOD = ...` binding.
 */
function rewriteFunctionDeclarationForm(
  fnDecl: ReturnType<SourceFile['getFunctionOrThrow']>,
  schema: InferSchemaResult,
): void {
  const name = fnDecl.getName();
  if (!name) {
    throw new Error(
      `[rewriteSingleMethod] anonymous FunctionDeclaration cannot be rewritten`,
    );
  }
  const body = fnDecl.getBodyOrThrow().getText();
  const params = fnDecl
    .getParameters()
    .map((p) => p.getText())
    .join(', ');

  const replacement = buildExportConstReplacement({
    method: name,
    params,
    body,
    schema,
  });
  fnDecl.replaceWithText(replacement);
}

// ── Step B — VariableStatement (+WRC) form ────────────────────────────────

/**
 * Locate the `export const METHOD = ...` VariableStatement for the supplied
 * method, or return `null` if no such binding exists.
 *
 * `export const maxDuration / dynamic / runtime` are filtered out by the
 * method-name match — the caller's rewrite loop should never invoke this
 * with a non-method name, but the guard here is defensive (TECH §8.3).
 */
function findExportedMethodVariableStatement(
  sf: SourceFile,
  method: string,
): ReturnType<SourceFile['getVariableStatement']> | null {
  for (const stmt of sf.getVariableStatements()) {
    if (!stmt.isExported()) continue;
    const hit = stmt.getDeclarations().some((d) => d.getName() === method);
    if (hit) return stmt;
  }
  return null;
}

/**
 * Rewrite the +WRC variant in place — `export const METHOD =
 * withRequestContext(async (args) => { body });` →
 * `export const METHOD = withRequestContext(defineRoute(Schema, async (args)
 * => { body }));`.
 *
 * AC-7 / TECH §8.1: `withRequestContext` MUST remain the outermost
 * wrapper. The implementation surgically replaces the inner argument of
 * the `withRequestContext(...)` CallExpression with
 * `defineRoute(Schema, <inner>)`, leaving the outer call expression
 * untouched.
 *
 * If the initialiser is NOT a `withRequestContext(...)` call (e.g. the
 * route uses `export const METHOD = async (req) => { ... }` without a WRC
 * wrapper — uncommon but technically valid Next.js export), this falls
 * through to a TODO-emit branch in a future revision; for now Subtask
 * 32.10 only supports the FunctionDeclaration and WRC-wrapped forms. A
 * fall-through error surfaces the gap to the caller.
 *
 * For NEEDS_SCHEMA inference results, the TODO comment is placed on the
 * line preceding the entire `export const METHOD = ...` statement — the
 * developer reviewing the diff sees the placeholder immediately above the
 * outer wrapper, where it is unambiguous which schema slot needs
 * authoring.
 */
function rewriteWithRequestContextForm(
  varStmt: NonNullable<ReturnType<SourceFile['getVariableStatement']>>,
  method: string,
  schema: InferSchemaResult,
): void {
  const decl = varStmt.getDeclarations().find((d) => d.getName() === method);
  if (!decl) {
    throw new Error(
      `[rewriteSingleMethod] no declaration named '${method}' in VariableStatement`,
    );
  }
  const initialiser = decl.getInitializer();
  if (!initialiser || initialiser.getKind() !== SyntaxKind.CallExpression) {
    throw new Error(
      `[rewriteSingleMethod] expected withRequestContext(...) CallExpression initialiser for '${method}', got ${initialiser?.getKindName() ?? 'undefined'}`,
    );
  }
  const callExpr = initialiser.asKindOrThrow(SyntaxKind.CallExpression);
  const callee = callExpr.getExpression();
  if (callee.getText() !== 'withRequestContext') {
    throw new Error(
      `[rewriteSingleMethod] expected withRequestContext outer wrapper for '${method}', got '${callee.getText()}'`,
    );
  }
  const args = callExpr.getArguments();
  if (args.length !== 1) {
    throw new Error(
      `[rewriteSingleMethod] expected exactly one argument to withRequestContext for '${method}', got ${args.length}`,
    );
  }
  const innerArg = args[0]!;
  const innerText = innerArg.getText();

  // Surgical inner-replace — withRequestContext(...) outer wrapper stays put.
  innerArg.replaceWithText(
    `${DEFINE_ROUTE_NAMED_IMPORT}(${schema.schema}, ${innerText})`,
  );

  // AC-6 TODO comment placement for NEEDS_SCHEMA fall-back. The comment
  // sits on the line preceding the outer `export const METHOD = ...`
  // statement so the developer sees the placeholder above the entire
  // wrapper expression, where the schema slot is unambiguous.
  if (isNeedsSchema(schema)) {
    prependLeadingComment(varStmt, NEEDS_SCHEMA_TODO_COMMENT);
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────

/**
 * Build the `export const METHOD = defineRoute(Schema, async (params) =>
 * body);` replacement text for the FunctionDeclaration form.
 *
 * The `// TODO(OPS-T1): author ResponseSchema` comment is prepended inline
 * (not via a separate AST mutation) so the `fnDecl.replaceWithText()` call
 * emits the comment and the export as a single contiguous block, avoiding
 * a second AST traversal.
 */
function buildExportConstReplacement(opts: {
  method: string;
  params: string;
  body: string;
  schema: InferSchemaResult;
}): string {
  const { method, params, body, schema } = opts;
  const exportStmt = `export const ${method} = ${DEFINE_ROUTE_NAMED_IMPORT}(${schema.schema}, async (${params}) => ${body});`;
  if (isNeedsSchema(schema)) {
    return `${NEEDS_SCHEMA_TODO_COMMENT}\n${exportStmt}`;
  }
  return exportStmt;
}

/**
 * `true` when the inference result is the NEEDS_SCHEMA fall-back per
 * `InferSchemaResult` (AC-6 condition). Narrows the discriminated union
 * for the TODO-comment branches above.
 */
function isNeedsSchema(
  schema: InferSchemaResult,
): schema is { schema: 'z.unknown()'; reason: 'NEEDS_SCHEMA' } {
  return schema.reason === 'NEEDS_SCHEMA';
}

/**
 * Prepend a leading single-line comment to a Statement (here a
 * VariableStatement). ts-morph exposes `addJsDoc()` but no first-class
 * line-comment API for statements; the analogous mutation is a
 * `replaceWithText` that prepends the comment to the statement's current
 * text. Source position semantics: the inserted text sits on the line
 * preceding the statement, matching the AC-6 requirement ("on the
 * preceding line").
 */
function prependLeadingComment(
  stmt: NonNullable<ReturnType<SourceFile['getVariableStatement']>>,
  comment: string,
): void {
  stmt.replaceWithText(`${comment}\n${stmt.getText()}`);
}
