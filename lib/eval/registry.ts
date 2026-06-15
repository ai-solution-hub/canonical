/**
 * Touchpoint registry (T3/T4/T5, B-INV-3/4/5).
 *
 * The registry-of-record for every AI touchpoint. `registerTouchpoint` validates
 * an {@link AgentEvalContract} at the boundary (T2 — `agentEvalContractSchema`),
 * then upserts it into `eval_touchpoints` with deterministic version maintenance:
 *
 *   - **B-INV-3 — duplicate id rejected.** `touchpoint_id` is the natural PK, so a
 *     second INSERT of the same id trips the PK unique violation (Postgres
 *     `23505`). That error is surfaced as a `SupabaseError` via `sb()` — NEVER
 *     swallowed. The registry does not paper a conflict over with an upsert.
 *   - **B-INV-4/5 — contract + registry versions advance together.** When ANY
 *     contract field changes versus the stored row, `contract_version` bumps by
 *     one (per-touchpoint) AND the table-level `registry_version` advances to
 *     `max(registry_version) + 1`. An identical re-register is a no-op — no
 *     version churn.
 *
 * `getTouchpoint` / `listTouchpoints` are the read side: the eval runner (T13)
 * resolves each touchpoint BEFORE dispatch (registration-as-gate, T4 —
 * `getTouchpoint` returning `null` is the unregistered signal the runner maps to
 * an explicit `'not registered: <id>'` exit-2 disposition), and /admin/refinement
 * (T22) + the version-history endpoint read the full set.
 *
 * Writes go through `sb()` (fail-fast) so a registry write failure is loud, not a
 * silent partial. Reads use `tryQuery()` where the registry distinguishes
 * "absent" from "failed".
 *
 * No barrel re-export: import directly from `@/lib/eval/registry`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Tables } from '@/supabase/types/database.types';
import {
  agentEvalContractSchema,
  type AgentEvalContract,
} from '@/lib/eval/contract';
import { sb, tryQuery } from '@/lib/supabase/safe';

/** A stored registry row — the canonical `eval_touchpoints` table shape. */
export type Touchpoint = Tables<'eval_touchpoints'>;

/**
 * The contract fields that, when changed, advance `contract_version`. This is
 * exactly the {@link AgentEvalContract} field set (the PK `touchpoint_id` is the
 * row identity, not a versioned field — it never "changes" within a row).
 */
const VERSIONED_FIELDS = [
  'kind',
  'owner',
  'suite_name',
  'grounding_shape',
  'severity_on_fail',
  'variance_band',
  'graduation_metric',
] as const satisfies readonly (keyof AgentEvalContract)[];

/**
 * Whether the incoming contract differs from the stored row on any versioned
 * field. `graduation_metric` is optional on the contract but `null` on the row;
 * normalise `undefined` → `null` so an absent optional matches a NULL column
 * (and does NOT spuriously bump the version).
 */
function contractDiffersFromRow(
  contract: AgentEvalContract,
  row: Touchpoint,
): boolean {
  return VERSIONED_FIELDS.some((field) => {
    const incoming = contract[field] ?? null;
    const stored = row[field] ?? null;
    return incoming !== stored;
  });
}

/**
 * The current table-level registry generation: `max(registry_version)` across
 * all rows, or `0` when the registry is empty (so the first registration lands
 * at `1`).
 */
async function currentRegistryVersion(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const result = await tryQuery(
    supabase.from('eval_touchpoints').select('registry_version'),
    'eval_touchpoints.registryVersion',
  );
  if (!result.ok) {
    throw result.error;
  }
  return result.data.reduce(
    (max, row) => Math.max(max, row.registry_version),
    0,
  );
}

/** Project a validated contract onto the touchpoint's contract columns. */
function contractColumns(contract: AgentEvalContract) {
  return {
    kind: contract.kind,
    owner: contract.owner,
    suite_name: contract.suite_name,
    grounding_shape: contract.grounding_shape,
    severity_on_fail: contract.severity_on_fail,
    variance_band: contract.variance_band,
    graduation_metric: contract.graduation_metric ?? null,
  };
}

/**
 * Register a touchpoint (T3/T5). Validates the contract, then:
 *   - inserts a fresh row at `contract_version = 1` when none exists (a duplicate
 *     PK insert is rejected — `sb()` throws the `23505` violation, B-INV-3);
 *   - bumps `contract_version` + advances `registry_version` when a contract
 *     field changed (B-INV-4/5);
 *   - returns the stored row unchanged when nothing changed (no version churn).
 *
 * Returns the resulting (inserted / updated / unchanged) row.
 */
export async function registerTouchpoint(
  supabase: SupabaseClient<Database>,
  contract: AgentEvalContract,
): Promise<Touchpoint> {
  // T2 — validate at the boundary BEFORE any DB access. A malformed contract
  // throws here and never reaches Supabase.
  const validated = agentEvalContractSchema.parse(contract);

  const existing = await tryQuery(
    supabase
      .from('eval_touchpoints')
      .select('*')
      .eq('touchpoint_id', validated.touchpoint_id)
      .maybeSingle(),
    'eval_touchpoints.preRead',
  );
  if (!existing.ok) {
    throw existing.error;
  }

  // No stored row — INSERT. A racing concurrent insert (or a stale pre-read)
  // surfaces the PK unique violation through sb(); it is NOT swallowed (B-INV-3).
  if (existing.data === null) {
    const nextRegistryVersion = (await currentRegistryVersion(supabase)) + 1;
    return sb(
      supabase
        .from('eval_touchpoints')
        .insert({
          touchpoint_id: validated.touchpoint_id,
          ...contractColumns(validated),
          contract_version: 1,
          registry_version: nextRegistryVersion,
        })
        .select('*')
        .single(),
      'eval_touchpoints.insert',
    );
  }

  // Stored row exists and nothing changed — no-op, no version churn (B-INV-5).
  if (!contractDiffersFromRow(validated, existing.data)) {
    return existing.data;
  }

  // A contract field changed — bump contract_version AND advance the table-level
  // registry_version together (B-INV-4/5).
  const nextRegistryVersion = (await currentRegistryVersion(supabase)) + 1;
  return sb(
    supabase
      .from('eval_touchpoints')
      .update({
        ...contractColumns(validated),
        contract_version: existing.data.contract_version + 1,
        registry_version: nextRegistryVersion,
      })
      .eq('touchpoint_id', validated.touchpoint_id)
      .select('*')
      .single(),
    'eval_touchpoints.update',
  );
}

/**
 * Resolve a single touchpoint by id (T4 registration-as-gate read). Returns the
 * stored row, or `null` when the touchpoint is not registered — the signal the
 * runner maps to an explicit `'not registered: <id>'` exit-2 disposition.
 */
export async function getTouchpoint(
  supabase: SupabaseClient<Database>,
  touchpointId: string,
): Promise<Touchpoint | null> {
  return sb(
    supabase
      .from('eval_touchpoints')
      .select('*')
      .eq('touchpoint_id', touchpointId)
      .maybeSingle(),
    'eval_touchpoints.get',
  );
}

/**
 * List all registered touchpoints (T22 /admin/refinement + version-history).
 * Ordered by `touchpoint_id` for a stable surface. Returns `[]` when empty.
 */
export async function listTouchpoints(
  supabase: SupabaseClient<Database>,
): Promise<Touchpoint[]> {
  return sb(
    supabase
      .from('eval_touchpoints')
      .select('*')
      .order('touchpoint_id', { ascending: true }),
    'eval_touchpoints.list',
  );
}
