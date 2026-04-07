'use strict';

/**
 * no-unchecked-supabase-error
 *
 * Flags any `await` on a Supabase query (`supabase.from(...)`, `.rpc(...)`, or
 * its `sb` / `client` / `db` / `auth.supabase` aliases) where the response
 * `error` field is silently dropped.
 *
 * Pattern-based — no type information. See
 * docs/specs/silent-failure-prevention-spec.md §5.5 for the full design.
 */

const PG_RECEIVER_NAMES = new Set(['supabase', 'sb', 'client', 'db']);

/**
 * Returns true if `node` matches a recognised PostgREST receiver —
 *   - an Identifier named `supabase` / `sb` / `client` / `db`, or
 *   - a MemberExpression like `auth.supabase`.
 *
 * Because the walker above descends through CallExpression chains, this is
 * normally called on the very last object in the chain: e.g. for
 *   supabase.from('x').select().eq('id', 1)
 * the walker descends select -> from -> MemberExpression(supabase.from) ->
 * object=Identifier('supabase'), which is where `isReceiver` fires.
 */
function isReceiver(node) {
  if (!node) return false;
  if (node.type === 'Identifier') {
    return PG_RECEIVER_NAMES.has(node.name);
  }
  if (node.type === 'MemberExpression') {
    // Handle `auth.supabase` (object=auth, property=supabase).
    const obj = node.object;
    const prop = node.property;
    if (!obj || !prop || prop.type !== 'Identifier') return false;
    if (obj.type !== 'Identifier') return false;
    return obj.name === 'auth' && prop.name === 'supabase';
  }
  return false;
}

/**
 * Given an AwaitExpression whose argument is a CallExpression chain, walk the
 * chain looking for the base MemberExpression. This is how we detect
 * `.from(...)` / `.rpc(...)` receivers even when the chain is wrapped in
 * extra calls like `.select().eq().limit()`.
 */
function chainRootsAtPostgrestReceiver(awaitArg) {
  let cursor = awaitArg;
  while (cursor && cursor.type === 'CallExpression') {
    const callee = cursor.callee;
    if (!callee) return false;
    if (callee.type === 'Identifier') {
      // Direct call — `sb(...)` / `tryQuery(...)` / user helper. Not a raw query.
      return false;
    }
    if (callee.type !== 'MemberExpression') return false;

    const prop = callee.property;
    if (prop && prop.type === 'Identifier' && (prop.name === 'from' || prop.name === 'rpc')) {
      // This call IS the `.from(...)` / `.rpc(...)` call. Check the receiver.
      return isReceiver(callee.object);
    }

    cursor = callee.object;
  }
  return false;
}

/**
 * Finds the nearest enclosing function body (or Program) so we can scan it
 * for `<name>.error` reads.
 */
function findEnclosingBody(node) {
  let cursor = node.parent;
  while (cursor) {
    if (
      cursor.type === 'FunctionDeclaration' ||
      cursor.type === 'FunctionExpression' ||
      cursor.type === 'ArrowFunctionExpression'
    ) {
      return cursor.body;
    }
    if (cursor.type === 'Program') return cursor;
    cursor = cursor.parent;
  }
  return null;
}

/**
 * Recursively walks `root`'s AST (skipping nested function bodies) searching
 * for a MemberExpression of the form `<name>.error`. Returns true if one is
 * found.
 */
function containsErrorRead(root, name, skipNode) {
  if (!root) return false;

  function visit(node) {
    if (!node || typeof node.type !== 'string') return false;
    if (node === skipNode) return false;

    if (node.type === 'MemberExpression') {
      const obj = node.object;
      const prop = node.property;
      if (
        obj &&
        obj.type === 'Identifier' &&
        obj.name === name &&
        prop &&
        prop.type === 'Identifier' &&
        prop.name === 'error' &&
        !node.computed
      ) {
        return true;
      }
    }

    // Skip nested function bodies — a reference inside a closure does not
    // count as "the caller checked the error".
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      return false;
    }

    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const child = node[key];
      if (!child) continue;
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c.type === 'string') {
            if (visit(c)) return true;
          }
        }
      } else if (typeof child.type === 'string') {
        if (visit(child)) return true;
      }
    }
    return false;
  }

  return visit(root);
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow destructuring `data` from a Supabase query without also handling `error` (use `sb()` or destructure `{ data, error }`).',
    },
    messages: {
      missingErrorDestructure:
        'Destructuring `data` from a Supabase query without `error` is a silent-failure bug. Use `sb()` from `@/lib/supabase/safe` or destructure `{ data, error }` and check `error`.',
      uncheckedResultVariable:
        'Assigning a Supabase query result to `{{ name }}` without checking `{{ name }}.error` is a silent-failure bug. Use `sb()` from `@/lib/supabase/safe`.',
    },
    schema: [],
  },

  create(context) {
    return {
      VariableDeclarator(node) {
        if (!node.init || node.init.type !== 'AwaitExpression') return;

        const awaitArg = node.init.argument;
        if (!awaitArg) return;
        if (!chainRootsAtPostgrestReceiver(awaitArg)) return;

        // Case 1 & 2 — ObjectPattern destructure
        if (node.id.type === 'ObjectPattern') {
          const hasData = node.id.properties.some(
            (p) =>
              p.type === 'Property' &&
              p.key &&
              p.key.type === 'Identifier' &&
              p.key.name === 'data',
          );
          const hasError = node.id.properties.some(
            (p) =>
              p.type === 'Property' &&
              p.key &&
              p.key.type === 'Identifier' &&
              p.key.name === 'error',
          );

          if (hasData && !hasError) {
            context.report({ node: node.id, messageId: 'missingErrorDestructure' });
          }
          return;
        }

        // Case 3 — plain Identifier binding
        if (node.id.type === 'Identifier') {
          const name = node.id.name;
          const body = findEnclosingBody(node);
          if (!body) {
            // No enclosing scope we can safely walk — conservatively report.
            context.report({
              node: node.id,
              messageId: 'uncheckedResultVariable',
              data: { name },
            });
            return;
          }
          if (!containsErrorRead(body, name, node)) {
            context.report({
              node: node.id,
              messageId: 'uncheckedResultVariable',
              data: { name },
            });
          }
        }
      },
    };
  },
};
