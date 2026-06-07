/**
 * Schema-inference plumbing retained from the retired OPS-T1 codemod
 * (ID-32 `wrap-define-route.ts`, deleted under ID-68.25 — the codemod's
 * CLI / rewrite / report-emission surfaces are gone, but the inference
 * chain and project/route enumeration helpers remain LIVE: the real-corpus
 * regression suite `__tests__/scripts/codemods/inference-source-a.real-corpus.test.ts`
 * loads the actual repo `tsconfig.json` via `createCodemodProject()` and
 * asserts `inferSchema` / `inferSchemaSourceA` bind real `${interface}Schema`
 * constants over the live route corpus (AC-5).
 *
 * Extraction provenance: `createCodemodProject`, `enumerateRouteFiles` and
 * `inferSchema` (plus `ROUTE_FILE_PATTERN`) are moved verbatim from
 * `scripts/codemods/wrap-define-route.ts` — behaviour is unchanged.
 */

import { resolve } from 'node:path';
import { Project, type SourceFile } from 'ts-morph';
import {
  inferSchemaSourceA,
  type InferSchemaOptions,
  type InferSchemaResult,
} from './inference-source-a';
import { inferSchemaSourceB } from './inference-source-b';

// ── Route-file matcher ─────────────────────────────────────────────────────

/**
 * Repo-root-anchored route matcher (S262 fix B3). The path RELATIVE to the
 * enumeration root must begin with `app/api/` and end with `/route.ts`. Anchored
 * with `^` so it matches the repo-root `app/api/` directory ONLY — NOT fixture
 * routes nested under `__tests__/lib/ast-dataflow/fixtures/.../app/api/.../route.ts`,
 * which the pre-fix unanchored `app/api/.*\/route\.ts$` swept in (inflating the
 * live corpus 195 → 198).
 */
const ROUTE_FILE_PATTERN = /^app\/api\/.*\/route\.ts$/;

// ── ts-morph Project init ─────────────────────────────────────────────────

/**
 * Initialise a ts-morph `Project` from the working tree's `tsconfig.json`.
 * `skipAddingFilesFromTsConfig: false` (the default) is preserved per TECH
 * §2.1 so `app/**\/*.ts` (which includes `app/api/**\/route.ts`) loads
 * automatically.
 *
 * Throws if the tsconfig cannot be located or parsed.
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
 * routes nested under `__tests__/lib/ast-dataflow/fixtures/.../app/api/.../route.ts`
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
 * (`{ schema: 'z.unknown()', reason: 'NEEDS_SCHEMA' }`) so consumers do not
 * need to distinguish between "Source B failed schema lookup" and "Source A
 * failed schema lookup".
 *
 * Per PRODUCT.md AC-5 / AC-6:
 *   - AC-5: routes whose interface IS in the baseline AND has a
 *     `${interfaceName}Schema` constant get the schema identifier verbatim.
 *   - AC-6: routes that fall back to `z.unknown()` carry the
 *     `NEEDS_SCHEMA` reason code.
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
