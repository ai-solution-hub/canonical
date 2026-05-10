'use strict';

/**
 * no-unvalidated-route-input
 *
 * Flags Next.js route-handler exports (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS)
 * whose body consumes untrusted input (request body, URL search params, or
 * dynamic path params) without any recognised KH input-validation pattern.
 *
 * Recognised validation patterns (per S228 audit, see
 * docs/plans/phase-0-investigation/0.9-spike-S13-eslint-input-required.md):
 *   - Zod helpers:  parseBody / parseBodyAsync / parseSearchParams from
 *                   @/lib/validation
 *   - Direct Zod:   `.parse(` / `.safeParse(` / `.parseAsync(` /
 *                   `.safeParseAsync(` on a schema-shaped identifier
 *   - UUID guards:  `UUID_RE.test(...)` / `uuidRegex.test(...)` / `isUuid(...)`
 *   - Schema utils: validateEditableField, parsePairId (returns null on
 *                   invalid input — structural validator)
 *   - Path sanitiser: escapePostgrestValue (defensive only, but considered
 *                   acceptable when combined with Postgres type coercion)
 *
 * Pattern-based — no type information. Mirrors the design of the existing
 * `no-unchecked-supabase-error` and `no-silent-promise-catch` rules.
 *
 * Spike output:
 * docs/plans/phase-0-investigation/0.9-spike-S13-eslint-input-required.md
 */

const HTTP_VERB_EXPORTS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

const VALIDATION_CALL_NAMES = new Set([
  'parseBody',
  'parseBodyAsync',
  'parseSearchParams',
  'validateEditableField',
  'parsePairId',
  'escapePostgrestValue',
  'isUuid',
  'isUUID',
]);

/**
 * Identifiers that look like regex validators by naming convention. We treat
 * any `.test(...)` call whose receiver matches one of these patterns as a
 * validation step — this avoids the per-route-specific identifier whitelist
 * trap (e.g. `SLUG_RE`, `EMAIL_RE`, `WORKSPACE_KEY_RE` etc.) the rule would
 * otherwise force.
 */
const REGEX_IDENTIFIER_PATTERN = /^([A-Z][A-Z0-9_]*_RE|[A-Z][A-Z0-9_]*_REGEX|[a-z][A-Za-z0-9]*Regex)$/;

const REQUEST_RECEIVER_NAMES = new Set([
  'request',
  'req',
  '_request',
  '_req',
]);

const BODY_CONSUMER_METHODS = new Set([
  'json',
  'formData',
  'text',
  'arrayBuffer',
]);

/**
 * Returns the function node if `node` is an HTTP-verb route export, else null.
 *
 *   export async function GET(...) { ... }
 *   export const GET = async (...) => { ... }
 */
function isRouteHandlerExport(node) {
  if (node.type !== 'ExportNamedDeclaration' || !node.declaration) return null;
  const decl = node.declaration;
  if (
    decl.type === 'FunctionDeclaration' &&
    decl.id &&
    HTTP_VERB_EXPORTS.has(decl.id.name)
  ) {
    return { fn: decl, name: decl.id.name };
  }
  if (decl.type === 'VariableDeclaration') {
    for (const v of decl.declarations) {
      if (
        v.id &&
        v.id.type === 'Identifier' &&
        HTTP_VERB_EXPORTS.has(v.id.name) &&
        v.init &&
        (v.init.type === 'ArrowFunctionExpression' ||
          v.init.type === 'FunctionExpression')
      ) {
        return { fn: v.init, name: v.id.name };
      }
    }
  }
  return null;
}

/**
 * Walk the route-handler body looking for evidence of input consumption AND
 * any recognised validation pattern.
 */
function inspectFunctionBody(body) {
  let consumesInput = false;
  let hasValidation = false;

  function visit(node) {
    if (!node || typeof node.type !== 'string') return;

    // --- Input consumption ---
    // `request.json()`, `req.formData()`, etc.
    if (
      node.type === 'CallExpression' &&
      node.callee &&
      node.callee.type === 'MemberExpression' &&
      node.callee.property &&
      node.callee.property.type === 'Identifier' &&
      BODY_CONSUMER_METHODS.has(node.callee.property.name) &&
      node.callee.object &&
      node.callee.object.type === 'Identifier' &&
      REQUEST_RECEIVER_NAMES.has(node.callee.object.name)
    ) {
      consumesInput = true;
    }

    // `await params` (dynamic path-param consumption)
    if (
      node.type === 'AwaitExpression' &&
      node.argument &&
      node.argument.type === 'Identifier' &&
      node.argument.name === 'params'
    ) {
      consumesInput = true;
    }

    // `searchParams` reference (URL query consumption)
    if (node.type === 'Identifier' && node.name === 'searchParams') {
      consumesInput = true;
    }

    // Member: `.searchParams` (covers `req.nextUrl.searchParams`)
    if (
      node.type === 'MemberExpression' &&
      node.property &&
      node.property.type === 'Identifier' &&
      node.property.name === 'searchParams'
    ) {
      consumesInput = true;
    }

    // --- Validation patterns ---
    if (node.type === 'CallExpression' && node.callee) {
      // Direct call: `parseBody(...)`, `parsePairId(...)`, `isUuid(...)`
      if (
        node.callee.type === 'Identifier' &&
        VALIDATION_CALL_NAMES.has(node.callee.name)
      ) {
        hasValidation = true;
      }
      // Member call: `schema.parse(...)`, `schema.safeParse(...)`
      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property &&
        node.callee.property.type === 'Identifier'
      ) {
        const methodName = node.callee.property.name;
        if (
          methodName === 'parse' ||
          methodName === 'safeParse' ||
          methodName === 'parseAsync' ||
          methodName === 'safeParseAsync'
        ) {
          hasValidation = true;
        }
        // `UUID_RE.test(...)`, `SLUG_RE.test(...)`, `uuidRegex.test(...)`
        // — anything matching the naming convention is treated as a regex
        // validator. See REGEX_IDENTIFIER_PATTERN.
        if (
          methodName === 'test' &&
          node.callee.object &&
          node.callee.object.type === 'Identifier' &&
          REGEX_IDENTIFIER_PATTERN.test(node.callee.object.name)
        ) {
          hasValidation = true;
        }
      }
    }

    // Walk children; do not skip nested function bodies because handlers may
    // call validation helpers inside try/catch blocks or sub-functions.
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const child = node[key];
      if (!child) continue;
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c.type === 'string') visit(c);
        }
      } else if (typeof child.type === 'string') {
        visit(child);
      }
    }
  }

  visit(body);
  return { consumesInput, hasValidation };
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Next.js route handlers that consume request input (body, query, or path params) without a recognised KH input-validation pattern (Zod helpers, UUID guards, parse* helpers).',
    },
    messages: {
      missingInputValidation:
        'Route handler `{{ name }}` consumes request input but has no recognised input-validation pattern. Use `parseBody` / `parseSearchParams` from `@/lib/validation`, a Zod schema `.parse()/.safeParse()`, or a UUID guard (`UUID_RE.test(...)` / `parsePairId(...)`). See docs/plans/phase-0-investigation/0.9-spike-S13-eslint-input-required.md.',
    },
    schema: [],
  },

  create(context) {
    return {
      ExportNamedDeclaration(node) {
        const match = isRouteHandlerExport(node);
        if (!match) return;
        const { fn, name } = match;
        if (!fn.body) return;

        const { consumesInput, hasValidation } = inspectFunctionBody(fn.body);
        if (consumesInput && !hasValidation) {
          context.report({
            node: fn,
            messageId: 'missingInputValidation',
            data: { name },
          });
        }
      },
    };
  },
};
