/**
 * `inference-source-a.ts` — ResponseSchema inference for the `wrap-define-route`
 * codemod, Source A.
 *
 * Spec:
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/TECH.md §3.A
 *     ("Source A — type-drift-baseline.json")
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PRODUCT.md AC-5, AC-6
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PLAN.md §4 Subtask 32.8
 *
 * Scope (Subtask 32.8): Source A only. Reads
 * `.type-drift-baseline.json` (repo root); for each baseline entry, maps
 * the interface name to its route file via the heuristic URL matcher
 * (equivalent to `urlToRoutePath` + `routePathMatches` in
 * `tools/ast-dataflow/queries/type-drift-detect.ts` — that file is the
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
 * One entry in `.type-drift-baseline.json` (repo root) per the R-WP17
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
   *  `.type-drift-baseline.json` (repo root) via `loadBaseline()`. */
  baseline?: BaselineEntry[];
  /**
   * Retained for back-compat with pre-32.21 callers. The fetcher walk is now
   * driven by a path-pattern file-set (`hooks/**`, `components/**`,
   * `lib/query/**` — see `collectFetcherCalls`) rather than a single injected
   * file, so this value is NO LONGER consulted. Left on the type so existing
   * call sites that pass it keep compiling.
   */
  fetchersPath?: string;
  /** Path (POSIX) to the schemas registry inside `project`. Defaults to
   *  the conventional location. */
  schemasPath?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Conventional repo-relative suffix of the schemas registry. Used to locate
 * the file inside the ts-morph project when no `schemasPath` is injected —
 * see `resolveLookupPath`. NOT a literal absolute path: the in-memory test
 * harness mounts the file at `/repo/lib/validation/schemas.ts` while the real
 * disk-loaded project mounts it at `<projectRoot>/lib/validation/schemas.ts`,
 * and both end with this suffix.
 */
const SCHEMAS_PATH_SUFFIX = 'lib/validation/schemas.ts';
/** Default on-disk baseline location, repo-relative. */
const DEFAULT_BASELINE_PATH = '.type-drift-baseline.json';

/** Placeholder returned when no `${interfaceName}Schema` constant is found. */
export const Z_UNKNOWN_PLACEHOLDER = 'z.unknown()';

// ── Baseline loading ──────────────────────────────────────────────────────

/**
 * Load and parse `.type-drift-baseline.json` (repo root) from disk.
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

// ── Project-relative lookup-path resolution ───────────────────────────────

/**
 * Resolve the in-project path of a lookup file (schemas registry / fetcher
 * source) for the NO-OPTIONS (production) default path.
 *
 * Why not a literal default: a disk-loaded ts-morph `Project`
 * (`createCodemodProject()`) reports file paths anchored on the real project
 * root (e.g. `/Users/.../knowledge-hub/lib/validation/schemas.ts`), while the
 * in-memory test harness mounts the same file at `/repo/lib/validation/schemas.ts`.
 * A single literal default cannot satisfy both. Instead we find the source
 * file whose POSIX path ENDS WITH the conventional repo-relative suffix —
 * which is unambiguous in both project styles (only one such file exists per
 * suffix in the corpus).
 *
 * `getSourceFile` accepts a predicate, so we match on the path suffix and
 * return the file's actual in-project path. Returns `null` when the file is
 * absent (the caller's `getSourceFile(path)` then yields no source file and
 * the lookup degrades gracefully to the `z.unknown()` fall-back).
 *
 * Callers that DO inject an explicit `schemasPath` (the in-memory 32.8 /
 * 32.20 harnesses and any production caller that wants to pin the path)
 * bypass this helper entirely — see `inferSchemaSourceA`.
 */
function resolveLookupPath(project: Project, suffix: string): string | null {
  const match = project.getSourceFile((sf) =>
    sf.getFilePath().replace(/\\/g, '/').endsWith(`/${suffix}`),
  );
  return match ? match.getFilePath() : null;
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
 * `tools/ast-dataflow/queries/type-drift-detect.ts`; the two functions
 * together form the heuristic URL matcher's round-trip.
 */
export function routePathToCandidateUrl(routeRelPath: string): string {
  const posix = routeRelPath.replace(/\\/g, '/');
  // Anchor the derivation on the FIRST `/app/` boundary so both path styles
  // collapse to the same `api/...` tail:
  //   - in-memory test projects   `/repo/app/api/review/queue/route.ts`
  //   - real absolute on-disk     `/Users/.../knowledge-hub/app/api/review/queue/route.ts`
  // both yield `api/review/queue`. The non-greedy `^.*?\/app\/` consumes
  // everything up to and including the first `/app/` segment; the trailing
  // `/route.ts` is then stripped. Dynamic Next.js segments (`[id]`,
  // `[...slug]`, `[[...catchAll]]`) are left untouched so the matcher can still
  // wildcard-compare them, preserving the round-trip contract with
  // `urlToRoutePath` documented above. A path with no `/app/` boundary falls
  // back to the bare trailing-`/route.ts` strip plus leading-slash trim.
  const trimmed = posix
    .replace(/^.*?\/app\//, '')
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
  const route = normaliseUrl(candidateRouteUrl);
  const fetcher = normaliseUrl(fetcherUrl);
  const routeParts = route.split('/');
  const fetcherParts = fetcher.split('/');
  if (routeParts.length !== fetcherParts.length) return false;
  return routeParts.every((rp, i) => {
    const fp = fetcherParts[i];
    if (rp === undefined || fp === undefined) return false;
    // Route side: a Next.js dynamic segment is a wildcard.
    if (isRouteWildcard(rp)) return true;
    // Fetcher side: a template-literal substitution prefix is a wildcard.
    if (isFetcherWildcard(fp)) return true;
    return rp === fp;
  });
}

/** Strip query/hash and a trailing slash so segment counts align. */
function normaliseUrl(u: string): string {
  return u.replace(/[?#].*$/, '').replace(/\/$/, '');
}

/** A Next.js dynamic route segment (`[id]`, `[...slug]`, `[[...c]]`). */
function isRouteWildcard(segment: string): boolean {
  return segment.startsWith('[') && segment.endsWith(']');
}

/** A fetcher URL segment carrying a template-literal substitution. */
function isFetcherWildcard(segment: string): boolean {
  return segment.includes('${');
}

/**
 * Specificity score for a (route, fetcher) segment alignment — higher is a
 * more confident match. Used to break ties when the broadened walk surfaces
 * more than one baseline fetcher URL matching the same route (Subtask 32.21).
 *
 * Per the dispatch brief: on a tie between a literal-segment match and a
 * wildcard match, PREFER the literal-segment route. The score encodes that
 * preference transitively across all segments:
 *   - literal == literal      → +2  (strongest: both sides concrete + equal)
 *   - route `[x]` ↔ fetcher `${}`  → +1  (aligned wildcard — same dynamic slot)
 *   - route literal ↔ fetcher `${}` → +1  (fetcher fills a concrete route seg)
 *   - route `[x]` ↔ fetcher literal → 0   (route wildcard merely ABSORBS a
 *                                          sibling literal fetcher — weakest;
 *                                          this is how `/content-dedup/[id]`
 *                                          spuriously matches the `/queue`
 *                                          and `/near-duplicates` fetchers)
 *
 * A non-matching concrete-vs-concrete pair returns `NO_MATCH` (the caller
 * only scores pairs that already passed `routeUrlMatches`, so this guards
 * against a logic drift between the two functions).
 */
const NO_MATCH = Number.NEGATIVE_INFINITY;
function matchSpecificity(
  candidateRouteUrl: string,
  fetcherUrl: string,
): number {
  const routeParts = normaliseUrl(candidateRouteUrl).split('/');
  const fetcherParts = normaliseUrl(fetcherUrl).split('/');
  if (routeParts.length !== fetcherParts.length) return NO_MATCH;

  let score = 0;
  for (let i = 0; i < routeParts.length; i += 1) {
    const rp = routeParts[i] ?? '';
    const fp = fetcherParts[i] ?? '';
    const rWild = isRouteWildcard(rp);
    const fWild = isFetcherWildcard(fp);
    if (!rWild && !fWild) {
      if (rp !== fp) return NO_MATCH;
      score += 2;
    } else if (rWild && fWild) {
      score += 1; // aligned wildcard
    } else if (rWild && !fWild) {
      score += 0; // route wildcard absorbs a concrete fetcher literal (weak)
    } else {
      score += 1; // fetcher wildcard fills a concrete route segment
    }
  }
  return score;
}

// ── Schema-expression shaping ─────────────────────────────────────────────

/**
 * Build the schema EXPRESSION a matched fetcher call binds to. A scalar
 * `fetchJson<X>` yields the bare `XSchema` identifier; an array
 * `fetchJson<X[]>` yields `z.array(XSchema)` so the rewriter emits
 * `defineRoute(z.array(XSchema), handler)`. `InferSchemaResult.schema` is an
 * expression string, so both forms are valid verbatim.
 */
function schemaExpression(schemaConstant: string, isArray: boolean): string {
  return isArray ? `z.array(${schemaConstant})` : schemaConstant;
}

// ── Fetcher-corpus walk ──────────────────────────────────────────────────

/**
 * The fetch KIND a harvested call site represents (Subtask 32.22).
 *
 * - `read`  — `fetchJson<T>(url)`, the GET-style read helper. Bound when the
 *             route is being inferred for a `GET`/`HEAD` method.
 * - `write` — `mutationFetchJson<T>(url, body, …)`, the POST/PATCH/etc helper
 *             from `lib/query/fetchers.ts`. Bound when the route is being
 *             inferred for a `POST`/`PUT`/`PATCH`/`DELETE` method.
 *
 * The KIND is the discriminator that makes binding HTTP-method-aware: a route
 * may export BOTH a GET (`fetchJson<GetT>`) and a write method
 * (`mutationFetchJson<PostT>`) at the same URL, and they must bind DIFFERENT
 * schemas per method (see `inferSchemaSourceA`).
 */
type FetchKind = 'read' | 'write';

/**
 * One `fetchJson<T>(url)` / `mutationFetchJson<T>(url, …)` call site harvested
 * from the corpus walk.
 *
 * `typeArg` is the BARE baseline-candidate interface name — the trailing
 * `[]` / `Array<…>` wrapper (if any) is stripped and recorded separately
 * in `isArray`. `isArray` drives the schema-expression shape at bind time:
 * a `fetchJson<X[]>` site infers `z.array(XSchema)`, a scalar `fetchJson<X>`
 * infers the bare `XSchema`.
 */
interface FetcherCall {
  /** Bare interface name (array/readonly wrappers stripped). */
  typeArg: string;
  /** `true` when the type arg was `X[]` / `readonly X[]` / `Array<X>`. */
  isArray: boolean;
  /**
   * The URL path the fetch targets. String/no-substitution literals yield
   * their literal value; template literals retain `${…}` PATH substitutions
   * verbatim (treated as wildcards by `routeUrlMatches`) but drop any query
   * string — see `extractFetchUrl`.
   */
  url: string;
  /**
   * Whether this is a read (`fetchJson`) or write (`mutationFetchJson`) call.
   * Drives method-aware filtering in `inferSchemaSourceA` (Subtask 32.22).
   */
  kind: FetchKind;
}

/**
 * The broad file-set the corpus walk scans for `fetchJson<T>(url)` sites
 * (Subtask 32.21). The original Source-A walk inspected ONLY the central
 * `lib/query/fetchers.ts`; the ~30 still-unbound baseline interfaces are
 * fetched via `fetchJson<T>(url)` INSIDE hooks/components (e.g.
 * `hooks/intelligence/use-company-profiles.ts`), so the narrow walk never
 * reached them. We broaden to the three file-classes that carry static-URL
 * `fetchJson` reads:
 *   - `hooks/**\/*.ts(x)`      — the dominant location for hook-fetched reads.
 *   - `components/**\/*.tsx`   — a handful of components fetch inline.
 *   - `lib/query/**\/*.ts`     — the original `fetchers.ts` registry (kept).
 *
 * Tests / `__tests__` files are excluded so synthetic fetch fixtures never
 * leak into the production bind set. The in-memory 32.8 / 32.20 harness
 * mounts its synthetic fetcher at `lib/query/fetchers.ts`, which this
 * predicate still matches — so the broadening is backward-compatible.
 */
function isFetchWalkFile(sf: SourceFile): boolean {
  const p = sf.getFilePath().replace(/\\/g, '/');
  if (p.includes('/node_modules/')) return false;
  if (p.includes('/__tests__/')) return false;
  return (
    /\/hooks\/[^?]*\.tsx?$/.test(p) ||
    /\/components\/[^?]*\.tsx$/.test(p) ||
    /\/lib\/query\/[^?]*\.ts$/.test(p)
  );
}

/**
 * Extract the bind-relevant URL path from a `fetchJson` first argument.
 *
 * - `StringLiteral` / `NoSubstitutionTemplateLiteral` → the literal value.
 * - `TemplateExpression` → the path portion of the template, preserving
 *   PATH-position `${…}` substitutions (wildcards for `routeUrlMatches`) but
 *   cutting at the query string. The query boundary is the FIRST of either a
 *   literal `?` OR a `${…}` group whose contents include `?` — the latter
 *   covers the `…${qs ? `?${qs}` : ''}` query-suffix idiom used throughout
 *   `lib/query/fetchers.ts`. Without that cut the query-suffix `${…}` would
 *   be misread as a path wildcard, collapsing a literal segment
 *   (`/content-dedup/queue${…}`) into a spurious wildcard that collides with
 *   sibling routes (the `[id]`-vs-`/queue` collision the B2 work surfaced).
 * - Anything else (computed/identifier URL) → `null` (nothing to bind).
 *
 * Returns `null` when no usable path can be derived.
 */
function extractFetchUrl(firstArg: {
  getKind(): SyntaxKind;
  getText(): string;
  getLiteralValue?: () => string;
}): string | null {
  const argKind = firstArg.getKind();
  if (
    argKind === SyntaxKind.StringLiteral ||
    argKind === SyntaxKind.NoSubstitutionTemplateLiteral
  ) {
    return (
      firstArg as unknown as { getLiteralValue(): string }
    ).getLiteralValue();
  }
  if (argKind !== SyntaxKind.TemplateExpression) return null;

  const text = firstArg.getText();
  if (!text.startsWith('`') || !text.endsWith('`')) return null;
  const body = text.slice(1, -1);

  let out = '';
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '?') break; // literal query-string boundary
    if (ch === '$' && body[i + 1] === '{') {
      // Capture the `${…}` group with brace-depth tracking (handles the
      // nested template in `${qs ? `?${qs}` : ''}`).
      let depth = 0;
      let group = '';
      let j = i;
      for (; j < body.length; j += 1) {
        const c = body[j] ?? '';
        group += c;
        if (c === '{') depth += 1;
        else if (c === '}') {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
      }
      if (group.includes('?')) break; // query-suffix template — drop the rest
      out += group; // genuine path-position wildcard — keep verbatim
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out.length > 0 ? out : null;
}

/**
 * Split a `fetchJson<…>` type-argument into its bare interface name and an
 * `isArray` flag, recognising the three array forms the corpus uses:
 * `X[]`, `readonly X[]`, and `Array<X>`. Returns `null` for an empty arg.
 */
function parseTypeArg(
  rawTypeArg: string,
): { name: string; isArray: boolean } | null {
  const trimmed = rawTypeArg.trim();
  if (!trimmed) return null;

  const suffixMatch = trimmed.match(/^(?:readonly\s+)?(.+?)\[\]$/);
  if (suffixMatch?.[1]) {
    return { name: suffixMatch[1].trim(), isArray: true };
  }
  const genericMatch = trimmed.match(/^(?:readonly\s+)?Array<(.+)>$/);
  if (genericMatch?.[1]) {
    return { name: genericMatch[1].trim(), isArray: true };
  }
  return { name: trimmed, isArray: false };
}

/**
 * Per-project memoisation of the broad fetcher walk. The walk result is
 * invariant for a given `Project` (it depends only on the project's source
 * files, not on the route being inferred), but `inferSchemaSourceA` runs once
 * per route — re-walking the entire `hooks/**` + `components/**` +
 * `lib/query/**` file-set for each of ~195 routes is O(routes × files) and
 * dominates runtime. Caching keyed on the `Project` identity collapses it to a
 * single walk. A `WeakMap` lets the cache entry be reclaimed when the project
 * is GC'd, so long-lived test runs that build many in-memory projects do not
 * leak.
 */
const fetcherCallCache = new WeakMap<Project, readonly FetcherCall[]>();

/**
 * Maps a fetch-helper identifier to its `FetchKind`. Both helpers live in
 * `lib/query/fetchers.ts` and take the target URL as their FIRST argument,
 * so the same `extractFetchUrl` + `parseTypeArg` logic applies to each — only
 * the KIND tag differs (Subtask 32.22).
 */
const FETCH_HELPER_KIND: Readonly<Record<string, FetchKind>> = {
  fetchJson: 'read',
  mutationFetchJson: 'write',
};

/**
 * Walk the broad fetch file-set in `project` (see `isFetchWalkFile`) and
 * collect every `fetchJson<T>(url)` and `mutationFetchJson<T>(url, …)` call
 * site as a `FetcherCall`. Memoised per `Project` via `fetcherCallCache`.
 *
 * Subtask 32.21 broadened this from the single `lib/query/fetchers.ts`
 * file to `hooks/**`, `components/**`, and `lib/query/**`, reusing the
 * SAME static-URL extraction (`extractFetchUrl`) and type-arg parsing
 * (`parseTypeArg`). Per CLAUDE.md "Data fetching" the central registry is
 * still the dominant source, but ~30 baseline interfaces are fetched via
 * `fetchJson<T>(url)` inside hooks/components and were previously
 * unreachable. The baseline filter applied downstream (per AC-5) keeps
 * non-baseline reads out of the bind set.
 *
 * Subtask 32.22 extends the walk to `mutationFetchJson<T>(url, …)` write-side
 * call sites. `mutationFetchJson` shares `fetchJson`'s first-argument-is-URL
 * shape, so the same URL/type-arg extraction is reused; each collected call is
 * tagged with its `kind` (`read` for `fetchJson`, `write` for
 * `mutationFetchJson`) so `inferSchemaSourceA` can match method-appropriately.
 * The 15 write-response baseline interfaces (`MutationResult`,
 * `ChangeReportGenerateResponse`, `CreateFeedSourceResponse`, …) are fetched
 * EXCLUSIVELY via `mutationFetchJson`, so this is what makes them bindable.
 */
function collectFetcherCalls(project: Project): readonly FetcherCall[] {
  const cached = fetcherCallCache.get(project);
  if (cached) return cached;

  const calls: FetcherCall[] = [];

  for (const sf of project.getSourceFiles()) {
    if (!isFetchWalkFile(sf)) continue;

    for (const callExpr of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = callExpr.getExpression();
      // Match `fetchJson<T>(url)` / `mutationFetchJson<T>(url, …)` — both are
      // plain identifier callees with the URL as the FIRST argument.
      if (expr.getKind() !== SyntaxKind.Identifier) continue;
      const kind = FETCH_HELPER_KIND[expr.getText()];
      if (!kind) continue;

      const typeArgs = callExpr.getTypeArguments();
      if (typeArgs.length === 0) continue;

      const parsed = parseTypeArg(typeArgs[0]?.getText() ?? '');
      if (!parsed) continue;

      const firstArg = callExpr.getArguments()[0];
      if (!firstArg) continue;

      const url = extractFetchUrl(firstArg);
      if (!url) continue;

      calls.push({ typeArg: parsed.name, isArray: parsed.isArray, url, kind });
    }
  }

  fetcherCallCache.set(project, calls);
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

/**
 * Confirm an EXACT exported constant name exists in the schemas registry.
 *
 * Unlike `findSchemaConstant` (which appends the `Schema`/`ZodSchema` name
 * convention to an interface name), this checks for the verbatim identifier —
 * used by the defect-B5 override (Subtask 32.28), whose entries already name
 * the full schema constant. Returns the name when exported, else `null` so a
 * stale override degrades to the `z.unknown()` fall-back.
 */
export function findExactSchemaConstant(
  constantName: string,
  project: Project,
  schemasPath: string,
): string | null {
  const schemasSf = project.getSourceFile(schemasPath);
  if (!schemasSf) return null;
  const exported = schemasSf
    .getVariableStatements()
    .filter((stmt) => stmt.isExported())
    .flatMap((stmt) => stmt.getDeclarations())
    .some((decl) => decl.getName() === constantName);
  return exported ? constantName : null;
}

// ── HTTP-method ⇄ fetch-kind mapping ──────────────────────────────────────

/**
 * Map an HTTP method to the fetch KIND whose call sites are eligible to bind
 * it (Subtask 32.22). A route handler's response schema must be inferred from
 * the call that READS that method's response:
 *   - `GET` / `HEAD`                    → `read`  (`fetchJson<T>`)
 *   - `POST` / `PUT` / `PATCH` / `DELETE` → `write` (`mutationFetchJson<T>`)
 *
 * Returns `null` for any unrecognised method (e.g. `OPTIONS`) — such a method
 * has no fetcher-derived response shape and falls through to the
 * `z.unknown()` fall-back. The comparison is case-insensitive for robustness,
 * though `getExportedMethods` already yields canonical upper-case names.
 */
function methodFetchKind(method: string): FetchKind | null {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'read';
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      return 'write';
    default:
      return null;
  }
}

// ── Defect-B5 binding-correction override (route+method precedence) ────────

/**
 * Explicit route+method → ResponseSchema overrides (Subtask 32.28, defect-B5).
 *
 * The 32.20 Source-A URL-matcher binds a route to the FIRST baseline
 * `fetchJson`/`mutationFetchJson` type-arg whose URL aligns. For 5 routes (6
 * method-bindings) that type-arg's `${interface}Schema` describes a DIFFERENT
 * entity than the route's real 2xx body — its required top-level keys are
 * entirely absent, so under the {32.25} pass-through wrapper the bound schema
 * rejects LOUD regardless of `.loose()` strictness. That is a binding-
 * correctness defect (logically PRIOR to {32.26}'s nullable/strictness drift),
 * so it cannot be fixed by tightening; the correct schema must be bound at
 * inference time.
 *
 * Rather than re-architect the heuristic URL matcher (which shares its
 * round-trip contract with the canonical, MUST-NOT-MODIFY
 * `tools/ast-dataflow/queries/type-drift-detect.ts`), we override the offending
 * (route-suffix, method) pairs to their hand-authored schemas in
 * `lib/validation/schemas.ts` (authored OUTSIDE the {32.26} generated block).
 * The override is consulted with PRECEDENCE over the heuristic chain, so the
 * {32.27} temp-copy `--apply` emits the CORRECT `defineRoute(<schema>, …)`.
 *
 * Method-keyed (not route-keyed) so the correctly-bound sibling methods are
 * untouched — e.g. `GET /api/coverage/targets` genuinely returns the
 * `{ targets }` shape `TargetsResponseSchema` describes and is NOT overridden;
 * only the `PUT` (which returns `{ success, count }`) is.
 *
 * The route is matched by POSIX path SUFFIX so the same map resolves under
 * both a disk-loaded project (absolute paths) and the in-memory test harness
 * (`/repo/...`). Each entry names a real exported constant from
 * `lib/validation/schemas.ts`; a missing constant (e.g. a future rename)
 * surfaces via `findSchemaConstant` returning `null` and the standard
 * `z.unknown()` + `NEEDS_SCHEMA` fall-back, so a stale override degrades
 * gracefully rather than emitting a dangling identifier.
 *
 * Spec: docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PLAN.md §0; task-list.json
 *       ID-32.28 (RE-SCOPED, OQ-10). The corpus rollout that wraps the live
 *       route files with these bindings is Task ID-49.
 */
interface BindingOverride {
  /** Route file POSIX path suffix (matched via `endsWith`). */
  routeSuffix: string;
  /** Upper-case HTTP method this override applies to. */
  method: string;
  /** Bare exported constant name in `lib/validation/schemas.ts`. */
  schemaConstant: string;
}

const DEFECT_B5_BINDING_OVERRIDES: readonly BindingOverride[] = [
  // GET /api/entities/co-occurrence → `{ pairs, total }` (was EntityDetailSchema).
  {
    routeSuffix: 'app/api/entities/co-occurrence/route.ts',
    method: 'GET',
    schemaConstant: 'EntityCoOccurrenceResponseSchema',
  },
  // PUT /api/coverage/targets → `{ success, count }` (was TargetsResponseSchema;
  // the GET on this route is CORRECTLY bound and intentionally NOT overridden).
  {
    routeSuffix: 'app/api/coverage/targets/route.ts',
    method: 'PUT',
    schemaConstant: 'CoverageTargetsPutResponseSchema',
  },
  // PATCH /api/items/[id] → `{ success, ... }` polymorphic (was PatchResponseSchema).
  {
    routeSuffix: 'app/api/items/[id]/route.ts',
    method: 'PATCH',
    schemaConstant: 'ItemPatchResponseSchema',
  },
  // DELETE /api/items/[id] → `{ deleted, id }` (was PatchResponseSchema).
  {
    routeSuffix: 'app/api/items/[id]/route.ts',
    method: 'DELETE',
    schemaConstant: 'ItemDeleteResponseSchema',
  },
  // POST /api/items/batch-review → `{ updated }` (was PatchResponseSchema).
  {
    routeSuffix: 'app/api/items/batch-review/route.ts',
    method: 'POST',
    schemaConstant: 'BatchReviewResponseSchema',
  },
  // POST /api/items/batch-workspaces → `{ assignments }` (was PatchResponseSchema).
  {
    routeSuffix: 'app/api/items/batch-workspaces/route.ts',
    method: 'POST',
    schemaConstant: 'BatchWorkspacesResponseSchema',
  },
];

/**
 * Look up the defect-B5 binding override for a (route file, method) pair.
 * Returns the bare schema-constant name when an override applies, else `null`
 * (the heuristic chain then runs as before). Matching is POSIX-suffix +
 * case-insensitive method, mirroring the rest of this module's path handling.
 */
export function lookupBindingOverride(
  routeFilePath: string,
  method: string,
): string | null {
  const posix = routeFilePath.replace(/\\/g, '/');
  const upper = method.toUpperCase();
  const hit = DEFECT_B5_BINDING_OVERRIDES.find(
    (o) => o.method === upper && posix.endsWith(`/${o.routeSuffix}`),
  );
  return hit ? hit.schemaConstant : null;
}

// ── Public entry point ────────────────────────────────────────────────────

/**
 * Infer the `ResponseSchema` argument for a route handler via Source A.
 *
 * Strategy (per TECH §3.A, broadened in Subtask 32.21):
 *
 *   1. Convert the route file path to a candidate URL pattern.
 *   2. Walk the broad fetch file-set (`hooks/**`, `components/**`,
 *      `lib/query/**` — see `collectFetcherCalls`) for `fetchJson<T>(url)`
 *      calls whose URL matches the route's candidate URL. The original walk
 *      saw only `lib/query/fetchers.ts`; broadening reaches the ~30 baseline
 *      interfaces fetched INSIDE hooks/components.
 *   3. Filter the matched `T` set against the baseline — only baseline
 *      interfaces are considered (per AC-5). Non-baseline `fetchJson` reads
 *      (e.g. `ProcurementSummary`) are dropped here.
 *   4. RESOLVE collisions. Broadening means a route can match more than one
 *      baseline fetcher URL. Score each match by segment specificity
 *      (`matchSpecificity`) and keep only the highest-scoring candidates —
 *      this implements the brief's "prefer the literal-segment route over a
 *      wildcard match" rule. Then:
 *      a. If the surviving candidates resolve to a SINGLE schema expression,
 *         bind it: `XSchema` for a scalar `fetchJson<X>`, `z.array(XSchema)`
 *         for an array `fetchJson<X[]>`.
 *      b. If they resolve to MORE THAN ONE distinct schema expression (a
 *         genuine ambiguity the score could not break), REPORT it via
 *         `console.warn` and fall back to `z.unknown()` + `NEEDS_SCHEMA`
 *         rather than silently picking — the 32.12 emitter then surfaces the
 *         route for manual review.
 *   5. The chosen interface's `${T}Schema` / `${T}ZodSchema` is looked up in
 *      `lib/validation/schemas.ts`; a missing constant falls back to
 *      `z.unknown()` + `NEEDS_SCHEMA` (per AC-6 the 32.12 emitter then adds
 *      the `// TODO(OPS-T1): author ResponseSchema` comment).
 *   6. No baseline match → the same fall-back so Sources B / C (owned by
 *      32.9 / post-32 backlog) can attempt their own lookups downstream.
 *
 * `method` drives HTTP-method-aware binding (Subtask 32.22). A route may
 * export BOTH a GET (read via `fetchJson<GetT>`) and a write method (POST /
 * PUT / PATCH / DELETE via `mutationFetchJson<PostT>`) at the SAME URL — they
 * must bind DIFFERENT schemas. We map the method to its eligible fetch KIND
 * (`methodFetchKind`) and only score call sites of that KIND, so a GET binds
 * the read-fetched interface and a POST binds the mutation-fetched interface.
 * A method with no fetch-kind mapping (e.g. `OPTIONS`) yields no candidates
 * and falls through to the `z.unknown()` fall-back.
 */
export function inferSchemaSourceA(
  sf: SourceFile,
  method: string,
  project: Project,
  options: InferSchemaOptions = {},
): InferSchemaResult {
  const baseline = options.baseline ?? loadBaseline();
  // When a path is NOT injected (the production / no-options path), resolve
  // the schemas-registry path by its conventional suffix against the
  // project's actual file paths — the `/repo/...` literal default never
  // resolved in a disk-loaded project. Injected paths (in-memory 32.8 / 32.20
  // harnesses) are honoured verbatim. A `null` resolution falls through to an
  // empty lookup and the `z.unknown()` fall-back. The fetcher-walk file-set is
  // now path-pattern driven (`collectFetcherCalls`), so `options.fetchersPath`
  // is no longer consulted for the walk — the in-memory harness mounts its
  // synthetic fetcher at `lib/query/fetchers.ts`, which the walk still scans.
  const schemasPath =
    options.schemasPath ??
    resolveLookupPath(project, SCHEMAS_PATH_SUFFIX) ??
    SCHEMAS_PATH_SUFFIX;

  // Defect-B5 binding-correction override (Subtask 32.28). A handful of routes
  // were bound a schema describing a DIFFERENT entity by the 32.20 URL-matcher;
  // an explicit (route-suffix, method) override takes PRECEDENCE over the
  // heuristic walk below and binds the hand-authored corrected schema. We still
  // confirm the named constant is actually exported from `schemas.ts` via
  // `findSchemaConstant` so a stale override (e.g. a future rename) degrades to
  // the standard `z.unknown()` + `NEEDS_SCHEMA` fall-back rather than emitting a
  // dangling identifier.
  const overrideConstant = lookupBindingOverride(sf.getFilePath(), method);
  if (overrideConstant) {
    const resolved = findExactSchemaConstant(
      overrideConstant,
      project,
      schemasPath,
    );
    if (resolved) {
      return { schema: resolved };
    }
    return { schema: Z_UNKNOWN_PLACEHOLDER, reason: 'NEEDS_SCHEMA' };
  }

  // The method's eligible fetch KIND. `null` (e.g. OPTIONS) → no candidate
  // call sites match, so we short-circuit to the fall-back below.
  const eligibleKind = methodFetchKind(method);

  const candidateUrl = routePathToCandidateUrl(sf.getFilePath());
  const fetcherCalls = collectFetcherCalls(project);
  const baselineInterfaces = new Set(baseline.map((b) => b.interface));

  // Collect every baseline fetcher call whose URL matches this route AND whose
  // fetch KIND is eligible for the requested method (read↔GET, write↔mutation),
  // tagged with its segment-specificity score so wildcard collisions can be
  // broken. The method filter keeps a GET from cross-binding a write-side
  // mutation schema and vice versa, even when both target the same URL.
  const scored = fetcherCalls
    .filter(
      (c) =>
        c.kind === eligibleKind &&
        baselineInterfaces.has(c.typeArg) &&
        routeUrlMatches(candidateUrl, c.url),
    )
    .map((c) => ({ call: c, score: matchSpecificity(candidateUrl, c.url) }))
    .filter((m) => m.score !== NO_MATCH);

  if (scored.length === 0) {
    // No baseline binding for this route — fall-back per AC-6.
    return { schema: Z_UNKNOWN_PLACEHOLDER, reason: 'NEEDS_SCHEMA' };
  }

  // Prefer the most specific (literal-segment-aligned) match(es).
  const bestScore = Math.max(...scored.map((m) => m.score));
  const winners = scored
    .filter((m) => m.score === bestScore)
    .map((m) => m.call);

  // De-duplicate to DISTINCT schema expressions. A route fetched as both a
  // scalar and an array of the same interface (none observed, but guarded)
  // would surface as two expressions; so would two genuinely different
  // baseline interfaces tied on specificity.
  const distinct = new Map<string, FetcherCall>();
  for (const w of winners) {
    distinct.set(`${w.typeArg}::${w.isArray ? 'array' : 'scalar'}`, w);
  }

  if (distinct.size > 1) {
    // Genuine ambiguity the specificity score could not break — report rather
    // than silently pick (per the dispatch brief's collision-safety rule).
    const detail = winners
      .map((w) => `${w.isArray ? `${w.typeArg}[]` : w.typeArg} <- ${w.url}`)
      .join(', ');
    console.warn(
      `[inference-source-a] AMBIGUOUS bind for ${candidateUrl}: ` +
        `${distinct.size} equally-specific baseline matches [${detail}]. ` +
        `Falling back to z.unknown() — resolve manually.`,
    );
    return { schema: Z_UNKNOWN_PLACEHOLDER, reason: 'NEEDS_SCHEMA' };
  }

  const chosen = winners[0];
  if (!chosen) {
    return { schema: Z_UNKNOWN_PLACEHOLDER, reason: 'NEEDS_SCHEMA' };
  }

  const schemaConstant = findSchemaConstant(
    chosen.typeArg,
    project,
    schemasPath,
  );
  if (schemaConstant) {
    return { schema: schemaExpression(schemaConstant, chosen.isArray) };
  }
  return { schema: Z_UNKNOWN_PLACEHOLDER, reason: 'NEEDS_SCHEMA' };
}
