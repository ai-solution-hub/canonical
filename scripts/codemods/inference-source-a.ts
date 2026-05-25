/**
 * `inference-source-a.ts` — ResponseSchema inference for the `wrap-define-route`
 * codemod, Source A.
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §3.A
 *     ("Source A — type-drift-baseline.json")
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md AC-5, AC-6
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PLAN.md §4 Subtask 32.8
 *
 * Scope (Subtask 32.8): Source A only. Reads
 * `docs/generated/type-drift-baseline.json`; for each baseline entry, maps
 * the interface name to its route file via the heuristic URL matcher
 * (equivalent to `urlToRoutePath` + `routePathMatches` in
 * `lib/ast-dataflow/queries/type-drift-detect.ts` — that file is the
 * canonical type-drift detector and MUST NOT be modified); looks up
 * `${interfaceName}Schema` or `${interfaceName}ZodSchema` in
 * `lib/validation/schemas.ts` via name convention; returns the schema
 * identifier or falls back to `z.unknown()` + `NEEDS_SCHEMA` reason.
 *
 * Source B (return-type annotation) and Source C (return-statement walk)
 * are owned by Subtasks 32.9 and post-32 backlog respectively — this module
 * has no awareness of either.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Project, SourceFile } from 'ts-morph';
import { SyntaxKind } from 'ts-morph';
import type { NeedsManualReason } from './types';

// ── Public types ──────────────────────────────────────────────────────────

/**
 * One entry in `docs/generated/type-drift-baseline.json` per the R-WP17
 * shape. Forward-compatible with optional extra fields the baseline may
 * carry (e.g. `line`, `bucket`) — those are ignored by Source A logic.
 */
export interface BaselineEntry {
  interface: string;
  declaredAt: { file: string; line?: number };
}

/**
 * Result of a Source A inference attempt.
 *
 * Happy path: `{ schema: '<IdentifierName>Schema' }`. The identifier is
 * emitted verbatim into the generated `defineRoute(<schema>, handler)`
 * call by Subtask 32.10's rewrite emitter.
 *
 * Fall-back: `{ schema: 'z.unknown()', reason: 'NEEDS_SCHEMA' }`. Subtask
 * 32.12's `codemod-needs-manual.json` emitter consumes the `reason` code
 * and the route file path to produce the developer-facing report.
 */
export type InferSchemaResult =
  | { schema: string; reason?: undefined }
  | {
      schema: 'z.unknown()';
      reason: Extract<NeedsManualReason, 'NEEDS_SCHEMA'>;
    };

/**
 * Injection points for the test harness. In production the baseline is
 * loaded from disk and the lookup paths default to the canonical
 * `lib/query/fetchers.ts` + `lib/validation/schemas.ts`. The test harness
 * supplies a synthetic baseline and uses an in-memory `Project` that
 * already contains the lookup files at those canonical paths.
 */
export interface InferSchemaOptions {
  /** Pre-loaded baseline entries. If omitted, loaded from
   *  `docs/generated/type-drift-baseline.json` via `loadBaseline()`. */
  baseline?: BaselineEntry[];
  /** Path (POSIX) to the fetcher source file inside `project`. Defaults to
   *  the conventional location. */
  fetchersPath?: string;
  /** Path (POSIX) to the schemas registry inside `project`. Defaults to
   *  the conventional location. */
  schemasPath?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

/** Canonical schemas-registry path inside the ts-morph project. */
const DEFAULT_SCHEMAS_PATH = '/repo/lib/validation/schemas.ts';
/** Canonical fetcher source path inside the ts-morph project. */
const DEFAULT_FETCHERS_PATH = '/repo/lib/query/fetchers.ts';
/** Default on-disk baseline location, repo-relative. */
const DEFAULT_BASELINE_PATH = 'docs/generated/type-drift-baseline.json';

/** Placeholder returned when no `${interfaceName}Schema` constant is found. */
export const Z_UNKNOWN_PLACEHOLDER = 'z.unknown()';

// ── Baseline loading ──────────────────────────────────────────────────────

/**
 * Load and parse `docs/generated/type-drift-baseline.json` from disk.
 *
 * Resolves `path` against `process.cwd()`; tests inject the array directly
 * via `InferSchemaOptions.baseline` rather than touching the on-disk file.
 *
 * Throws if the file is missing or malformed — Source A inference cannot
 * function without the baseline.
 */
export function loadBaseline(path = DEFAULT_BASELINE_PATH): BaselineEntry[] {
  const resolved = resolve(process.cwd(), path);
  const raw = readFileSync(resolved, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `[inference-source-a] baseline at ${resolved} is not an array`,
    );
  }
  return parsed as BaselineEntry[];
}

// ── Route-path ⇄ URL mapping ──────────────────────────────────────────────

/**
 * Translate a route file's POSIX path (`app/api/review/stats/route.ts`) to
 * its candidate URL pattern (`/api/review/stats`).
 *
 * Path segments that are dynamic Next.js placeholders (`[id]`,
 * `[...slug]`, `[[...catchAll]]`) are preserved literally so the matcher
 * can wildcard-compare against fetcher URLs containing template-literal
 * substitutions.
 *
 * This is the inverse of `urlToRoutePath` in
 * `lib/ast-dataflow/queries/type-drift-detect.ts`; the two functions
 * together form the heuristic URL matcher's round-trip.
 */
export function routePathToCandidateUrl(routeRelPath: string): string {
  const posix = routeRelPath.replace(/\\/g, '/');
  // Strip leading `/repo/` prefix used by in-memory test projects, then any
  // remaining leading slash, then strip the trailing `/route.ts`.
  const trimmed = posix
    .replace(/^\/repo\//, '')
    .replace(/^app\//, '')
    .replace(/\/route\.ts$/, '');
  return `/${trimmed}`;
}

/**
 * Check whether a fetcher URL matches a route's candidate URL, treating
 * Next.js dynamic segments (`[id]`, `[...slug]`) AND template-literal
 * substitutions (`${id}`) as wildcards.
 *
 * The matcher is segment-aligned: a URL with N segments only matches a
 * route with N segments. This avoids accidental cross-route binding when
 * one route is a prefix of another (e.g. `/api/items` vs `/api/items/[id]`).
 */
export function routeUrlMatches(
  candidateRouteUrl: string,
  fetcherUrl: string,
): boolean {
  const normalise = (u: string) => u.replace(/[?#].*$/, '').replace(/\/$/, '');
  const route = normalise(candidateRouteUrl);
  const fetcher = normalise(fetcherUrl);
  const routeParts = route.split('/');
  const fetcherParts = fetcher.split('/');
  if (routeParts.length !== fetcherParts.length) return false;
  return routeParts.every((rp, i) => {
    const fp = fetcherParts[i];
    if (rp === undefined || fp === undefined) return false;
    // Route side: a Next.js dynamic segment is a wildcard.
    if (rp.startsWith('[') && rp.endsWith(']')) return true;
    // Fetcher side: a template-literal substitution prefix is a wildcard.
    if (fp.includes('${')) return true;
    return rp === fp;
  });
}

// ── Fetcher-corpus walk ──────────────────────────────────────────────────

/**
 * Walk the fetcher source file in `project` and collect every
 * `fetchJson<T>(url)` call site as a `{ typeArg, url }` pair.
 *
 * The walk is intentionally narrow: only the conventional fetchers
 * registry (`lib/query/fetchers.ts`) is inspected. Per CLAUDE.md "Data
 * fetching", TanStack Query keys + fetchers live there exclusively, so any
 * baseline interface that maps to a route has at least one call site in
 * that file. Tests inject a synthetic fetcher at the same path.
 *
 * Static URLs (string literals + no-substitute template literals) and
 * template-prefix URLs (the static portion before the first `${`) are
 * both extracted; computed/identifier URLs are skipped (the matcher has
 * nothing to bind against).
 */
function collectFetcherCalls(
  project: Project,
  fetchersPath: string,
): ReadonlyArray<{ typeArg: string; url: string }> {
  const fetcherSf = project.getSourceFile(fetchersPath);
  if (!fetcherSf) return [];

  const calls: { typeArg: string; url: string }[] = [];
  const callExprs = fetcherSf.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const callExpr of callExprs) {
    const expr = callExpr.getExpression();
    // Match `fetchJson<T>(url)` — identifier name `fetchJson`.
    if (expr.getKind() !== SyntaxKind.Identifier) continue;
    if (expr.getText() !== 'fetchJson') continue;

    const typeArgs = callExpr.getTypeArguments();
    if (typeArgs.length === 0) continue;

    // Type-arg may be the bare interface name (`fetchJson<X>`) or an
    // array of it (`fetchJson<X[]>`). Strip the trailing `[]` so the
    // baseline lookup uses the bare name.
    const rawTypeArg = typeArgs[0]?.getText() ?? '';
    const typeArg = rawTypeArg.replace(/\[\]$/, '');
    if (!typeArg) continue;

    const args = callExpr.getArguments();
    const firstArg = args[0];
    if (!firstArg) continue;

    let url: string | null = null;
    const argKind = firstArg.getKind();
    if (argKind === SyntaxKind.StringLiteral) {
      url = (
        firstArg as unknown as { getLiteralValue(): string }
      ).getLiteralValue();
    } else if (argKind === SyntaxKind.NoSubstitutionTemplateLiteral) {
      url = (
        firstArg as unknown as { getLiteralValue(): string }
      ).getLiteralValue();
    } else if (argKind === SyntaxKind.TemplateExpression) {
      // Extract the static prefix up to the first `${`.
      const text = firstArg.getText();
      const prefixMatch = text.match(/^`([^$`]*)/);
      url = prefixMatch ? (prefixMatch[1] ?? null) : null;
    }
    if (!url) continue;
    calls.push({ typeArg, url });
  }

  return calls;
}

// ── Schema-constant lookup ────────────────────────────────────────────────

/**
 * Search `lib/validation/schemas.ts` (or the path injected by tests) for
 * an exported `${interfaceName}Schema` or `${interfaceName}ZodSchema`
 * constant. Returns the matching identifier name, or `null` if neither
 * convention matches.
 *
 * Lookup honours the name-convention sequence from TECH §3.A:
 *   1. `${interfaceName}Schema` (preferred — matches the canonical
 *      `<X>Schema` convention used throughout `lib/validation/schemas.ts`).
 *   2. `${interfaceName}ZodSchema` (fallback — accommodates the
 *      occasional disambiguation suffix).
 */
export function findSchemaConstant(
  interfaceName: string,
  project: Project,
  schemasPath: string,
): string | null {
  const schemasSf = project.getSourceFile(schemasPath);
  if (!schemasSf) return null;

  const candidates = [`${interfaceName}Schema`, `${interfaceName}ZodSchema`];
  for (const candidate of candidates) {
    const exported = schemasSf
      .getVariableStatements()
      .filter((stmt) => stmt.isExported())
      .flatMap((stmt) => stmt.getDeclarations())
      .some((decl) => decl.getName() === candidate);
    if (exported) return candidate;
  }
  return null;
}

// ── Public entry point ────────────────────────────────────────────────────

/**
 * Infer the `ResponseSchema` argument for a route handler via Source A.
 *
 * Strategy (per TECH §3.A):
 *
 *   1. Convert the route file path to a candidate URL pattern.
 *   2. Walk `lib/query/fetchers.ts` for `fetchJson<T>(url)` calls whose
 *      URL matches the route's candidate URL.
 *   3. Filter the resulting `T` set against the baseline — only baseline
 *      interfaces are considered (per AC-5).
 *   4. For the first qualifying interface (deterministic order: fetcher
 *      walk order, which is source order):
 *      a. Look up `${T}Schema` or `${T}ZodSchema` in
 *         `lib/validation/schemas.ts`.
 *      b. If found, return that identifier.
 *      c. If not, return `z.unknown()` + `NEEDS_SCHEMA` (per AC-6 the
 *         32.12 emitter then adds the `// TODO(OPS-T1): author
 *         ResponseSchema` comment).
 *   5. If no qualifying interface is found (route not in baseline, or
 *      fetcher URL did not match), return the same fall-back so Sources B
 *      and C — owned by 32.9 / post-32 backlog — can attempt their own
 *      lookups via the downstream chain.
 *
 * `method` is currently unused by Source A (all baseline interfaces
 * correspond to GET-style fetcher reads), but kept on the signature so
 * Sources B / C can chain through the same `inferSchema(sf, method,
 * project)` call site in `wrap-define-route.ts` without breaking the API.
 */
export function inferSchemaSourceA(
  sf: SourceFile,
  _method: string,
  project: Project,
  options: InferSchemaOptions = {},
): InferSchemaResult {
  const baseline = options.baseline ?? loadBaseline();
  const fetchersPath = options.fetchersPath ?? DEFAULT_FETCHERS_PATH;
  const schemasPath = options.schemasPath ?? DEFAULT_SCHEMAS_PATH;

  const candidateUrl = routePathToCandidateUrl(sf.getFilePath());
  const fetcherCalls = collectFetcherCalls(project, fetchersPath);

  const baselineInterfaces = new Set(baseline.map((b) => b.interface));

  for (const { typeArg, url } of fetcherCalls) {
    if (!routeUrlMatches(candidateUrl, url)) continue;
    if (!baselineInterfaces.has(typeArg)) continue;

    const schemaConstant = findSchemaConstant(typeArg, project, schemasPath);
    if (schemaConstant) {
      return { schema: schemaConstant };
    }
    return { schema: Z_UNKNOWN_PLACEHOLDER, reason: 'NEEDS_SCHEMA' };
  }

  // No baseline binding for this route — fall-back per AC-6. Downstream
  // sources (32.9 / post-32 backlog) chain through the same `inferSchema`
  // contract in `wrap-define-route.ts`.
  return { schema: Z_UNKNOWN_PLACEHOLDER, reason: 'NEEDS_SCHEMA' };
}
