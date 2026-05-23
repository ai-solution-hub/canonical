/**
 * `rewrite-multi-method.ts` — multi-method handler rewrite for the
 * `wrap-define-route` codemod.
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §2.4 (handler
 *     rewrite — Step A import-add + Step B function/variable replace) —
 *     each exported method on a multi-method route is rewritten independently
 *     by delegating to Subtask 32.10's `rewriteSingleMethod`.
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §6.2
 *     (NeedsManualEntry / NeedsManualReason schema) — one entry per affected
 *     method with reason `MULTI_METHOD_SCHEMA`.
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md AC-7
 *     (withRequestContext outer-wrap preserved per-method — inherited from
 *     `rewriteSingleMethod`'s +WRC branch).
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PLAN.md §4 Subtask 32.11.
 *
 * Scope (Subtask 32.11): the three multi-method NEEDS-REVIEW shapes —
 * `MULTI_PARAM_BODY` (GET+PATCH+DELETE), `MULTI_BODY` (GET+POST), and
 * `MULTI_PARAM` (GET+DELETE) — plus their `+WRC` sub-variants. The shape's
 * per-method dispatch is intentionally thin: this module composes 32.10's
 * `rewriteSingleMethod` once per exported method (passing a per-method
 * inferred schema) and emits one `NeedsManualEntry` per method so the
 * codemod-needs-manual.json artefact (Subtask 32.12) carries a record per
 * (route, method) pair.
 *
 * Out of scope:
 *   - The single-method rewrites themselves (Subtask 32.10's
 *     `rewriteSingleMethod`).
 *   - The per-method schema inference (Subtask 32.8 / 32.9 — Source A / B).
 *     The caller provides a `Record<method, InferSchemaResult>` mapping.
 *   - Already-wrapped idempotency-skip detection (Subtask 32.13's
 *     `isAlreadyWrapped`; this module assumes the caller has already
 *     guarded the no-op case).
 *   - `sf.save()` — apply-mode disk writes are Subtask 32.14.
 *   - The needs-manual.json file write itself (Subtask 32.12's
 *     `emitNeedsManualReport`). This module returns the entries; the caller
 *     merges them with the per-shape mapping from `reasonForShape`.
 */

import type { SourceFile } from 'ts-morph';
import type { NeedsManualEntry } from './emit-needs-manual';
import type { InferSchemaResult } from './inference-source-a';
import { rewriteSingleMethod } from './rewrite-single-method';
import type { RouteShape } from './types';

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Rewrite each exported method of a multi-method route independently and
 * return one `NeedsManualEntry` per method (reason `MULTI_METHOD_SCHEMA`).
 *
 * @param sf          The route's source file. Mutated in place; caller is
 *                    responsible for `sf.save()` (apply mode, Subtask 32.14).
 * @param methods     The HTTP method names exported by the route. Typically
 *                    the output of `getExportedMethods(sf)` (Subtask 32.6).
 *                    Order is the iteration order of the per-method dispatch
 *                    loop — preserved verbatim in the returned entries.
 * @param schemas     Per-method inference results, keyed by method name.
 *                    The caller is responsible for resolving each method's
 *                    schema independently (Source A / B / C per TECH §3).
 *                    Methods missing from this map default to the
 *                    `z.unknown()` + `NEEDS_SCHEMA` fall-back so the rewrite
 *                    still produces a syntactically valid output with the
 *                    AC-6 TODO comment in place.
 * @param route       The repo-relative POSIX path of the route file
 *                    (e.g. `app/api/items/[id]/route.ts`). Embedded verbatim
 *                    into each returned `NeedsManualEntry.route` field. The
 *                    caller already computes this via
 *                    `toRepoRelativePosixPath()` in `wrap-define-route.ts`.
 * @param shape       The `RouteShape` literal returned by `classifyRoute()`
 *                    for this route. One of the multi-method variants
 *                    (`MULTI_PARAM_BODY` / `MULTI_BODY` / `MULTI_PARAM` and
 *                    their `+WRC` sub-variants). Embedded verbatim into each
 *                    returned `NeedsManualEntry.shape` field.
 *
 * @returns One `NeedsManualEntry` per method in iteration order. Each entry
 *          carries the route path, the shape, the canonical
 *          `MULTI_METHOD_SCHEMA` reason, and a single-element `methods`
 *          array naming the affected method (TECH §6.2 — "for multi-method
 *          routes, the affected methods"). The caller is responsible for
 *          merging these entries into the codemod-needs-manual.json output
 *          alongside any single-method `WRC_COMPOSITION` /
 *          `NEEDS_SCHEMA` entries surfaced by the rewrite loop.
 */
export function rewriteMultiMethod(
  sf: SourceFile,
  methods: readonly string[],
  schemas: Readonly<Record<string, InferSchemaResult>>,
  route: string,
  shape: RouteShape,
): NeedsManualEntry[] {
  const entries: NeedsManualEntry[] = [];

  for (const method of methods) {
    // Per-method schema lookup with a NEEDS_SCHEMA fall-back so a missing
    // entry in the supplied map cannot produce an invalid rewrite. The
    // caller's classifier (32.6) already filtered out non-HTTP exports, so
    // every `method` here is a valid Next.js route export per TECH §8.3.
    const schema: InferSchemaResult = schemas[method] ?? {
      schema: 'z.unknown()',
      reason: 'NEEDS_SCHEMA',
    };

    // Delegate to 32.10's per-method rewrite. The single-method helper
    // already handles:
    //   - the FunctionDeclaration form (`export async function METHOD`);
    //   - the +WRC VariableStatement form (preserved outer wrap per AC-7);
    //   - idempotent `defineRoute` import addition (TECH §2.4 Step A);
    //   - the AC-6 TODO comment for `z.unknown()` fall-backs.
    // Mutation is in-place; the next iteration sees the updated tree.
    rewriteSingleMethod(sf, method, schema);

    entries.push(buildNeedsManualEntry({ method, route, shape }));
  }

  return entries;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a single `NeedsManualEntry` for one method on a multi-method route.
 *
 * Reason: always `MULTI_METHOD_SCHEMA` for multi-method routes per the
 * `reasonForShape` mapping (TECH §6.2). The caller may emit additional
 * `NEEDS_SCHEMA` entries based on inference outcomes, but those are
 * orthogonal — see `rewriteMultiMethod`'s return-value docstring.
 *
 * `methods`: a single-element array naming the affected method. TECH §6.2
 * says "for multi-method routes, the affected methods" — interpreted here as
 * one entry per method (so each developer-facing line in the dry-run report
 * pins the schema slot to a specific method).
 */
function buildNeedsManualEntry(args: {
  method: string;
  route: string;
  shape: RouteShape;
}): NeedsManualEntry {
  return {
    route: args.route,
    shape: args.shape,
    reason: 'MULTI_METHOD_SCHEMA',
    methods: [args.method],
  };
}
