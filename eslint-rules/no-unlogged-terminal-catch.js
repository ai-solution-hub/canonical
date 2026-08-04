'use strict';

/**
 * no-unlogged-terminal-catch
 *
 * Flags a `catch` clause that returns a client-facing response (or emits an
 * SSE `error` event) WITHOUT first logging or rethrowing the caught error —
 * id-369 {369.6}, the fourth blind spot.
 *
 * The class: `catch (err) { return NextResponse.json({ error:
 * safeErrorMessage(err, '...') }, { status: 500 }) }`. Narrowing the error for
 * the client is CORRECT; the defect is that nothing logged it first, so the
 * cause is discarded at the request boundary — the last frame that could still
 * see it. Measured cost of one instance: weeks of red e2e runs across two
 * substrates, roughly a session to diagnose, one `logger.error` to prevent
 * (e2e-nightly run 30244345218).
 *
 * A catch is only reported when ALL of these hold:
 *   1. its body reaches a TERMINAL response — a `return` whose argument
 *      constructs the client response (`NextResponse.json(...)` /
 *      `Response.json(...)` / `new Response(...)` / `new
 *      NextResponse(...)`), or an SSE error emit (`send('error', ...)` /
 *      `emit('error', ...)`) — outside any nested function body. A response
 *      wrapped in a checked Result (`return { success: false, response }`)
 *      or assigned as a stub value is NOT terminal: a caller can still see
 *      that error;
 *   2. its body contains NO logging call (`logger.*`, `console.*`,
 *      `Sentry.captureException`, `logBestEffortWarn`, any `logX(...)` /
 *      `reportX(...)` helper) and NO `throw`, nested functions INCLUDED
 *      (leniency runs toward not-reporting);
 *   3. the catch param is not the deliberate-swallow opt-out — a `_`-prefixed
 *      binding (`catch (_err)`), the same convention `no-silent-promise-catch`
 *      and `caughtErrorsIgnorePattern` use. An OMITTED binding (`catch { }`)
 *      is NOT an opt-out: at a terminal boundary an unbound error cannot even
 *      be logged, which is the worst version of the shape.
 *
 * A catch that degrades locally (`return null`, `return { ok: false }`) is
 * deliberately out of scope — an outer frame can still see that error. So is
 * a response built by a helper (`return errorResponse(err)`): the helper may
 * log, and unrecognisable shapes stay unreported by design.
 *
 * Pattern-based — no type information. Companion to
 * `no-silent-promise-catch` (promise `.catch()`) and
 * `no-unchecked-supabase-error` (in-band PostgREST `{ error }`); neither can
 * reach this shape (proof pinned in tests/no-unlogged-terminal-catch.test.ts).
 */

/** Objects whose method calls count as logging: `logger.error(...)`, etc. */
const LOG_OBJECT_NAMES = new Set(['logger', 'console', 'Sentry']);

/**
 * Bare-identifier callees that count as logging. `logBestEffortWarn` is the
 * sanctioned telemetry helper; `captureException`/`captureMessage` cover
 * direct Sentry imports.
 */
const LOG_IDENTIFIER_CALLEES = new Set([
  'logBestEffortWarn',
  'captureException',
  'captureMessage',
]);

/**
 * Helper-shaped callees assumed to log: `logError(...)`,
 * `reportFailedAuditWrite(...)`. Assuming a `logX`/`reportX` helper logs can
 * only UNDER-report, which is the safe direction for this rule.
 */
const LOG_CALLEE_PATTERN = /^(log|report)[A-Z0-9_]/;

/** SSE emit callee names: `send('error', ...)`, `emit(...)`, `sendEvent(...)`. */
const SSE_EMIT_PATTERN = /^(send|emit)/i;

/** True if `node` (a CallExpression) is recognisably a logging call. */
function isLoggingCall(node) {
  const callee = node.callee;
  if (!callee) return false;
  if (callee.type === 'Identifier') {
    return (
      LOG_IDENTIFIER_CALLEES.has(callee.name) ||
      LOG_CALLEE_PATTERN.test(callee.name)
    );
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property &&
    callee.property.type === 'Identifier'
  ) {
    if (LOG_IDENTIFIER_CALLEES.has(callee.property.name)) return true;
    const obj = callee.object;
    if (obj.type === 'Identifier' && LOG_OBJECT_NAMES.has(obj.name))
      return true;
    // `this.logger.error(...)` / `ctx.logger.warn(...)`
    if (
      obj.type === 'MemberExpression' &&
      !obj.computed &&
      obj.property &&
      obj.property.type === 'Identifier' &&
      obj.property.name === 'logger'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * True if `node` constructs an HTTP response object:
 * `NextResponse.json(...)` (any static builder except `redirect`, which is
 * control flow rather than error narrowing), static `Response.json(...)`,
 * or `new Response(...)` / `new NextResponse(...)`.
 */
function isResponseConstruction(node) {
  if (node.type === 'NewExpression') {
    const callee = node.callee;
    return (
      callee &&
      callee.type === 'Identifier' &&
      (callee.name === 'Response' || callee.name === 'NextResponse')
    );
  }
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (
    callee &&
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object &&
    callee.object.type === 'Identifier' &&
    callee.property &&
    callee.property.type === 'Identifier'
  ) {
    if (
      callee.object.name === 'NextResponse' &&
      callee.property.name !== 'redirect'
    ) {
      return true;
    }
    if (callee.object.name === 'Response' && callee.property.name === 'json') {
      return true;
    }
  }
  return false;
}

/**
 * True if a ReturnStatement's ARGUMENT is a response construction — the
 * catch itself answering the client. The construction must be the returned
 * expression (through TS wrappers, ternaries and `??`/`||` fallbacks), not
 * merely appear somewhere in it: `return { success: false, response:
 * NextResponse.json(...) }` is a checked-Result degrade for a CALLER to
 * handle (lib/validation's `parseBody`), and `x = new Response(null, ...)`
 * builds a stub value (feed-poller's HEAD preflight) — neither is terminal.
 */
function returnsResponseConstruction(argument) {
  let cursor = argument;
  while (cursor) {
    switch (cursor.type) {
      case 'TSAsExpression':
      case 'TSNonNullExpression':
      case 'TSSatisfiesExpression':
        cursor = cursor.expression;
        continue;
      case 'AwaitExpression':
        cursor = cursor.argument;
        continue;
      case 'ConditionalExpression':
        return (
          returnsResponseConstruction(cursor.consequent) ||
          returnsResponseConstruction(cursor.alternate)
        );
      case 'LogicalExpression':
        return (
          returnsResponseConstruction(cursor.left) ||
          returnsResponseConstruction(cursor.right)
        );
      default:
        return isResponseConstruction(cursor);
    }
  }
  return false;
}

/**
 * True if `node` is a terminal-response signal: either a `return` whose
 * argument constructs the client response, or an SSE error emit
 * (`send('error', {...})` / `emit('error', ...)` / `sendEvent('error', ...)`
 * — callee name matching send/emit, first argument the literal 'error'),
 * which is effectful wherever it appears.
 */
function isTerminalResponseSignal(node) {
  if (node.type === 'ReturnStatement') {
    return node.argument ? returnsResponseConstruction(node.argument) : false;
  }

  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (!callee) return false;
  let calleeName = null;
  if (callee.type === 'Identifier') {
    calleeName = callee.name;
  } else if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property &&
    callee.property.type === 'Identifier'
  ) {
    calleeName = callee.property.name;
  }
  if (calleeName && SSE_EMIT_PATTERN.test(calleeName)) {
    const first = node.arguments && node.arguments[0];
    if (first && first.type === 'Literal' && first.value === 'error') {
      return true;
    }
  }
  return false;
}

/**
 * Generic AST walk. `visit` returns false to stop the walk (found).
 * When `skipNestedFunctions` is true, function bodies below `root` are not
 * entered — used for the terminal-response scan, where a `return` inside a
 * nested callback is not the catch answering the client.
 */
function findInSubtree(root, predicate, skipNestedFunctions) {
  function visit(node) {
    if (!node || typeof node.type !== 'string') return false;

    if (
      skipNestedFunctions &&
      node !== root &&
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression')
    ) {
      return false;
    }

    if (predicate(node)) return true;

    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const child = node[key];
      if (!child) continue;
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c.type === 'string' && visit(c)) return true;
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
        'Disallow a terminal `catch` that returns a client-facing response (NextResponse/Response/SSE error event) without logging or rethrowing the caught error first.',
    },
    messages: {
      unloggedTerminalCatch:
        "This catch answers the client without logging or rethrowing the caught error — the cause is discarded at the last frame that can see it, and an upstream failure becomes indistinguishable from a real regression. Log BEFORE narrowing: `logger.error({ err, op: '<operation>' }, '<what failed>')`, then return the client-safe response. If the swallow is deliberate, bind the error as `_err`.",
    },
    schema: [],
  },

  create(context) {
    return {
      CatchClause(node) {
        // Opt-out: `catch (_err)` — deliberate swallow, intent visible.
        // (An omitted binding is NOT an opt-out; see the header comment.)
        if (
          node.param &&
          node.param.type === 'Identifier' &&
          node.param.name.startsWith('_')
        ) {
          return;
        }

        // Gate 1 — terminal: the catch body answers the client directly
        // (nested function bodies excluded).
        const terminal = findInSubtree(
          node.body,
          isTerminalResponseSignal,
          true,
        );
        if (!terminal) return;

        // Gate 2 — escape: any logging call or `throw` anywhere in the catch
        // body (nested functions INCLUDED — leniency toward not-reporting).
        const escapes = findInSubtree(
          node.body,
          (n) =>
            n.type === 'ThrowStatement' ||
            (n.type === 'CallExpression' && isLoggingCall(n)),
          false,
        );
        if (escapes) return;

        context.report({ node, messageId: 'unloggedTerminalCatch' });
      },
    };
  },
};
