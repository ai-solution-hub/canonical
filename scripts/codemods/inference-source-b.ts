/**
 * `inference-source-b.ts` — ResponseSchema inference for the `wrap-define-route`
 * codemod, Source B.
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §3.B
 *     ("Source B — Existing return-type annotation on the handler")
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §3 (recommended
 *     ranking — Source B is optional, runs after Source A landed).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PLAN.md §4 Subtask 32.9.
 *
 * Scope (Subtask 32.9): Source B only — extracts the inner type argument of
 * a `Promise<NextResponse<X>>` return-type annotation on the handler
 * function declaration, then resolves `X` to its co-located Zod schema
 * (`${X}Schema` / `${X}ZodSchema`) via the same name-convention lookup as
 * Source A (`findSchemaConstant` re-used directly).
 *
 * Source B is the middle source in the inference ranking (§3 recommended
 * ranking): "It costs little (just reading an existing annotation) and may
 * close a handful of additional routes." Per R-WP17, only 2 `route-only`
 * routes in the current corpus carry the annotation, so Source B is a
 * narrow but high-confidence path — the developer explicitly stated the
 * return type, so the annotation supersedes Source A's heuristic URL
 * matcher.
 *
 * Two return shapes (consumed by `inferSchema` in `wrap-define-route.ts`):
 *
 *   1. `null`        — no annotation present. The chain falls through to
 *                      Source A (or whichever caller composes the chain).
 *
 *   2. `InferSchemaResult` (from Source A's module — re-used verbatim):
 *      - `{ schema: '<IdentifierName>Schema' }` — happy path.
 *      - `{ schema: 'z.unknown()', reason: 'NEEDS_SCHEMA' }` — annotation
 *        present but no co-located Zod schema. Symmetrical with Source A's
 *        fall-back so the chain caller does not need to disambiguate.
 *
 * Out of scope:
 *   - Source C (handler return-statement walk) — explicitly deferred per
 *     PLAN.md §4 Subtask 32.9 OQ-2 / TECH §3.C.
 *   - The chain composition itself — that lives in
 *     `wrap-define-route.ts`'s `inferSchema()` per the 32.9 brief's
 *     "extend `inferSchema()` ... to chain Source A → Source B".
 */

import type { Project, SourceFile, TypeNode } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import {
  findSchemaConstant,
  Z_UNKNOWN_PLACEHOLDER,
  type InferSchemaResult,
} from './inference-source-a';

// ── Constants (mirror Source A's defaults) ─────────────────────────────────

/** Canonical schemas-registry path inside the ts-morph project (mirrors
 *  Source A's `DEFAULT_SCHEMAS_PATH`). */
const DEFAULT_SCHEMAS_PATH = '/repo/lib/validation/schemas.ts';

// ── Public types ──────────────────────────────────────────────────────────

/**
 * Injection points for the test harness — symmetrical with Source A's
 * `InferSchemaOptions` for the subset of fields Source B consumes (Source B
 * does not need a baseline; it reads the return-type annotation directly).
 */
export interface InferSchemaSourceBOptions {
  /** Path (POSIX) to the schemas registry inside `project`. Defaults to
   *  the conventional location. */
  schemasPath?: string;
}

// ── Public entry point ────────────────────────────────────────────────────

/**
 * Infer the `ResponseSchema` argument for a route handler via Source B.
 *
 * Strategy (per TECH §3.B):
 *
 *   1. Locate the handler `FunctionDeclaration` matching `method` on the
 *      source file. If absent (no `export async function METHOD(...) { ... }`
 *      declaration with that name), return `null` — Source B has nothing
 *      to read.
 *   2. Inspect the function's return-type annotation. If the function has
 *      no explicit return type, return `null`.
 *   3. Run `extractNextResponseTypeArg` on the return-type node. The
 *      helper recognises:
 *        - `Promise<NextResponse<X>>`            (canonical Next.js 15 shape)
 *        - `NextResponse<X>`                     (non-async handler edge case)
 *      and returns the inner type identifier `X`. If the node does not
 *      conform, returns `null`.
 *   4. If `X` is extracted, look up `${X}Schema` or `${X}ZodSchema` in
 *      `lib/validation/schemas.ts` via `findSchemaConstant` (re-used from
 *      Source A so the name-convention semantics stay symmetrical).
 *      - If found, return `{ schema: '<X>Schema' }`.
 *      - If not, return `{ schema: 'z.unknown()', reason: 'NEEDS_SCHEMA' }`.
 *
 * The `method` parameter is consulted in step 1; Source B does not enumerate
 * all methods like Source A's fetcher walk does. Per the brief: "If handler
 * carries Promise<NextResponse<X>> return-type annotation, extract X" — the
 * extraction is per-handler, not per-route.
 *
 * `project` is required so that `findSchemaConstant` can resolve the
 * schemas-registry file inside the in-memory ts-morph project. The default
 * `DEFAULT_SCHEMAS_PATH` matches Source A's default; tests inject an
 * alternate path via `options.schemasPath`.
 */
export function inferSchemaSourceB(
  sf: SourceFile,
  method: string,
  project: Project,
  options: InferSchemaSourceBOptions = {},
): InferSchemaResult | null {
  const schemasPath = options.schemasPath ?? DEFAULT_SCHEMAS_PATH;

  // Step 1 — locate the handler function declaration.
  // Per TECH §3.B's sample (`export async function GET(): Promise<NextResponse<X>>`)
  // the annotation lives on a FunctionDeclaration. The `export const METHOD = ...`
  // variant (withRequestContext-wrapped handlers etc.) does NOT carry a
  // return-type annotation at the export site — the inner arrow body would,
  // but R-WP17's 2 annotated routes are all FunctionDeclarations. Scope
  // Source B to FunctionDeclaration only; the +WRC variants fall through to
  // Source A.
  const fnDecl = sf
    .getFunctions()
    .find(
      (fn) => fn.isExported() && fn.getName() === method,
    );
  if (!fnDecl) return null;

  // Step 2 — return-type annotation present?
  const returnTypeNode = fnDecl.getReturnTypeNode();
  if (!returnTypeNode) return null;

  // Step 3 — extract the inner type identifier (e.g. `ReviewQueueResponse`).
  const interfaceName = extractNextResponseTypeArg(returnTypeNode);
  if (!interfaceName) return null;

  // Step 4 — resolve `${interfaceName}Schema` via Source A's name-convention
  // lookup. Re-use `findSchemaConstant` so the semantics (preference for
  // `Schema` over `ZodSchema`) stay symmetrical with Source A.
  const schemaConstant = findSchemaConstant(interfaceName, project, schemasPath);
  if (schemaConstant) {
    return { schema: schemaConstant };
  }
  return { schema: Z_UNKNOWN_PLACEHOLDER, reason: 'NEEDS_SCHEMA' };
}

/**
 * Extract the inner type-argument identifier from a `Promise<NextResponse<X>>`
 * or `NextResponse<X>` return-type node. Returns the bare identifier text
 * (e.g. `ReviewQueueResponse`) or `null` if the node does not conform.
 *
 * Arrays (`NextResponse<X[]>`) and explicit `ReadonlyArray<X>` wrappers are
 * stripped to the element type — mirrors Source A's fetcher walk, where
 * `fetchJson<X[]>` is treated the same as `fetchJson<X>` for the name-
 * convention lookup. This keeps the Source B / Source A behaviour
 * symmetrical: the lookup target is always the bare interface name.
 *
 * Recognised shapes:
 *   - `Promise<NextResponse<X>>`          → `'X'`
 *   - `Promise<NextResponse<X[]>>`        → `'X'`
 *   - `Promise<NextResponse<ReadonlyArray<X>>>` → `'X'`
 *   - `NextResponse<X>`                   → `'X'`     (non-async edge case)
 *
 * Not recognised:
 *   - Plain `Promise<X>` without the `NextResponse<...>` middle layer.
 *   - Anonymous types: `Promise<NextResponse<{ id: string }>>` → `null`.
 *   - Computed type expressions: `Promise<NextResponse<ReturnType<typeof x>>>`
 *     → `null` (the type-checker could resolve these, but Source B sticks
 *     to syntactic extraction; the chain caller falls through to Source A).
 *
 * Exported alongside `inferSchemaSourceB` so the test harness can pin the
 * extraction contract independently of the schema-lookup contract — the
 * two are composable but separately verifiable.
 */
export function extractNextResponseTypeArg(
  returnTypeNode: TypeNode,
): string | null {
  // Drill from `Promise<NextResponse<X>>` to `NextResponse<X>` if the
  // outermost wrapper is a `Promise`. The non-async edge case (handler
  // returns `NextResponse<X>` directly) skips this step.
  const inner = unwrapPromise(returnTypeNode);
  if (!inner) return null;

  // Now the node should be `NextResponse<X>`. Match the `TypeReference`
  // form whose identifier is `NextResponse`.
  const typeRef = inner.asKind(SyntaxKind.TypeReference);
  if (!typeRef) return null;
  const refName = typeRef.getTypeName().getText();
  if (refName !== 'NextResponse') return null;

  // Extract the single type argument and unwrap any `[]` / `ReadonlyArray<T>`
  // wrapping. Multi-argument cases (`NextResponse<X, Y>`) are not part of
  // the Next.js API surface — `null` if we encounter one.
  const typeArgs = typeRef.getTypeArguments();
  if (typeArgs.length !== 1) return null;
  const arg = typeArgs[0];
  if (!arg) return null;

  const unwrapped = unwrapArrayType(arg);
  if (!unwrapped) return null;

  // The extracted node must be a bare TypeReference (e.g. `ReviewQueueResponse`).
  // Anonymous object types, intersections, unions, and computed expressions
  // are all rejected — Source B sticks to syntactic identifiers so the
  // downstream schema lookup has a deterministic target. The chain caller
  // falls through to Source A for the non-syntactic cases.
  const finalRef = unwrapped.asKind(SyntaxKind.TypeReference);
  if (!finalRef) return null;
  const finalName = finalRef.getTypeName();

  // The type-name node may be a plain `Identifier` or a `QualifiedName`
  // (e.g. `NS.X`). Source B accepts the bare identifier form only —
  // qualified names suggest a namespaced type that the schema registry
  // would not name-convention-match anyway.
  if (finalName.getKind() !== SyntaxKind.Identifier) return null;
  return finalName.getText();
}

// ── Private helpers ───────────────────────────────────────────────────────

/**
 * If `node` is a `TypeReference` of the form `Promise<X>`, return `X` as
 * the inner type node. Otherwise return `node` unchanged so callers can
 * handle the non-async edge case (`NextResponse<X>` without the Promise
 * wrapper) symmetrically.
 *
 * Returns `null` only when the node shape is so broken that even returning
 * it unchanged would mislead callers — currently unreachable, but kept on
 * the signature so future hardening can add the negative case without a
 * signature change.
 */
function unwrapPromise(node: TypeNode): TypeNode | null {
  const typeRef = node.asKind(SyntaxKind.TypeReference);
  if (!typeRef) return node;
  if (typeRef.getTypeName().getText() !== 'Promise') return node;
  const typeArgs = typeRef.getTypeArguments();
  if (typeArgs.length !== 1) return null;
  return typeArgs[0] ?? null;
}

/**
 * If `node` is `X[]` (ArrayType) or `ReadonlyArray<X>` (TypeReference)
 * return the element type `X`. Otherwise return `node` unchanged.
 *
 * Returns `null` when the array wrapping is malformed (multi-arg
 * `ReadonlyArray<X, Y>`, which is not a TypeScript-valid type).
 */
function unwrapArrayType(node: TypeNode): TypeNode | null {
  const arrayType = node.asKind(SyntaxKind.ArrayType);
  if (arrayType) {
    return arrayType.getElementTypeNode();
  }
  const typeRef = node.asKind(SyntaxKind.TypeReference);
  if (typeRef) {
    const name = typeRef.getTypeName().getText();
    if (name === 'ReadonlyArray' || name === 'Array') {
      const typeArgs = typeRef.getTypeArguments();
      if (typeArgs.length !== 1) return null;
      return typeArgs[0] ?? null;
    }
  }
  return node;
}
