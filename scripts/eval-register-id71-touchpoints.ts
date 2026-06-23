/**
 * eval-register-id71-touchpoints — born-evaluable contract registration for the
 * new/refined ID-71 touchpoints ({71.20}, B-INV-13/14/40; M14/M40).
 *
 * ID-71's Wave-2 born-evaluable rollout requires every new/refined touchpoint
 * (the consolidated MCP tools + the inline `lib/ai` AI call sites) to ship an
 * ID-104-owned {@link AgentEvalContract} registered into the touchpoint registry
 * (`eval_touchpoints`). ID-71 CONSUMES ID-104's contract + registry +
 * graduation infrastructure — it builds NONE of it. This module is the ID-71
 * counterpart to ID-104's `eval-register-suites.ts`: a distinct concern (ID-71
 * tool/inline touchpoints, NOT eval *suites*), so it lives in a sibling module
 * to keep the suite-contracts file unpolluted.
 *
 * Two touchpoint classes are registered:
 *
 *   1. **Tool touchpoints (kind='tool').** The 7 new/refined consolidated MCP
 *      tools. Each `touchpoint_id` is `tool.<name>` where `<name>` is the
 *      VERBATIM tool-name string passed to `defineTool(server, '<name>', …)` —
 *      verified against the live `defineTool` call sites, never guessed:
 *        - `find`                    (lib/mcp/tools/search.ts)
 *        - `find_duplicates`         (lib/mcp/tools/search.ts — dedup)
 *        - `where_are_we_exposed`    (lib/mcp/tools/dashboard.ts)
 *        - `whats_in_my_queue`       (lib/mcp/tools/review.ts)
 *        - `get`                     (lib/mcp/tools/content.ts)
 *        - `assign`                  (lib/mcp/tools/content.ts)
 *        - `get_entity_relationships`(lib/mcp/tools/entities.ts)
 *      Tool touchpoints route under the L4 functional-correctness suite (the
 *      enumeration suite {71.22} authors) and are CI-gating (severity 'block',
 *      B-INV-40 — the eval is the gate, not the schema).
 *
 *   2. **Inline touchpoints (kind='inline').** Every `lib/ai` AI call site that
 *      is a genuine AI touchpoint, enumerated from the 71.17 grounding map
 *      ({@link AI_TOUCHPOINT_GROUNDING}). Each `touchpoint_id` is
 *      `inline.<module>.<function>` and its `grounding_shape` is read DIRECTLY
 *      from that map — the contract can never drift from the shape the call site
 *      actually uses (B-INV-35). Inline touchpoints route under the L3
 *      response-quality suite and are 'warn' severity (a quality regression is
 *      surfaced to an operator via /admin/refinement, not yet CI-blocking —
 *      same posture as the legacy `eval.*` suites).
 *
 * SCOPE GUARD ({71.20}): registering a *contract* (a declarative registry row)
 * is independent of wiring `recordAiCall()` at each lib/ai site. {71.20} ships
 * the contracts + their born-evaluable binding + the egress assertion. It does
 * NOT do the net-new `recordAiCall` instrumentation sweep — that is a separate
 * concern (see the journal note / orchestrator escalation in the dispatch
 * report). A registered contract makes a touchpoint born-evaluable at the
 * registry layer regardless of whether outcome-signal instrumentation has
 * landed at its call site yet.
 *
 * B-INV-15 (zero hosted-Raindrop-cloud egress): this module performs ZERO
 * network egress of its own. Evals are authored locally against the LOCAL
 * Raindrop Workshop (`localhost:5899`, OTel-fed, empty write key) and committed
 * into KH's KH-owned harness; the hosted Raindrop cloud is PERMANENTLY excluded.
 * The companion test asserts zero egress to the hosted cloud over this
 * registration path while explicitly permitting the local Workshop host.
 *
 * Idempotent: `registerTouchpoint` is a no-op when the contract is unchanged
 * (B-INV-5). Safe to re-run at CI-seed time.
 *
 * No barrel re-export: import directly from
 * `@/scripts/eval-register-id71-touchpoints`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/supabase/types/database.types';
import type { AgentEvalContract } from '@/lib/eval/contract';
import { registerTouchpoint } from '@/lib/eval/registry';
import { AI_TOUCHPOINT_GROUNDING } from '@/lib/ai/grounding';

// ---------------------------------------------------------------------------
// Tool touchpoints (kind='tool')
// ---------------------------------------------------------------------------

/**
 * The verbatim tool-name strings of the new/refined consolidated ID-71 MCP
 * tools, each verified against its `defineTool(server, '<name>', …)` call site.
 * The `touchpoint_id` for each is `tool.<name>`.
 */
export const ID71_TOOL_TOUCHPOINT_IDS = [
  'find',
  'find_duplicates',
  'where_are_we_exposed',
  'whats_in_my_queue',
  'get',
  'assign',
  'get_entity_relationships',
] as const;

/** Owner of record for ID-71 touchpoints in the registry. */
const ID71_OWNER = 'ai-tooling-team';

/**
 * Tool touchpoint contracts. CI-gating (severity 'block', B-INV-40), routed
 * under the L4 functional-correctness suite ({71.22} authors the enumeration).
 * Tool outputs are grounded as `structured_output` (the consolidated tools
 * return structured envelopes the L4 suite asserts against).
 */
const TOOL_CONTRACTS: readonly AgentEvalContract[] =
  ID71_TOOL_TOUCHPOINT_IDS.map((toolName) => ({
    touchpoint_id: `tool.${toolName}`,
    kind: 'tool' as const,
    owner: ID71_OWNER,
    suite_name: 'l4',
    grounding_shape: 'structured_output' as const,
    severity_on_fail: 'block' as const,
    variance_band: 0.02,
  }));

// ---------------------------------------------------------------------------
// Inline touchpoints (kind='inline')
// ---------------------------------------------------------------------------

/**
 * The inline `lib/ai` touchpoint ids — exactly the keys of the 71.17 grounding
 * map. Enumerating from that map (rather than a hand-maintained second list)
 * means a new AI touchpoint added to `AI_TOUCHPOINT_GROUNDING` is automatically
 * in scope for a contract, and the two can never diverge.
 */
export const ID71_INLINE_TOUCHPOINT_IDS = Object.keys(
  AI_TOUCHPOINT_GROUNDING,
) as ReadonlyArray<keyof typeof AI_TOUCHPOINT_GROUNDING>;

/**
 * Inline touchpoint contracts. `grounding_shape` is read DIRECTLY from
 * `AI_TOUCHPOINT_GROUNDING` (B-INV-35 — one declared shape per touchpoint, no
 * drift). Routed under the L3 response-quality suite; 'warn' severity (operator
 * reviews regressions via /admin/refinement — not yet CI-blocking, same posture
 * as the legacy `eval.*` suites).
 */
const INLINE_CONTRACTS: readonly AgentEvalContract[] =
  ID71_INLINE_TOUCHPOINT_IDS.map((aiId) => ({
    touchpoint_id: `inline.${aiId}`,
    kind: 'inline' as const,
    owner: ID71_OWNER,
    suite_name: 'l3',
    grounding_shape: AI_TOUCHPOINT_GROUNDING[aiId],
    severity_on_fail: 'warn' as const,
    variance_band: 0.03,
  }));

// ---------------------------------------------------------------------------
// Combined manifest
// ---------------------------------------------------------------------------

/**
 * The full ID-71 born-evaluable contract manifest. Declared at module scope so
 * the Zod validator (inside `registerTouchpoint`) is reachable at registration
 * time and the static-shape guards in tests can read it without a DB.
 */
const ID71_TOUCHPOINT_CONTRACTS: readonly AgentEvalContract[] = [
  ...TOOL_CONTRACTS,
  ...INLINE_CONTRACTS,
];

/** The list of ID-71 touchpoint contracts (read-only), exposed for tests. */
export const REGISTERED_ID71_TOUCHPOINT_CONTRACTS: readonly AgentEvalContract[] =
  ID71_TOUCHPOINT_CONTRACTS;

// ---------------------------------------------------------------------------
// Bootstrap registration
// ---------------------------------------------------------------------------

/**
 * Register all ID-71 born-evaluable touchpoints into `eval_touchpoints`
 * ({71.20}, B-INV-13). Idempotent: `registerTouchpoint` is a no-op when the
 * contract is unchanged (B-INV-5). Safe to re-run at any time.
 *
 * Intended call sites:
 *   - `bun run scripts/eval-register-id71-touchpoints.ts --register` (one-off)
 *   - the CI `mcp-eval-seed` job (registers contracts at seed time so the eval
 *     matrix resolves every ID-71 touchpoint before dispatch).
 *
 * Throws on any registration failure (PK conflict with a mismatched contract,
 * DB-unreachable) so the caller surfaces the error loudly (T4).
 */
export async function registerId71Touchpoints(
  supabase: SupabaseClient<Database>,
): Promise<void> {
  for (const contract of ID71_TOUCHPOINT_CONTRACTS) {
    await registerTouchpoint(supabase, contract);
  }
}

// ---------------------------------------------------------------------------
// Direct CLI entry point (--register mode)
// ---------------------------------------------------------------------------

/**
 * When run directly (`bun run scripts/eval-register-id71-touchpoints.ts
 * --register`), registers all ID-71 touchpoint contracts against the configured
 * Supabase instance. Exits 0 on success, 1 on error (a bootstrap utility, not
 * the eval runner — no 0/1/2 runner exit class).
 */
if (import.meta.main) {
  (async () => {
    // ID-115: platform PostgREST exposes only the `api` schema, not `public`.
    // A raw createClient defaults to `public` → "Invalid schema: public". The
    // loose script-client helper re-applies DB_OPTION so `.from('eval_touchpoints')`
    // resolves to `api.eval_touchpoints` (the dual-exposure view).
    const { createLooseScriptClient } =
      await import('@/scripts/lib/supabase-script-client');

    const url =
      process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!url || !key) {
      console.error(
        'eval-register-id71-touchpoints: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      );
      process.exit(1);
    }

    const supabase = createLooseScriptClient(url, key, {
      auth: { persistSession: false },
    });

    console.log(
      `Registering ${ID71_TOUCHPOINT_CONTRACTS.length} ID-71 touchpoints…`,
    );
    try {
      await registerId71Touchpoints(supabase);
      console.log('Done — all ID-71 touchpoints registered (or up-to-date).');
    } catch (err) {
      console.error(
        'Registration failed:',
        err instanceof Error ? err.message : String(err),
      );
      process.exit(1);
    }
  })().catch((err: unknown) => {
    console.error(
      'eval-register-id71-touchpoints: fatal error:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
}
