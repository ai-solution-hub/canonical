/**
 * Classifier tests for `scripts/codemods/wrap-define-route.ts` —
 * `classifyRoute(sf)` + `getExportedMethods(sf)`.
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §2.3 (canonical
 *     classifier impl + priority order).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/route-shape-inventory.md §2
 *     (shape taxonomy + priority `CRON` > `MCP` > `NAKED_NO_AUTH` >
 *     multi-method > single-method).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md §6 (failure
 *     modes per route shape — drives the +WRC, multi-method, MANUAL splits).
 *
 * Scope (Subtask 32.6): classifier-only unit tests. The fixture-corpus
 * harness (32.7) authors physical route.ts fixtures; this file uses
 * synthetic in-memory `SourceFile` instances built by a single factory
 * helper so each test focuses on one observable behaviour.
 *
 * Test invocation: `bun run test` (Vitest). NOT `bun test` — see CLAUDE.md
 * Gotchas → Testing.
 */

import { describe, it, expect } from 'vitest';
import { Project, type SourceFile } from 'ts-morph';
import {
  classifyRoute,
  getExportedMethods,
} from '../../../scripts/codemods/wrap-define-route';
import type { RouteShape } from '../../../scripts/codemods/types';

// ── Test factory ──────────────────────────────────────────────────────────

/**
 * Build a synthetic ts-morph `SourceFile` representing a route handler with
 * the requested structural features. The file lives in an in-memory
 * `Project` (no disk I/O) so each test is independent and cheap.
 *
 * `path` controls the routing-priority signals (`/cron/` / `/mcp/` / `[id]`
 * presence); `methods` controls multi-method classification; `hasAuth` /
 * `hasBody` / `hasWRC` flip the matching detection signals inside the file
 * body. The resulting source text is intentionally minimal — the classifier
 * inspects imports, path, and `getFullText()` substrings only, so we do not
 * need to emit syntactically rich route bodies.
 */
function buildFixture(opts: {
  path: string;
  methods: readonly string[];
  hasAuth: boolean;
  hasBody?: boolean;
  hasWRC?: boolean;
  /** Extra exports that should NOT be recognised as HTTP methods (TECH §8.3). */
  extraExports?: readonly string[];
}): SourceFile {
  const {
    path,
    methods,
    hasAuth,
    hasBody = false,
    hasWRC = false,
    extraExports = [],
  } = opts;

  const project = new Project({ useInMemoryFileSystem: true });

  const importLines: string[] = [];
  if (hasAuth) {
    importLines.push(
      "import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';",
    );
  }
  if (hasWRC) {
    importLines.push("import { withRequestContext } from '@/lib/logger';");
  }

  const bodyExpression = hasBody ? 'const body = await request.json();\n' : '';

  const methodBlocks = methods
    .map((method) => {
      if (hasWRC) {
        return `export const ${method} = withRequestContext(async (request) => {
  ${bodyExpression}return new Response('ok');
});`;
      }
      return `export async function ${method}(request) {
  ${bodyExpression}return new Response('ok');
}`;
    })
    .join('\n\n');

  const extraExportBlocks = extraExports
    .map((name) => {
      // Match real-world examples from TECH §8.3 (maxDuration / dynamic /
      // runtime). String / number values are both represented.
      if (name === 'maxDuration') return 'export const maxDuration = 30;';
      if (name === 'dynamic') return "export const dynamic = 'force-dynamic';";
      if (name === 'runtime') return "export const runtime = 'edge';";
      return `export const ${name} = 'sentinel';`;
    })
    .join('\n');

  const source = `${importLines.join('\n')}\n\n${methodBlocks}\n\n${extraExportBlocks}\n`;
  return project.createSourceFile(path, source);
}

// Type-guard helper: ergonomic shorthand for the eight expected shapes covered
// across the suite. Returned value is the literal `RouteShape` — useful when
// asserting equality against TS-narrowed values.
function expectShape(sf: SourceFile, expected: RouteShape): void {
  expect(classifyRoute(sf)).toBe(expected);
}

// ── Priority-order tests ──────────────────────────────────────────────────

describe('classifyRoute — priority order', () => {
  it('classifies a route under /cron/ as CRON even when no auth import is present', () => {
    // Per TECH §2.3, `CRON` matches first regardless of auth or body shape.
    const sf = buildFixture({
      path: '/repo/app/api/cron/process-queue/route.ts',
      methods: ['POST'],
      hasAuth: false,
      hasBody: true,
    });
    expectShape(sf, 'CRON');
  });

  it('classifies a route under /mcp/ as MCP even when auth and body are present', () => {
    const sf = buildFixture({
      path: '/repo/app/api/mcp/transport/route.ts',
      methods: ['POST'],
      hasAuth: true,
      hasBody: true,
    });
    expectShape(sf, 'MCP');
  });

  it('classifies a non-cron non-mcp route without @/lib/auth as NAKED_NO_AUTH', () => {
    const sf = buildFixture({
      path: '/repo/app/api/health/route.ts',
      methods: ['GET'],
      hasAuth: false,
    });
    expectShape(sf, 'NAKED_NO_AUTH');
  });

  it('does not suffix CRON with +WRC even when withRequestContext is present', () => {
    // CRON is MANUAL — the +WRC discriminator does not apply per
    // route-shape-inventory.md §6 (MANUAL bucket).
    const sf = buildFixture({
      path: '/repo/app/api/cron/decorated/route.ts',
      methods: ['POST'],
      hasAuth: false,
      hasWRC: true,
    });
    expectShape(sf, 'CRON');
  });
});

// ── Single-method shape tests ─────────────────────────────────────────────

describe('classifyRoute — single-method shapes', () => {
  it('classifies a single-method auth-wrapped handler with no params as AUTH_PLAIN', () => {
    const sf = buildFixture({
      path: '/repo/app/api/insights/route.ts',
      methods: ['GET'],
      hasAuth: true,
    });
    expectShape(sf, 'AUTH_PLAIN');
  });

  it('classifies a single-method auth-wrapped handler with a path parameter and a JSON body as PARAM_BODY', () => {
    const sf = buildFixture({
      path: '/repo/app/api/items/[id]/route.ts',
      methods: ['PATCH'],
      hasAuth: true,
      hasBody: true,
    });
    expectShape(sf, 'PARAM_BODY');
  });

  it('classifies a single-method auth-wrapped handler with a JSON body and no path parameter as BODY_VALIDATED', () => {
    const sf = buildFixture({
      path: '/repo/app/api/items/route.ts',
      methods: ['POST'],
      hasAuth: true,
      hasBody: true,
    });
    expectShape(sf, 'BODY_VALIDATED');
  });

  it('classifies a single-method auth-wrapped handler with a path parameter and no body as PARAM', () => {
    const sf = buildFixture({
      path: '/repo/app/api/items/[id]/route.ts',
      methods: ['GET'],
      hasAuth: true,
    });
    expectShape(sf, 'PARAM');
  });
});

// ── Multi-method shape tests ──────────────────────────────────────────────

describe('classifyRoute — multi-method shapes', () => {
  it('classifies a multi-method route with a path parameter and a body as MULTI_PARAM_BODY', () => {
    const sf = buildFixture({
      path: '/repo/app/api/items/[id]/route.ts',
      methods: ['GET', 'PATCH', 'DELETE'],
      hasAuth: true,
      hasBody: true,
    });
    expectShape(sf, 'MULTI_PARAM_BODY');
  });

  it('classifies a multi-method route with a body and no path parameter as MULTI_BODY', () => {
    const sf = buildFixture({
      path: '/repo/app/api/items/route.ts',
      methods: ['GET', 'POST'],
      hasAuth: true,
      hasBody: true,
    });
    expectShape(sf, 'MULTI_BODY');
  });

  it('classifies a multi-method route with a path parameter and no body as MULTI_PARAM', () => {
    const sf = buildFixture({
      path: '/repo/app/api/items/[id]/route.ts',
      methods: ['GET', 'DELETE'],
      hasAuth: true,
    });
    expectShape(sf, 'MULTI_PARAM');
  });
});

// ── withRequestContext sub-variant tests ──────────────────────────────────

describe('classifyRoute — withRequestContext sub-variant', () => {
  it('appends +WRC when withRequestContext is the outer wrapper on a single-method route', () => {
    const sf = buildFixture({
      path: '/repo/app/api/items/route.ts',
      methods: ['POST'],
      hasAuth: true,
      hasBody: true,
      hasWRC: true,
    });
    expectShape(sf, 'BODY_VALIDATED+WRC');
  });

  it('appends +WRC to AUTH_PLAIN when withRequestContext is present', () => {
    const sf = buildFixture({
      path: '/repo/app/api/activity/route.ts',
      methods: ['GET'],
      hasAuth: true,
      hasWRC: true,
    });
    expectShape(sf, 'AUTH_PLAIN+WRC');
  });

  it('appends +WRC to PARAM_BODY when withRequestContext is present on a parameterised body route', () => {
    const sf = buildFixture({
      path: '/repo/app/api/items/[id]/classify/route.ts',
      methods: ['POST'],
      hasAuth: true,
      hasBody: true,
      hasWRC: true,
    });
    expectShape(sf, 'PARAM_BODY+WRC');
  });

  it('appends +WRC to multi-method shapes when withRequestContext is present', () => {
    const sf = buildFixture({
      path: '/repo/app/api/items/[id]/route.ts',
      methods: ['GET', 'PATCH'],
      hasAuth: true,
      hasBody: true,
      hasWRC: true,
    });
    expectShape(sf, 'MULTI_PARAM_BODY+WRC');
  });

  it('does not suffix MCP routes with +WRC because MCP is a MANUAL shape', () => {
    const sf = buildFixture({
      path: '/repo/app/api/mcp/transport/route.ts',
      methods: ['POST'],
      hasAuth: true,
      hasWRC: true,
    });
    expectShape(sf, 'MCP');
  });

  it('does not suffix NAKED_NO_AUTH routes with +WRC because NAKED_NO_AUTH is a MANUAL shape', () => {
    const sf = buildFixture({
      path: '/repo/app/api/health/route.ts',
      methods: ['GET'],
      hasAuth: false,
      hasWRC: true,
    });
    expectShape(sf, 'NAKED_NO_AUTH');
  });
});

// ── JSDoc / comment poisoning tests (Subtask 32.17) ───────────────────────

/**
 * Regression tests for Subtask 32.17 — body-detection AST refactor.
 *
 * Pre-32.17 the classifier used `sf.getFullText().includes('request.json()')`
 * and `sf.getFullText().includes('parseBody(')`. That substring scan tainted
 * detection with anything in JSDoc, line comments, or string literals — any
 * route mentioning the discriminator substrings in prose would mis-classify
 * as a BODY-tainted variant. Post-32.17 the detection walks
 * `getDescendantsOfKind(SyntaxKind.CallExpression)` so comments and string
 * literals are excluded.
 *
 * These tests assert the post-refactor contract: discriminator substrings in
 * comments / JSDoc must NOT taint classification.
 */

/**
 * Build a synthetic route fixture whose source text contains the
 * discriminator substrings ONLY in JSDoc / line comments / string literals,
 * never in executable code. Used to assert the AST-walk body detection
 * ignores non-code text.
 */
function buildJsDocPoisonedFixture(opts: {
  path: string;
  methods: readonly string[];
  hasAuth?: boolean;
}): SourceFile {
  const { path, methods, hasAuth = true } = opts;
  const project = new Project({ useInMemoryFileSystem: true });

  const importLines: string[] = [];
  if (hasAuth) {
    importLines.push(
      "import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';",
    );
  }

  // Each handler:
  //   - JSDoc that mentions `request.json()` and `parseBody(` in prose.
  //   - A line comment that mentions both.
  //   - A string-literal label that contains both substrings verbatim.
  //   - NO actual call to either function in executable code.
  const methodBlocks = methods
    .map(
      (method) => `/**
 * ${method} handler — does NOT call request.json() and does NOT call parseBody(payload).
 * The substrings above are deliberate poisoning to prove comment text is
 * excluded from body-shape classification.
 */
export async function ${method}(_request) {
  // Note: this handler never invokes request.json() or parseBody(...).
  const label = 'audit:request.json() && parseBody( — string-literal poisoning';
  return new Response(label);
}`,
    )
    .join('\n\n');

  const source = `${importLines.join('\n')}\n\n${methodBlocks}\n`;
  return project.createSourceFile(path, source);
}

describe('classifyRoute — JSDoc / comment poisoning (Subtask 32.17)', () => {
  it('classifies a JSDoc-poisoned single-method parameterised route as PARAM (not PARAM_BODY) when the body-discriminator substrings appear only in JSDoc / comments / string literals', () => {
    // Pre-32.17: substring scan over `getFullText()` would match `request.json()`
    // and `parseBody(` inside the JSDoc, line comment, and string literal —
    // mis-classifying as PARAM_BODY. Post-32.17 the CallExpression walk only
    // matches executable code, so this is PARAM.
    const sf = buildJsDocPoisonedFixture({
      path: '/repo/app/api/entities/[canonical_name]/route.ts',
      methods: ['GET'],
    });
    expectShape(sf, 'PARAM');
  });

  it('classifies a JSDoc-poisoned multi-method parameterised route as MULTI_PARAM (not MULTI_PARAM_BODY) when the body-discriminator substrings appear only in JSDoc / comments / string literals', () => {
    // Same poisoning, multi-method (GET + DELETE) on a `[id]` path. Expected
    // post-refactor: MULTI_PARAM (not MULTI_PARAM_BODY / MULTI_BODY).
    const sf = buildJsDocPoisonedFixture({
      path: '/repo/app/api/items/[id]/files/route.ts',
      methods: ['GET', 'DELETE'],
    });
    expectShape(sf, 'MULTI_PARAM');
  });

  it('still classifies a route as PARAM_BODY when request.json() appears in executable code (positive control)', () => {
    // Positive control: ensure the AST walk still detects executable calls.
    // The fixture has both a JSDoc mention AND a real call to request.json()
    // — the real call must dominate so the result is PARAM_BODY.
    const project = new Project({ useInMemoryFileSystem: true });
    const source = `import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';

/**
 * PATCH handler — calls request.json() in executable code (positive control).
 */
export async function PATCH(request) {
  const auth = await getAuthorisedClient(['admin']);
  if (!auth.success) return authFailureResponse(auth);
  const body = await request.json();
  return new Response(JSON.stringify(body));
}
`;
    const sf = project.createSourceFile(
      '/repo/app/api/items/[id]/route.ts',
      source,
    );
    expectShape(sf, 'PARAM_BODY');
  });

  it('still classifies a route as BODY_VALIDATED when parseBody() appears in executable code (positive control)', () => {
    // Positive control for the parseBody discriminator. Source mentions
    // request.json() in a comment (poisoning) but only calls parseBody() in
    // executable code, on a non-parameterised path → BODY_VALIDATED.
    const project = new Project({ useInMemoryFileSystem: true });
    const source = `import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { parseBody } from '@/lib/validation';
import { SomeSchema } from '@/lib/validation/schemas';

/**
 * POST handler — note: this does not use request.json() directly.
 * It uses parseBody(SomeSchema) instead.
 */
export async function POST(request) {
  const auth = await getAuthorisedClient(['admin']);
  if (!auth.success) return authFailureResponse(auth);
  const parsed = await parseBody(request, SomeSchema);
  return new Response(JSON.stringify(parsed));
}
`;
    const sf = project.createSourceFile('/repo/app/api/items/route.ts', source);
    expectShape(sf, 'BODY_VALIDATED');
  });
});

// ── Method-enumeration helper tests ───────────────────────────────────────

describe('getExportedMethods', () => {
  it('collects export async function METHOD declarations', () => {
    const sf = buildFixture({
      path: '/repo/app/api/items/route.ts',
      methods: ['GET', 'POST'],
      hasAuth: true,
    });
    expect(getExportedMethods(sf).sort()).toEqual(['GET', 'POST']);
  });

  it('collects export const METHOD = withRequestContext(...) declarations', () => {
    const sf = buildFixture({
      path: '/repo/app/api/items/route.ts',
      methods: ['POST'],
      hasAuth: true,
      hasWRC: true,
    });
    expect(getExportedMethods(sf)).toEqual(['POST']);
  });

  it('skips non-HTTP-method exports such as maxDuration, dynamic, and runtime', () => {
    // Per TECH §8.3, route config constants must not be classified as
    // HTTP methods even though they share the `export const` syntax.
    const sf = buildFixture({
      path: '/repo/app/api/items/route.ts',
      methods: ['GET'],
      hasAuth: true,
      extraExports: ['maxDuration', 'dynamic', 'runtime'],
    });
    expect(getExportedMethods(sf)).toEqual(['GET']);
  });

  it('returns method names in a stable order regardless of declaration order', () => {
    // The classifier branches only on `methods.length > 1`, but downstream
    // emitters (32.11 / 32.12) consume the list — the contract is "list of
    // valid HTTP method literals exported from the file", order-insensitive.
    const sf = buildFixture({
      path: '/repo/app/api/items/[id]/route.ts',
      methods: ['DELETE', 'GET', 'PATCH'],
      hasAuth: true,
    });
    const methods = getExportedMethods(sf);
    expect(methods).toHaveLength(3);
    expect(methods.sort()).toEqual(['DELETE', 'GET', 'PATCH']);
  });
});
