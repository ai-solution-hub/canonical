'use strict';

/**
 * no-supabase-record-cast
 *
 * Flags `TSAsExpression` nodes where the target type is
 * `Record<string, unknown>` or `Record<string, any>` AND the expression
 * originates from a Supabase query result.
 *
 * The rule is structural, not type-based — it walks AST shape and variable
 * declarations without requiring TypeScript type information, mirroring the
 * approach of `no-unchecked-supabase-error`.
 *
 * See docs/specs/ast-dataflow-tool/type-safety-pipeline/TECH.md
 * §ESLint rule design for the full design rationale.
 */

// ---------------------------------------------------------------------------
// JSONB column allowlist — casts on these member property names are legitimate
// because the column is genuinely `Json` in the schema and downstream code
// must cast to add structure. Bare column names (without table prefix) are
// used because member access does not carry table context at the AST level.
// Full inventory: TECH.md §JSONB column inventory.
// ---------------------------------------------------------------------------
const JSONB_BARE_COLUMNS = new Set([
  'domain_metadata',
  'summary_data',
  'domain_summaries',
  'theme_clusters',
  'performance_snapshot',
  'extraction_metadata',
  // Generic names shared across multiple JSONB tables — allowlist on bare
  // column name alone because the name is sufficiently distinctive.
  // `metadata` appears on: bid_response_history, bid_responses, content_history,
  // content_items, digests, entity_mentions, pipeline_runs, processing_queue.
  'metadata',
  'competitors',
  'current_value',
  'proposed_value',
  'payload',
  // ingestion_quality_log.details
  'details',
  // pipeline_runs.progress
  'progress',
  // pipeline_runs.result / processing_queue.result
  // Note: only allowlisted when accessed as `.result` member; plain `result`
  // variables are NOT covered (too broad).
  // 'result',  -- intentionally excluded: too generic
]);

// Regex covering test / spec / e2e file paths that are intentionally exempt.
const TEST_FILE_REGEX =
  /(__tests__|e2e|scripts[/\\]tests|\.(test|spec)\.[tj]sx?$)/;

// Supabase client names recognised as receiver identifiers.
const SUPABASE_RECEIVER_NAMES = new Set([
  'supabase',
  'sb',
  'client',
  'db',
  'mcpClient',
]);

// Array method names whose callbacks receive individual elements (Shape F2).
const ARRAY_ITERATOR_METHODS = new Set([
  'filter',
  'map',
  'forEach',
  'find',
  'findIndex',
  'some',
  'every',
  'reduce',
  'flatMap',
  'sort',
]);

// Array method names that produce a new array from an existing array (Shape F3).
const ARRAY_TRANSFORM_METHODS = new Set([
  'filter',
  'map',
  'flatMap',
  'slice',
  'concat',
  'sort',
  'reverse',
]);

// Supabase query chain method names that continue a chain
const SUPABASE_CHAIN_METHODS = new Set([
  'select',
  'eq',
  'neq',
  'in',
  'single',
  'maybeSingle',
  'limit',
  'order',
  'filter',
  'match',
  'range',
  'gte',
  'lte',
  'gt',
  'lt',
  'is',
  'contains',
  'update',
  'insert',
  'upsert',
  'delete',
  'textSearch',
  'overlaps',
  'not',
  'or',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return true if `typeAnnotation` matches `Record<string, unknown>` or
 * `Record<string, any>`.
 */
function isRecordStringUnknown(typeAnnotation) {
  if (!typeAnnotation) return false;
  if (typeAnnotation.type !== 'TSTypeReference') return false;
  const name = typeAnnotation.typeName?.name;
  if (name !== 'Record') return false;
  // TypeScript-ESTree uses `typeArguments` (not `typeParameters`) for type args
  // in TSTypeReference nodes.
  const params = (typeAnnotation.typeArguments ?? typeAnnotation.typeParameters)
    ?.params;
  if (!params || params.length !== 2) return false;
  const [k, v] = params;
  if (k.type !== 'TSStringKeyword') return false;
  return v.type === 'TSUnknownKeyword' || v.type === 'TSAnyKeyword';
}

/**
 * Return true if `typeAnnotation` matches `Record<string, unknown>[]` or
 * `Record<string, any>[]`.
 */
function isRecordStringUnknownArray(typeAnnotation) {
  if (!typeAnnotation) return false;
  if (typeAnnotation.type !== 'TSArrayType') return false;
  return isRecordStringUnknown(typeAnnotation.elementType);
}

/**
 * Return true if the node represents a Record<string, unknown> target type
 * or its union/array variants (e.g. `Record<string, unknown> | null` uses
 * TSUnionType wrapping).
 */
function isTargetRecordType(typeAnnotation) {
  if (!typeAnnotation) return false;
  if (
    isRecordStringUnknown(typeAnnotation) ||
    isRecordStringUnknownArray(typeAnnotation)
  ) {
    return true;
  }
  // Handle union: `Record<string, unknown> | null`
  if (typeAnnotation.type === 'TSUnionType') {
    return typeAnnotation.types.some(
      (t) => isRecordStringUnknown(t) || isRecordStringUnknownArray(t),
    );
  }
  return false;
}

/**
 * Return true if the identifier name looks like a Supabase client receiver.
 */
function isSupabaseReceiver(node) {
  if (!node) return false;
  if (node.type === 'Identifier' && SUPABASE_RECEIVER_NAMES.has(node.name)) {
    return true;
  }
  // `auth.supabase`, `extra.authInfo` etc. — check for `.supabase` member
  if (node.type === 'MemberExpression') {
    const prop = node.property;
    if (prop && prop.type === 'Identifier' && prop.name === 'supabase') {
      return true;
    }
  }
  return false;
}

/**
 * Walk a call chain AST looking for `.from(...)` or `.rpc(...)` on a
 * recognised Supabase receiver.  Returns true when found.
 *
 * The chain typically looks like:
 *   supabase.from('x').select(...).eq(...).single()
 * Walking backwards: single -> eq -> select -> from -> Identifier(supabase)
 */
function chainRootsAtSupabase(node) {
  if (!node) return false;

  let cursor = node;
  while (cursor) {
    if (cursor.type === 'CallExpression') {
      const callee = cursor.callee;
      if (!callee) return false;
      if (callee.type !== 'MemberExpression') return false;

      const prop = callee.property;
      if (!prop || prop.type !== 'Identifier') return false;

      if (prop.name === 'from' || prop.name === 'rpc') {
        // Verify the receiver object looks like a Supabase client
        return isSupabaseReceiver(callee.object);
      }

      if (SUPABASE_CHAIN_METHODS.has(prop.name)) {
        // Continue walking the chain
        cursor = callee.object;
        continue;
      }

      // Some other method — not a known Supabase chain
      return false;
    }

    if (cursor.type === 'MemberExpression') {
      // e.g. result.data — recurse into object
      cursor = cursor.object;
      continue;
    }

    // Reached a leaf (Identifier or other)
    return false;
  }
  return false;
}

/**
 * Given an expression node, walk up its AST (via `.parent`) to find the
 * enclosing function body.
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
 * Recursively search `root` for a VariableDeclarator that assigns `varName`
 * from an AwaitExpression of a Supabase chain.
 *
 * Handles three shapes:
 *   1. `const { data } = await supabase.from(...).select(...)`
 *   2. `const { data: rows } = await supabase.rpc(...)`
 *   3. `const result = await supabase.from(...).select(...)`
 *
 * Returns true if any such declaration is found.
 */
function declarationIsSupabaseOrigin(root, varName) {
  if (!root) return false;

  function visit(node) {
    if (!node || typeof node.type !== 'string') return false;

    if (node.type === 'VariableDeclarator') {
      const init = node.init;
      if (!init) return false;

      // Unwrap await
      const awaitArg = init.type === 'AwaitExpression' ? init.argument : null;
      const queryNode = awaitArg ?? init;

      if (!chainRootsAtSupabase(queryNode)) return false;

      const id = node.id;

      // Shape 3: `const result = await supabase...`
      if (id.type === 'Identifier' && id.name === varName) {
        return true;
      }

      // Shape 1 & 2: `const { data } = ...` or `const { data: rows } = ...`
      if (id.type === 'ObjectPattern') {
        for (const prop of id.properties) {
          if (prop.type !== 'Property') continue;
          const key = prop.key;
          const value = prop.value;
          if (!key || key.type !== 'Identifier') continue;

          // Shape 1: `{ data }` — key=data, value=Identifier(data)
          if (
            key.name === 'data' &&
            value.type === 'Identifier' &&
            value.name === varName
          ) {
            return true;
          }

          // Shape 2: `{ data: rows }` — key=data, value=Identifier(rows)
          if (
            key.name === 'data' &&
            value.type === 'Identifier' &&
            value.name === varName
          ) {
            return true;
          }
        }
      }

      return false;
    }

    // Skip nested functions — declarations inside closures are different scope
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
      } else if (typeof child === 'object' && typeof child.type === 'string') {
        if (visit(child)) return true;
      }
    }
    return false;
  }

  return visit(root);
}

/**
 * Return the member expression from a potentially-wrapped expression.
 * Handles `(expr ?? default)` by returning `expr`.
 */
function unwrapNullish(expression) {
  if (expression.type === 'LogicalExpression' && expression.operator === '??') {
    return expression.left;
  }
  return expression;
}

/**
 * Return true if `expression` is a JSONB-column member access that is
 * intentionally exempt.
 *
 * Handles:
 *   - `foo.domain_metadata`
 *   - `(foo.domain_metadata ?? {})`    ← unwrap nullish coalescing
 *   - `(foo.metadata ?? {})`           ← same
 */
function isJsonbAllowlisted(expression) {
  const inner = unwrapNullish(expression);
  if (inner.type !== 'MemberExpression') return false;
  const prop = inner.property;
  if (!prop || prop.type !== 'Identifier') return false;
  return JSONB_BARE_COLUMNS.has(prop.name);
}

/**
 * Return true if the expression is a third-party API response
 * (fetch / res.json / JSON.parse) — these are legitimate escape hatches.
 */
function isThirdPartyApiOrigin(expression) {
  if (!expression) return false;
  if (expression.type === 'AwaitExpression') {
    return isThirdPartyApiOrigin(expression.argument);
  }
  if (expression.type === 'CallExpression') {
    const callee = expression.callee;
    // `res.json()` / `response.text()`
    if (
      callee.type === 'MemberExpression' &&
      callee.property.type === 'Identifier' &&
      (callee.property.name === 'json' || callee.property.name === 'text')
    ) {
      return true;
    }
    // `JSON.parse(...)`
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'JSON' &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'parse'
    ) {
      return true;
    }
    // `JSON.stringify(data)` re-parse pattern
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'JSON' &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'stringify'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Given an identifier name that is a loop variable or callback parameter,
 * walk the parent chain from `castNode` (the TSAsExpression) upward to find:
 *
 *   F1. A ForOfStatement whose right-hand side (the iterable) is Supabase-origin.
 *       The loop variable name must match `varName`.
 *
 *   F2. An array-method CallExpression (e.g. `.filter(...)`, `.map(...)`) where
 *       the receiver is Supabase-origin and `varName` is the callback parameter.
 *
 * Returns true if either pattern is found.
 */
function isArrayElementOfSupabaseOrigin(castNode, varName, enclosingBody) {
  if (!castNode || !varName) return false;

  let cursor = castNode.parent;
  while (cursor) {
    // ---- F1: ForOfStatement ----
    // `for (const item of items) { ... (item as Record<...>) ... }`
    if (cursor.type === 'ForOfStatement') {
      const left = cursor.left;
      // left must be a VariableDeclaration whose declared id matches varName
      if (left && left.type === 'VariableDeclaration') {
        const decl = left.declarations[0];
        if (decl && decl.id && decl.id.type === 'Identifier' && decl.id.name === varName) {
          // right is the iterable — unwrap `?? []` if present
          let iterable = cursor.right;
          if (
            iterable &&
            iterable.type === 'LogicalExpression' &&
            iterable.operator === '??'
          ) {
            iterable = iterable.left;
          }
          // Check if iterable is an Identifier declared from Supabase
          if (iterable && iterable.type === 'Identifier' && enclosingBody) {
            if (declarationIsSupabaseOrigin(enclosingBody, iterable.name)) {
              return true;
            }
          }
          // Also handle direct chain: `for (const item of supabase.from(...).data)`
          if (iterable && chainRootsAtSupabase(iterable)) return true;
        }
      }
    }

    // ---- F2: Array method callback ----
    // `items.filter((item) => { ... (item as Record<...>) ... })`
    // The cast node is inside a callback function, which is an argument to a
    // CallExpression like `something.filter(callback)`.
    if (
      cursor.type === 'ArrowFunctionExpression' ||
      cursor.type === 'FunctionExpression'
    ) {
      // Check if this function has varName as a parameter
      const params = cursor.params ?? [];
      const hasParam = params.some(
        (p) =>
          p.type === 'Identifier' && p.name === varName,
      );

      if (hasParam) {
        // Check if the parent of this function is a CallExpression whose callee
        // is an array method (e.g. `.filter(...)`)
        const fnParent = cursor.parent;
        if (
          fnParent &&
          fnParent.type === 'CallExpression' &&
          fnParent.callee &&
          fnParent.callee.type === 'MemberExpression' &&
          fnParent.callee.property &&
          fnParent.callee.property.type === 'Identifier' &&
          ARRAY_ITERATOR_METHODS.has(fnParent.callee.property.name)
        ) {
          // The receiver of the method call is the array.
          // Use the OUTER function's body for scope-walking the receiver name —
          // the callback is a nested scope and `const { data: receiver }` is
          // declared in the outer async function, not inside the callback.
          const outerBody = findEnclosingBody(cursor);

          // The receiver of the method call is the array
          let receiver = fnParent.callee.object;
          // Unwrap `?? []` on receiver
          if (
            receiver &&
            receiver.type === 'LogicalExpression' &&
            receiver.operator === '??'
          ) {
            receiver = receiver.left;
          }
          // Check if receiver is Supabase-origin using the OUTER scope
          if (receiver && receiver.type === 'Identifier' && outerBody) {
            if (declarationIsSupabaseOrigin(outerBody, receiver.name)) {
              return true;
            }
          }
          if (receiver && chainRootsAtSupabase(receiver)) return true;

          // Also: receiver might itself be a chained call like
          // `supabase.from('x').select(...).filter(callback)` —
          // handle via chainRootsAtSupabase on the full CallExpression
          if (receiver && receiver.type === 'CallExpression') {
            if (chainRootsAtSupabase(receiver)) return true;
          }
        }
      }
    }

    // Stop at top-level function declarations — those define a true new scope
    // that the cast cannot reference. ArrowFunctionExpression and
    // FunctionExpression are checked above (they may be the callback itself).
    if (cursor.type === 'FunctionDeclaration') {
      break;
    }

    cursor = cursor.parent;
  }

  return false;
}

/**
 * Extend `declarationIsSupabaseOrigin` to handle element-of-array declarations:
 *   `const bestMatch = candidates[0]` where `candidates` is Supabase-origin.
 *
 * This handles Shape F3: an identifier declared from a subscript access of a
 * Supabase-origin array variable.
 */
function declarationIsArrayElementOfSupabaseOrigin(root, varName) {
  if (!root) return false;

  /**
   * Return true if `arrayName` resolves to an array that is derived (directly
   * or via array transform) from a Supabase query result.
   */
  function isArraySupabaseOrigin(arrayName) {
    if (!arrayName) return false;
    // Direct Supabase origin (data from query)
    if (declarationIsSupabaseOrigin(root, arrayName)) return true;

    // Indirect: `const arrayName = someOtherArray.filter(...)`
    // Find the declaration of arrayName and check if its init is an array transform
    // over a Supabase-origin array.
    return isDerivedFromSupabaseArray(root, arrayName);
  }

  function isDerivedFromSupabaseArray(searchRoot, name) {
    let found = false;

    function visit2(node) {
      if (!node || typeof node.type !== 'string') return;
      if (found) return;

      if (node.type === 'VariableDeclarator') {
        const id = node.id;
        const init = node.init;
        if (
          id &&
          id.type === 'Identifier' &&
          id.name === name &&
          init &&
          init.type === 'CallExpression' &&
          init.callee &&
          init.callee.type === 'MemberExpression' &&
          init.callee.property &&
          init.callee.property.type === 'Identifier' &&
          ARRAY_TRANSFORM_METHODS.has(init.callee.property.name) &&
          init.callee.object &&
          init.callee.object.type === 'Identifier'
        ) {
          // `const name = someArray.filter(...)` — check if someArray is Supabase-origin
          if (declarationIsSupabaseOrigin(searchRoot, init.callee.object.name)) {
            found = true;
          }
        }
        return;
      }

      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        return;
      }

      for (const key of Object.keys(node)) {
        if (key === 'parent') continue;
        const child = node[key];
        if (!child) continue;
        if (Array.isArray(child)) {
          for (const c of child) {
            if (c && typeof c.type === 'string') visit2(c);
          }
        } else if (typeof child === 'object' && typeof child.type === 'string') {
          visit2(child);
        }
      }
    }

    visit2(searchRoot);
    return found;
  }

  function visit(node) {
    if (!node || typeof node.type !== 'string') return false;

    if (node.type === 'VariableDeclarator') {
      const id = node.id;
      const init = node.init;

      if (
        id &&
        id.type === 'Identifier' &&
        id.name === varName &&
        init &&
        init.type === 'MemberExpression' &&
        init.computed === true &&
        init.object &&
        init.object.type === 'Identifier'
      ) {
        // `const varName = someArray[index]` — check if someArray is Supabase-origin
        // (directly or via array transforms like .filter())
        return isArraySupabaseOrigin(init.object.name);
      }

      return false;
    }

    // Skip nested functions
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
      } else if (typeof child === 'object' && typeof child.type === 'string') {
        if (visit(child)) return true;
      }
    }
    return false;
  }

  return visit(root);
}

/**
 * Walk `expression` to determine if it originates from a Supabase chain.
 * Handles shapes:
 *
 *   A. Direct chain:      `supabase.from('x').select(...).data`
 *   B. RPC chain:         `supabase.rpc('fn').data`
 *   C. Null-coalesce:     `(rows ?? [])` where rows is declared from Supabase
 *   D. Identifier:        `rows` declared via `const { data: rows } = await supabase...`
 *   E. MemberExpression:  `result.data` where result was awaited from Supabase
 *   F. Array element:     `item` from `for (const item of rows)` or `rows.map(item => ...)`
 *                         or `const bestMatch = candidates[0]` (subscript access)
 *
 * Shapes A and B are detected by `chainRootsAtSupabase`.
 * Shapes C, D, E require scope walking via `declarationIsSupabaseOrigin`.
 * Shape F requires parent-chain walking via `isArrayElementOfSupabaseOrigin`
 * and scope walking via `declarationIsArrayElementOfSupabaseOrigin`.
 */
function isSupabaseOriginExpression(expression, enclosingBody, castNode) {
  if (!expression) return false;

  // ---- Shape A / B: inline chain expression ----
  if (
    expression.type === 'CallExpression' ||
    (expression.type === 'MemberExpression' &&
      expression.property.type === 'Identifier' &&
      expression.property.name === 'data')
  ) {
    if (chainRootsAtSupabase(expression)) return true;
  }

  // ---- Shape C: `(expr ?? [])` or `(expr ?? {})` ----
  if (expression.type === 'LogicalExpression' && expression.operator === '??') {
    return isSupabaseOriginExpression(expression.left, enclosingBody, castNode);
  }

  // ---- Shape D / E: identifier or member access ----
  if (
    expression.type === 'Identifier' ||
    expression.type === 'MemberExpression'
  ) {
    // Get the root identifier name
    let identName = null;
    if (expression.type === 'Identifier') {
      identName = expression.name;
    } else if (
      expression.type === 'MemberExpression' &&
      expression.object.type === 'Identifier'
    ) {
      // `result.data` — check if `result` was assigned from Supabase
      identName = expression.object.name;
    }

    if (identName && enclosingBody) {
      if (declarationIsSupabaseOrigin(enclosingBody, identName)) return true;

      // ---- Shape F: array element — loop var, callback param, subscript ----
      if (
        isArrayElementOfSupabaseOrigin(castNode, identName, enclosingBody)
      ) {
        return true;
      }

      // ---- Shape F3: subscript element `const x = arr[0]` ----
      if (declarationIsArrayElementOfSupabaseOrigin(enclosingBody, identName)) {
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow casting Supabase query results to Record<string, unknown>. ' +
        'Use the typed row shape from database.types.ts directly.',
    },
    messages: {
      recordCast:
        'Casting a Supabase result to Record<string, unknown> discards the ' +
        'typed row shape from database.types.ts. Remove the cast and use ' +
        'direct property access — typed RPCs already narrow. If the cast ' +
        'targets a JSONB column, add the column name to the JSONB allowlist ' +
        'in eslint-rules/no-supabase-record-cast.js. If unavoidable, ' +
        'suppress with an inline justification comment.',
    },
    schema: [],
  },

  create(context) {
    // Exempt test and spec files
    if (TEST_FILE_REGEX.test(context.getFilename())) return {};

    return {
      TSAsExpression(node) {
        // Must be casting to Record<string, unknown> (or union/array thereof)
        if (!isTargetRecordType(node.typeAnnotation)) return;

        const expression = node.expression;

        // Exempt JSONB column member accesses
        if (isJsonbAllowlisted(expression)) return;

        // Exempt third-party API responses
        if (isThirdPartyApiOrigin(expression)) return;

        // Find the enclosing function body for scope walking
        const enclosingBody = findEnclosingBody(node);

        // Flag if expression originates from a Supabase chain
        if (isSupabaseOriginExpression(expression, enclosingBody, node)) {
          context.report({ node, messageId: 'recordCast' });
        }
      },
    };
  },
};
