/**
 * Shared types for `scripts/codemods/wrap-define-route.ts` and its sibling
 * modules.
 *
 * Spec:
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PRODUCT.md §6
 *     (failure modes per route shape, NEEDS-REVIEW vs MANUAL).
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/TECH.md §2.3 (classifier),
 *     §6.2 (NeedsManualEntry / NeedsManualReason schema).
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/route-shape-inventory.md §2
 *     (shape taxonomy, priority `CRON` > `MCP` > `NAKED_NO_AUTH` >
 *     multi-method > single-method).
 *
 * Scope (Subtask 32.6): types only. Runtime code lives in
 * `wrap-define-route.ts` (`classifyRoute`, `getExportedMethods`).
 *
 * Stability: the union is the codemod's public contract surface — downstream
 * Subtasks (32.7 fixture corpus, 32.8 Source A inference, 32.10 / 32.11
 * rewrite emitters, 32.12 dry-run + needs-manual artefact emitters) all
 * branch on these literals. Adding a variant is additive; removing or
 * renaming one is a breaking change.
 */

/**
 * Primary route shapes (10 total) plus their `withRequestContext` sub-variants
 * (7 total). Encoded as flat string-literal members so JSON emitters (32.12)
 * can serialise them without further mapping.
 *
 * Priority order at classification time (first match wins, per
 * route-shape-inventory.md §2):
 *   1. `CRON`          — path under `/cron/`
 *   2. `MCP`           — path under `/mcp/`
 *   3. `NAKED_NO_AUTH` — no `@/lib/auth` import with the auth-helper names
 *   4. multi-method    — `>1` exported HTTP method; sub-discriminated by
 *                        isParameterised × hasBody
 *   5. single-method   — sub-discriminated by isParameterised × hasBody
 *
 * `+WRC` sub-variants apply to single-method and multi-method shapes only;
 * `CRON`, `MCP`, and `NAKED_NO_AUTH` never carry the suffix because they are
 * MANUAL-bucket shapes that the codemod does not rewrite (so the wrapper
 * composition concern is moot).
 */
export type RouteShape =
  // Single-method shapes (MECHANISABLE)
  | 'AUTH_PLAIN'
  | 'PARAM_BODY'
  | 'BODY_VALIDATED'
  | 'PARAM'
  // Multi-method shapes (NEEDS-REVIEW)
  | 'MULTI_PARAM_BODY'
  | 'MULTI_BODY'
  | 'MULTI_PARAM'
  // MANUAL shapes
  | 'CRON'
  | 'NAKED_NO_AUTH'
  | 'MCP'
  // Unknown outer wrapper (MANUAL) — an `export const METHOD = <Call>(...)`
  // whose outer callee is neither `withRequestContext` (the recognised +WRC
  // wrapper) nor `defineRoute` (the codemod's own output). The codemod cannot
  // safely transform a wrapper it does not understand (e.g.
  // `withRequestContextBare`), so the route is skipped + flagged for manual
  // migration. Added by the S262 fix B1 — see route-shape-inventory.md and the
  // `UNKNOWN_WRAPPER` reason below.
  | 'UNKNOWN_WRAPPER'
  // withRequestContext sub-variants (NEEDS-REVIEW per PRODUCT §6.2)
  | 'AUTH_PLAIN+WRC'
  | 'PARAM_BODY+WRC'
  | 'BODY_VALIDATED+WRC'
  | 'PARAM+WRC'
  | 'MULTI_PARAM_BODY+WRC'
  | 'MULTI_BODY+WRC'
  | 'MULTI_PARAM+WRC';

/**
 * Discriminator for `codemod-needs-manual.json` entries (TECH §6.2).
 * Emitted by Subtask 32.12; consumed by the developer reviewing the
 * dry-run report.
 *
 * Mapping from shape → reason (canonical, per PRODUCT §6 + TECH §6.2):
 *   - `CRON`           → `CRON_AUTH_MODEL`
 *   - `NAKED_NO_AUTH`  → `NAKED_NO_AUTH`
 *   - `MCP`            → `MCP_TRANSPORT`
 *   - `MULTI_*` (incl. `+WRC`)    → `MULTI_METHOD_SCHEMA`
 *   - `*+WRC` (single-method)     → `WRC_COMPOSITION`
 *   - any MECHANISABLE route where inference falls back to `z.unknown()` →
 *     `NEEDS_SCHEMA`
 *
 * The mapping itself lives with the emitter (32.12); this module exposes the
 * vocabulary only.
 */
export type NeedsManualReason =
  | 'CRON_AUTH_MODEL'
  | 'NAKED_NO_AUTH'
  | 'MCP_TRANSPORT'
  | 'MULTI_METHOD_SCHEMA'
  | 'WRC_COMPOSITION'
  | 'NEEDS_SCHEMA'
  // The route wraps its handler in an outer call the codemod does not
  // recognise (e.g. `withRequestContextBare`) — it is skipped during apply and
  // flagged for manual migration (S262 fix B1).
  | 'UNKNOWN_WRAPPER'
  // A per-route rewrite threw during `--apply` and was absorbed by the apply
  // loop so the run could continue. The route is recorded here for manual
  // follow-up rather than aborting the entire apply (S262 fix B1,
  // defense-in-depth).
  | 'APPLY_ERROR';
