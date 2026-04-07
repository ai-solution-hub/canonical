'use strict';

/**
 * no-silent-promise-catch
 *
 * Flags `.catch()` calls whose handler is a zero-parameter arrow or function
 * expression — i.e. silently swallowing a promise rejection.
 *
 * Pattern-based — no type information. See
 * docs/specs/silent-failure-prevention-spec.md §5.5.1 for the full design.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `.catch()` with a zero-argument arrow/function (silent error swallow). Use `logBestEffortWarn(category, message)` from `@/lib/supabase/telemetry` instead.',
    },
    messages: {
      silentCatch:
        'Silently swallowing a promise rejection is a silent-failure bug. Accept the error parameter and log via `logBestEffortWarn(category, message, { err })` from `@/lib/supabase/telemetry`. If the swallow is intentional, use `(_err) => ...` to make the intent explicit.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'catch'
        )
          return;
        if (node.arguments.length !== 1) return;
        const arg = node.arguments[0];
        if (
          (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') &&
          arg.params.length === 0
        ) {
          context.report({ node: arg, messageId: 'silentCatch' });
        }
      },
    };
  },
};
