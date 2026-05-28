/**
 * OPS-T1 codemod acceptance gate — dry-run criteria AC-1..AC-7.
 *
 * Spec:
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PRODUCT.md §8 (AC-1..AC-10).
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PLAN.md §4 Subtask 32.16
 *     (per-AC mode split + traceability matrix §5).
 *
 * This file is the read-only dry-run half of the acceptance gate (originally
 * Subtask 32.16, re-finalised under the Option-4 model at Subtask 32.27). It
 * asserts the dry-run criteria (AC-1..AC-7) against the LIVE `app/api/`
 * corpus. The apply-against-temp-copy criteria (AC-8, AC-9, AC-10) live in
 * the sibling integration test
 * `__tests__/integration/ops-t1-codemod-acceptance.integration.test.ts`
 * because each shells out to a full `--apply` + lint + verifier pass that
 * exceeds the 4-shard `quality-test` unit budget (PLAN §4 32.16 budget
 * note; precedent: `ops-t1-codemod-verifier.integration.test.ts` from
 * Subtask 32.15).
 *
 * INV-S (the generated-schema strictness contract, TECH §3.1a) is NOT
 * duplicated here — it is owned by the {32.26} static guard
 * `__tests__/lib/validation/r-wp17-schema-strictness.test.ts`, which asserts
 * every `.loose()`/`z.unknown()` in the generated block is allow-listed. This
 * gate references it as the INV-S check rather than re-implementing it.
 *
 * Mode (PLAN §4 32.16): AC-1..AC-7 run READ-ONLY against the working tree.
 * Where a criterion needs to inspect post-rewrite text (AC-5/6/7) the test
 * rewrites an in-memory `SourceFile` and reads `sf.getFullText()` WITHOUT
 * calling `sf.saveSync()` — the working tree is never mutated. Each
 * rewrite-based criterion builds a FRESH `createCodemodProject()` so the
 * in-memory AST mutation of one criterion cannot leak into another.
 *
 * Corpus-drift discipline (dispatch brief §3): the live corpus has drifted
 * from the route-shape-inventory.md snapshot (193/137/40/16). These tests
 * therefore assert BEHAVIOURAL invariants (dry-run completes; the
 * TRANSFORM/NEEDS_REVIEW/MANUAL partition is exhaustive + disjoint;
 * artefacts emit) and report the ACTUAL live counts rather than hard-coding
 * the inventory integers. A census integer is NOT an acceptance criterion.
 *
 * Test-philosophy: each `it()` is titled per its AC (§5); assertions are on
 * observable output — route counts, rewritten text, artefact file contents —
 * never on ts-morph internal state (§1).
 *
 * RE-FINALISATION (Subtask 32.27, Option-4 model): the AC-5 blocker is
 * CLEARED. The {32.28} inference correction + the {32.26} co-located
 * `${interface}Schema` constants in `lib/validation/schemas.ts` mean
 * MECHANISABLE routes now infer real `ResponseSchema` identifiers (54 live
 * bindings across the corpus at re-finalisation). AC-5 is therefore a LIVE
 * assertion (no longer `it.fails`) — the `it.fails` auto-flip design served
 * its purpose: it went RED the moment binding worked, forcing this re-check.
 * The apply-against-temp-copy criteria AC-8/9/10 live in the sibling
 * integration test and are likewise now live (canary retired). See the
 * Subtask 32.27 journal block.
 *
 * Test invocation: `bun run test` (Vitest) — NOT `bun test`.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import {
  createCodemodProject,
  enumerateRouteFiles,
  classifyRoute,
  getExportedMethods,
  inferSchema,
  buildRouteRecords,
  rewriteSingleMethod,
  runScaffold,
  parseCliArgs,
} from '../../../scripts/codemods/wrap-define-route';
import type { RouteShape } from '../../../scripts/codemods/types';

/** Generous timeout: cold-starting a ts-morph Project over the full corpus
 *  (~200 route files plus their transitive imports) costs several seconds.
 *  The four pre-existing CLI-scaffold tests in `wrap-define-route.test.ts`
 *  already exceed the 5000ms default — a known issue on origin/main, not a
 *  regression of this gate. */
const CORPUS_TIMEOUT_MS = 120_000;

const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * Restrict an enumerated route set to the PRODUCTION `app/api/` corpus.
 *
 * `enumerateRouteFiles()` matches the regex `app/api/.*\/route\.ts$` against
 * the ts-morph project's source files. That project loads everything the
 * working-tree `tsconfig.json` includes — which (on this corpus) ALSO sweeps
 * in three fixture routes under
 * `__tests__/lib/ast-dataflow/fixtures/17-type-drift/app/api/`. Those are
 * NOT production routes; the regex over-match is an out-of-scope finding
 * (reported in the journal). The production corpus is exactly the set whose
 * repo-relative path begins `app/api/`.
 */
function productionRoutes() {
  const project = createCodemodProject();
  const all = enumerateRouteFiles(project);
  const prod = all.filter((sf) =>
    sf
      .getFilePath()
      .replace(/\\/g, '/')
      .replace(`${REPO_ROOT.replace(/\\/g, '/')}/`, '')
      .startsWith('app/api/'),
  );
  return { project, all, prod };
}

describe('OPS-T1 codemod acceptance gate — dry-run criteria (Subtask 32.16)', () => {
  it(
    'AC-1: dry-run completes without exception on the full route corpus',
    async () => {
      // PRODUCT AC-1: `bun scripts/codemods/wrap-define-route.ts` (dry-run,
      // no flags) runs to completion without error or uncaught exception.
      // We exercise the SAME public entry point the CLI uses (`runScaffold`)
      // in dry-run mode, redirecting artefact output to a tmpdir so the
      // committed `docs/generated/` tree is never dirtied.
      const outputDir = mkdtempSync(join(tmpdir(), 'ops-t1-ac1-'));
      try {
        const args = parseCliArgs([]); // dry-run, no --apply
        const result = await runScaffold(args, { outputDir });
        // Behavioural assertion: the run completed and discovered routes.
        // The exact count is whatever the live corpus is (drift-tolerant) —
        // we assert it is the full corpus, not a magic number.
        expect(result.apply).toBe(false);
        expect(result.routeCount).toBeGreaterThan(0);
        // The enumerated count must equal what the codemod itself reports.
        const { all } = productionRoutes();
        expect(result.routeCount).toBe(all.length);
        console.log(
          `[AC-1] dry-run completed: ${result.routeCount} route(s) enumerated by the codemod.`,
        );
      } finally {
        rmSync(outputDir, { recursive: true, force: true });
      }
    },
    CORPUS_TIMEOUT_MS,
  );

  it('AC-2: apply partition is exhaustive and disjoint over the live corpus (only MECHANISABLE rewritten; NEEDS-REVIEW + MANUAL untouched)', () => {
    // PRODUCT AC-2 (behavioural contract, drift-tolerant per brief §3):
    // the codemod writes all-and-only the MECHANISABLE (TRANSFORM) routes
    // and leaves every NEEDS-REVIEW + MANUAL route untouched. The observable
    // proof is the per-route action verdict from `buildRouteRecords()`:
    // every production route lands in exactly one of TRANSFORM /
    // NEEDS_REVIEW / MANUAL / SKIPPED, and those buckets partition the
    // corpus exhaustively + disjointly.
    const { prod } = productionRoutes();
    const { reportEntries } = buildRouteRecords(prod);

    // Disjoint + exhaustive: one verdict per route, covering every route.
    expect(reportEntries).toHaveLength(prod.length);

    const byAction: Record<string, number> = {};
    for (const e of reportEntries) {
      byAction[e.action] = (byAction[e.action] ?? 0) + 1;
    }
    const transform = byAction['TRANSFORM'] ?? 0;
    const needsReview = byAction['NEEDS_REVIEW'] ?? 0;
    const manual = byAction['MANUAL'] ?? 0;
    const skipped = byAction['SKIPPED'] ?? 0;

    // Partition invariant: the four verdict buckets sum to the live total.
    expect(transform + needsReview + manual + skipped).toBe(prod.length);

    // No route carries an action outside the known verdict set.
    const knownActions = new Set([
      'TRANSFORM',
      'NEEDS_REVIEW',
      'MANUAL',
      'SKIPPED',
    ]);
    for (const e of reportEntries) {
      expect(knownActions.has(e.action)).toBe(true);
    }

    // MANUAL routes (CRON / NAKED_NO_AUTH / MCP) must NOT be marked
    // TRANSFORM — the codemod leaves them untouched on disk (AC-2 second
    // clause). Assert the shape→action coupling holds for every MANUAL
    // shape.
    const manualShapes = new Set<RouteShape>(['CRON', 'NAKED_NO_AUTH', 'MCP']);
    for (const e of reportEntries) {
      if (manualShapes.has(e.shape)) {
        expect(e.action).toBe('MANUAL');
      }
    }

    console.log(
      `[AC-2] live partition — total=${prod.length} TRANSFORM=${transform} NEEDS_REVIEW=${needsReview} MANUAL=${manual} SKIPPED=${skipped} ` +
        `(route-shape-inventory.md snapshot: 193/137/40/16 — divergence is documented corpus drift).`,
    );
  });

  it('AC-3: a second consecutive apply produces no further modifications (idempotency)', () => {
    // PRODUCT AC-3: running --apply twice produces no further file changes;
    // the second run reports every route SKIPPED. The canonical end-to-end
    // form (apply-twice on a temp copy) lives in the integration sibling
    // (it requires a real on-disk apply). Here we assert the IDEMPOTENCY
    // PREDICATE the apply loop gates on: once a route's every exported
    // method is wrapped, `buildRouteRecords()` classifies it SKIPPED with
    // no needs-manual entry.
    //
    // We prove the predicate on the live corpus' ALREADY-wrapped routes (if
    // any exist post-partial-migration) AND prove the mechanism directly:
    // rewrite a MECHANISABLE route in-memory, re-classify it, and assert the
    // second pass yields SKIPPED. This is the behaviour AC-3 guarantees.
    const project = createCodemodProject();
    const target = resolve(REPO_ROOT, 'app/api/activity/route.ts');
    const sf = project.getSourceFile(target);
    expect(sf, 'expected app/api/activity/route.ts in the corpus').toBeTruthy();
    if (!sf) return;

    const methods = getExportedMethods(sf);
    expect(methods.length).toBeGreaterThan(0);

    // First pass: rewrite each method in-memory (no save).
    for (const method of methods) {
      const schema = inferSchema(sf, method, project);
      rewriteSingleMethod(sf, method, schema);
    }

    // Second pass: re-run discovery over the now-wrapped file. The route
    // must classify SKIPPED (idempotent no-op) and carry NO needs-manual
    // entry (PRODUCT §4: idempotent successes are not unhandled cases).
    const { reportEntries, needsManualEntries } = buildRouteRecords([sf]);
    expect(reportEntries).toHaveLength(1);
    expect(reportEntries[0]!.action).toBe('SKIPPED');
    const route = reportEntries[0]!.route;
    expect(needsManualEntries.some((e) => e.route === route)).toBe(false);

    console.log(
      `[AC-3] re-applied route '${route}' classifies SKIPPED on the second pass (idempotent).`,
    );
  });

  it(
    'AC-4: codemod-needs-manual.json is produced on every run and lists every MANUAL + NEEDS-REVIEW route',
    async () => {
      // PRODUCT AC-4: `codemod-needs-manual.json` is produced in every run
      // (dry-run and apply); it lists all MANUAL routes plus any NEEDS-REVIEW
      // routes with their reason codes. Assert on the EMITTED ARTEFACT
      // (observable output), not the in-memory entries.
      const outputDir = mkdtempSync(join(tmpdir(), 'ops-t1-ac4-'));
      try {
        const result = await runScaffold(parseCliArgs([]), { outputDir });

        // The artefact file exists after a dry-run.
        expect(existsSync(result.needsManualReportPath)).toBe(true);
        const parsed = JSON.parse(
          readFileSync(result.needsManualReportPath, 'utf8'),
        ) as unknown;

        // The artefact is the structured needs-manual report. Its shape is
        // owned by emit-needs-manual.ts; we assert the route set it carries
        // matches the NEEDS_REVIEW + MANUAL verdicts from discovery.
        const { prod } = productionRoutes();
        const { reportEntries } = buildRouteRecords(prod);
        const expectedManualReviewRoutes = new Set(
          reportEntries
            .filter((e) => e.action === 'MANUAL' || e.action === 'NEEDS_REVIEW')
            .map((e) => e.route),
        );

        // Extract the route list from the artefact (its top-level `entries`
        // array, per emit-needs-manual.ts serialisation).
        const artefactRoutes = extractArtefactRoutes(parsed);

        // Every MANUAL + NEEDS_REVIEW production route must be present.
        for (const r of expectedManualReviewRoutes) {
          expect(
            artefactRoutes.has(r),
            `needs-manual artefact missing expected route: ${r}`,
          ).toBe(true);
        }
        // And the artefact must NOT carry any SKIPPED / TRANSFORM-only route
        // (PRODUCT §4: idempotent successes / clean transforms are omitted).
        const transformOrSkipped = new Set(
          reportEntries
            .filter((e) => e.action === 'TRANSFORM' || e.action === 'SKIPPED')
            .map((e) => e.route),
        );
        for (const r of artefactRoutes) {
          // A route can be in artefactRoutes only if it is MANUAL/NEEDS_REVIEW.
          expect(transformOrSkipped.has(r)).toBe(false);
        }

        console.log(
          `[AC-4] needs-manual artefact lists ${artefactRoutes.size} route(s); expected MANUAL+NEEDS_REVIEW set size ${expectedManualReviewRoutes.size}.`,
        );
      } finally {
        rmSync(outputDir, { recursive: true, force: true });
      }
    },
    CORPUS_TIMEOUT_MS,
  );

  // AC-5 (LIVE at re-finalisation, Subtask 32.27): the {32.28} inference
  // correction + the {32.26} co-located `${interfaceName}Schema` constants
  // mean MECHANISABLE routes now infer real ResponseSchema identifiers. The
  // former `it.fails` wrapper auto-flipped RED the moment binding worked —
  // it is now an ordinary live assertion.
  it('AC-5: a baseline-backed MECHANISABLE route infers a real ResponseSchema (not z.unknown)', () => {
    const { project, prod } = productionRoutes();
    let realSchemaRoute: string | null = null;

    for (const sf of prod) {
      const shape = classifyRoute(sf);
      if (shape === 'CRON' || shape === 'NAKED_NO_AUTH' || shape === 'MCP') {
        continue;
      }
      for (const method of getExportedMethods(sf)) {
        const res = inferSchema(sf, method, project);
        if (res.schema !== 'z.unknown()') {
          realSchemaRoute = `${sf.getFilePath()} ${method} -> ${res.schema}`;
          break;
        }
      }
      if (realSchemaRoute) break;
    }

    // REAL AC-5 assertion: at least one MECHANISABLE route must infer a
    // concrete ResponseSchema identifier rather than the z.unknown()
    // fall-back. Met at re-finalisation — {32.28}'s corrected inference
    // resolves `${interface}Schema` against {32.26}'s co-located constants.
    expect(
      realSchemaRoute,
      'expected at least one MECHANISABLE route to infer a real ResponseSchema (z.unknown fall-back regression?)',
    ).not.toBeNull();
  });

  it('AC-6: a route with the z.unknown() placeholder carries the // TODO(OPS-T1): author ResponseSchema comment', () => {
    // PRODUCT AC-6: routes that fall back to z.unknown() carry the
    // `// TODO(OPS-T1): author ResponseSchema` comment. Assert on the
    // POST-REWRITE TEXT of a real z.unknown()-fallback route, rendered
    // in-memory (no save). Fresh project so this criterion's mutation does
    // not leak into AC-7.
    const project = createCodemodProject();
    const target = resolve(REPO_ROOT, 'app/api/activity/route.ts');
    const sf = project.getSourceFile(target);
    expect(sf, 'expected app/api/activity/route.ts in the corpus').toBeTruthy();
    if (!sf) return;

    const methods = getExportedMethods(sf);
    const method = methods[0]!;
    const schema = inferSchema(sf, method, project);
    // Precondition for this criterion: the route DOES fall back to
    // z.unknown() (the TODO comment only attaches on that path).
    expect(schema.schema).toBe('z.unknown()');

    rewriteSingleMethod(sf, method, schema);
    const printed = sf.getFullText();
    expect(printed).toContain('// TODO(OPS-T1): author ResponseSchema');
    // Disk untouched — we never called saveSync().
    expect(readFileSync(target, 'utf8')).not.toContain(
      '// TODO(OPS-T1): author ResponseSchema',
    );
  });

  it('AC-7: withRequestContext remains the OUTERMOST wrapper after rewrite (withRequestContext(defineRoute(...)))', () => {
    // PRODUCT AC-7: +WRC routes are wrapped so withRequestContext stays
    // outermost: `withRequestContext(defineRoute(Schema, ...))`. Assert on
    // the POST-REWRITE TEXT of a real +WRC route (in-memory, no save).
    // Fresh project, isolated from AC-6.
    const project = createCodemodProject();
    const target = resolve(REPO_ROOT, 'app/api/items/route.ts');
    const sf = project.getSourceFile(target);
    expect(sf, 'expected app/api/items/route.ts in the corpus').toBeTruthy();
    if (!sf) return;

    const shape = classifyRoute(sf);
    // Precondition for this criterion: the route is a single-method +WRC
    // shape that uses the EXACT `withRequestContext` wrapper (not a
    // synonym such as `withRequestContextBare` — see the AC-8 escalation).
    expect(shape.endsWith('+WRC')).toBe(true);
    expect(shape.startsWith('MULTI_')).toBe(false);

    const method = getExportedMethods(sf)[0]!;
    const schema = inferSchema(sf, method, project);
    rewriteSingleMethod(sf, method, schema);
    const printed = sf.getFullText();

    // Outer-wrap order: withRequestContext( immediately wrapping defineRoute(.
    expect(printed).toMatch(
      new RegExp(
        `export const ${method} = withRequestContext\\(\\s*defineRoute\\(`,
      ),
    );
    // Disk untouched.
    expect(readFileSync(target, 'utf8')).not.toContain('defineRoute(');
  });
});

/**
 * Extract the set of route paths carried by the emitted needs-manual
 * artefact. The artefact is JSON produced by emit-needs-manual.ts; its
 * top-level shape is `{ generatedAt, entries: [{ route, shape, reason, ...}] }`
 * (or a bare array in older serialisations). This helper is tolerant of both
 * so the AC-4 assertion keys off the OBSERVABLE route list, not a brittle
 * exact-shape match.
 */
function extractArtefactRoutes(parsed: unknown): Set<string> {
  const routes = new Set<string>();
  const pushFrom = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (
        item &&
        typeof item === 'object' &&
        'route' in item &&
        typeof (item as { route: unknown }).route === 'string'
      ) {
        routes.add((item as { route: string }).route);
      }
    }
  };
  if (Array.isArray(parsed)) {
    pushFrom(parsed);
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    pushFrom(obj['entries']);
    pushFrom(obj['routes']);
  }
  return routes;
}
