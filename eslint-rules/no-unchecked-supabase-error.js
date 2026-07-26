'use strict';

/**
 * no-unchecked-supabase-error
 *
 * Flags any `await` on a Supabase query (`supabase.from(...)`, `.rpc(...)`, or
 * its `sb` / `client` / `db` / `serviceClient` / `auth.supabase` aliases)
 * where the response `error` field is silently dropped.
 *
 * Receivers are recognised two ways ({369.3} RC-2):
 *   1. by ORIGIN — the variable is initialised (directly or via
 *      destructuring) from a known client factory (`createClient`,
 *      `createServiceClient`, `createMcpClient`, ... — any
 *      `create*Client` callee), or is annotated with a Supabase client
 *      type (`SupabaseClient<...>`, `DbClient`, `Supabase`);
 *   2. by NAME — fallback for receivers whose origin cannot be resolved
 *      in-file (imported instances, untyped params).
 *
 * Both destructures/assignments that drop `error` AND bare `await` statements
 * that discard the whole response ({369.3} RC-1) are reported — PostgREST
 * returns failures in-band as `{ error }`, it does not throw.
 *
 * Pattern-based — no type-checker. See
 * docs/specs/silent-failure-prevention-spec.md §5.5 for the full design.
 */

const PG_RECEIVER_NAMES = new Set([
  'supabase',
  'sb',
  'client',
  'db',
  'serviceClient',
]);

/**
 * Client factory callees ({369.3} RC-2). Matches `createClient`,
 * `createServiceClient`, `createMcpClient`, `createMcpUserClient`, and any
 * future `create*Client` factory. A false positive requires BOTH a
 * factory-shaped callee AND a `.from(...)` / `.rpc(...)` call on the result,
 * which non-Supabase clients do not have.
 */
const CLIENT_FACTORY_PATTERN = /^create[A-Za-z0-9_]*Client$/;

/**
 * Type-annotation names that identify a Supabase client parameter/variable.
 * Covers `SupabaseClient<Database>` plus the codebase's local aliases
 * (`DbClient`, `Supabase`, `SupabaseClientTyped`).
 */
function isClientTypeName(name) {
  return (
    name === 'Supabase' ||
    name === 'DbClient' ||
    name.includes('SupabaseClient')
  );
}

/**
 * Unwraps TS expression wrappers and `await` so factory detection sees the
 * underlying CallExpression: `await createClient()`,
 * `createServiceClient() as X`, `createClient()!` all resolve to the call.
 */
function unwrapExpression(node) {
  let cursor = node;
  while (cursor) {
    if (cursor.type === 'AwaitExpression') {
      cursor = cursor.argument;
    } else if (
      cursor.type === 'TSAsExpression' ||
      cursor.type === 'TSNonNullExpression' ||
      cursor.type === 'TSSatisfiesExpression'
    ) {
      cursor = cursor.expression;
    } else {
      return cursor;
    }
  }
  return cursor;
}

/** True if `node` (after unwrapping) is a `create*Client(...)` call. */
function isClientFactoryCall(node) {
  const call = unwrapExpression(node);
  if (!call || call.type !== 'CallExpression') return false;
  const callee = call.callee;
  if (!callee) return false;
  if (callee.type === 'Identifier') {
    return CLIENT_FACTORY_PATTERN.test(callee.name);
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property &&
    callee.property.type === 'Identifier'
  ) {
    return CLIENT_FACTORY_PATTERN.test(callee.property.name);
  }
  return false;
}

/**
 * True if an Identifier pattern node carries a Supabase-client TS type
 * annotation (`supabase: SupabaseClient<Database>`). Only meaningful when
 * the file is parsed with the TypeScript parser; espree ASTs simply have no
 * `typeAnnotation` and fall through to the name fallback.
 */
function hasClientTypeAnnotation(idNode) {
  const ann = idNode && idNode.typeAnnotation;
  const t = ann && ann.typeAnnotation;
  if (!t || t.type !== 'TSTypeReference') return false;
  const typeName = t.typeName;
  if (!typeName) return false;
  if (typeName.type === 'Identifier') return isClientTypeName(typeName.name);
  // Qualified: `supabaseJs.SupabaseClient`
  if (
    typeName.type === 'TSQualifiedName' &&
    typeName.right.type === 'Identifier'
  ) {
    return isClientTypeName(typeName.right.name);
  }
  return false;
}

/** Walks the scope chain upward resolving `name` to its Variable, if any. */
function resolveVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    const v = s.set.get(name);
    if (v) return v;
  }
  return null;
}

/**
 * RC-2 origin resolution: true if `variable` is initialised from a client
 * factory (directly, via `await`, or via destructuring a `supabase` /
 * `client` / `serviceClient` property from e.g. a `getAuthorisedClient()`
 * result), or is a parameter/variable annotated with a client type.
 */
function isSupabaseClientVariable(variable) {
  for (const def of variable.defs) {
    if (def.type === 'Variable') {
      const decl = def.node; // VariableDeclarator
      if (
        decl.id &&
        decl.id.type === 'Identifier' &&
        hasClientTypeAnnotation(decl.id)
      ) {
        return true;
      }
      if (decl.id && decl.id.type === 'ObjectPattern') {
        // `const { supabase } = auth` / `const { client: c } = result` —
        // the destructured KEY identifies the client, whatever the local
        // binding is renamed to.
        for (const p of decl.id.properties) {
          if (p.type !== 'Property') continue;
          let value = p.value;
          if (value && value.type === 'AssignmentPattern') value = value.left;
          if (
            value &&
            value.type === 'Identifier' &&
            value.name === variable.name &&
            p.key &&
            p.key.type === 'Identifier' &&
            (p.key.name === 'supabase' ||
              p.key.name === 'client' ||
              p.key.name === 'serviceClient')
          ) {
            return true;
          }
        }
        continue;
      }
      if (decl.init && isClientFactoryCall(decl.init)) return true;
    } else if (def.type === 'Parameter') {
      // `function f(sc: SupabaseClient<Database>)`
      if (hasClientTypeAnnotation(def.name)) return true;
      // `function f(sc = createServiceClient())`
      const parent = def.name && def.name.parent;
      if (
        parent &&
        parent.type === 'AssignmentPattern' &&
        parent.right &&
        isClientFactoryCall(parent.right)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns true if `node` matches a recognised PostgREST receiver —
 *   - an Identifier in the name allowlist (`supabase` / `sb` / `client` /
 *     `db` / `serviceClient`),
 *   - an Identifier whose ORIGIN resolves to a client factory or a
 *     client-typed binding ({369.3} RC-2), or
 *   - a MemberExpression whose property is `supabase` (`auth.supabase`,
 *     `args.supabase`, `this.supabase` — auth/context results carry the
 *     client under that key).
 *
 * Because the walker descends through CallExpression chains, this is
 * normally called on the very last object in the chain: e.g. for
 *   supabase.from('x').select().eq('id', 1)
 * the walker descends select -> from -> MemberExpression(supabase.from) ->
 * object=Identifier('supabase'), which is where `isReceiver` fires.
 */
function isReceiver(node, context) {
  if (!node) return false;
  if (node.type === 'Identifier') {
    if (PG_RECEIVER_NAMES.has(node.name)) return true;
    // RC-2 — resolve the receiver by origin.
    const sourceCode = context.sourceCode;
    if (!sourceCode || typeof sourceCode.getScope !== 'function') return false;
    const variable = resolveVariable(sourceCode.getScope(node), node.name);
    return variable ? isSupabaseClientVariable(variable) : false;
  }
  if (node.type === 'MemberExpression') {
    const prop = node.property;
    if (!prop || prop.type !== 'Identifier' || node.computed) return false;
    // `auth.supabase` / `args.supabase` / `this.supabase` — a property
    // named `supabase` that `.from()`/`.rpc()` is called on is a client.
    // NB deliberately NOT `.storage` — `x.storage.from('bucket')` is the
    // Storage API, whose `.from` names a bucket, not a table.
    return prop.name === 'supabase';
  }
  return false;
}

/**
 * Given an AwaitExpression whose argument is a CallExpression chain, walk the
 * chain looking for the base MemberExpression. This is how we detect
 * `.from(...)` / `.rpc(...)` receivers even when the chain is wrapped in
 * extra calls like `.select().eq().limit()`.
 */
function chainRootsAtPostgrestReceiver(awaitArg, context) {
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
    if (
      prop &&
      prop.type === 'Identifier' &&
      (prop.name === 'from' || prop.name === 'rpc')
    ) {
      // This call IS the `.from(...)` / `.rpc(...)` call. Check the receiver.
      return isReceiver(callee.object, context);
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
        'Disallow destructuring `data` from a Supabase query without also handling `error` (use `sb()` or destructure `{ data, error }`), and disallow bare `await` statements that discard the query response entirely.',
    },
    messages: {
      missingErrorDestructure:
        'Destructuring `data` from a Supabase query without `error` is a silent-failure bug. Use `sb()` from `@/lib/supabase/safe` or destructure `{ data, error }` and check `error`.',
      uncheckedResultVariable:
        'Assigning a Supabase query result to `{{ name }}` without checking `{{ name }}.error` is a silent-failure bug. Use `sb()` from `@/lib/supabase/safe`.',
      discardedQueryResult:
        'Awaiting a Supabase query as a bare statement discards the in-band `{ error }` — PostgREST reports failures in the response, it does not throw. Use `sb()` from `@/lib/supabase/safe`, or capture the result and check `.error`.',
    },
    schema: [],
  },

  create(context) {
    return {
      // RC-1 — a bare `await supabase.from(x).update(...)` statement with no
      // assignment discards the whole response, `error` included.
      ExpressionStatement(node) {
        const expr = node.expression;
        if (!expr || expr.type !== 'AwaitExpression') return;
        const awaitArg = expr.argument;
        if (!awaitArg) return;
        if (!chainRootsAtPostgrestReceiver(awaitArg, context)) return;

        context.report({
          node: expr,
          messageId: 'discardedQueryResult',
        });
      },

      VariableDeclarator(node) {
        if (!node.init || node.init.type !== 'AwaitExpression') return;

        const awaitArg = node.init.argument;
        if (!awaitArg) return;
        if (!chainRootsAtPostgrestReceiver(awaitArg, context)) return;

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
            context.report({
              node: node.id,
              messageId: 'missingErrorDestructure',
            });
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
