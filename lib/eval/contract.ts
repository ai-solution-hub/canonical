/**
 * Canonical `AgentEvalContract` — OWNED + canonically defined by ID-104 (bottom-up).
 *
 * Single source of truth for the per-touchpoint eval contract. ID-71's M38 guard
 * imports `AgentEvalContract` directly from `@/lib/eval/contract` (no barrel
 * re-export); the touchpoint registry and `recordAiCall()` (T14) import the same
 * module so the contract, its field unions, and the `OutcomeSignal` enum live in
 * exactly ONE place.
 *
 * The seven mandatory fields + optional `graduation_metric` are FROZEN by S356
 * (TECH §Contract / B-INV-1, B-INV-2). They must not be renamed. Further bottom-up
 * optional fields MAY be added later (e.g. `file_sha256?` for git-backed
 * touchpoints) without breaking this contract.
 *
 * This module is deliberately standalone and zero-dependency apart from Zod, so it
 * can be cherry-picked early to unblock ID-71 Wave 2/3 independently of the rest of
 * ID-104. It does NOT crib into `lib/eval/types.ts` — that file keeps the legacy
 * `EvalBaseline` / `EvalResult` / gold-item shapes.
 */

import { z } from 'zod';

/** The kind of AI touchpoint a contract governs. */
export type TouchpointKind =
  | 'tool'
  | 'prompt'
  | 'skill'
  | 'inline'
  | 'agent_recipe';

/** How a touchpoint's output is grounded (B-INV-2 / ID-71 B-INV-35). */
export type GroundingShape =
  | 'structured_output'
  | 'forced_tool_strict'
  | 'citations'
  | 'n/a';

/**
 * Severity disposition applied when a touchpoint's eval fails.
 * `infra` is reserved for transient-provider failures (Anthropic 529 / timeout)
 * and is NEVER counted as a quality regression.
 */
export type SeverityTier =
  | 'block' // fails the gate (non-zero exit)
  | 'warn' // recorded + surfaced, does not fail the gate
  | 'info' // recorded only
  | 'infra'; // transient-provider failure (Anthropic 529 / timeout) — NOT a quality regression

/**
 * Outcome signal captured by `recordAiCall()` (T14) — RATIFIED enum (sized for
 * exactly this set, extensible by adding members). Co-located here so the
 * registry, `recordAiCall()`, and ID-71 all import ONE module.
 */
export type OutcomeSignal = 'win' | 'fail' | 'loop' | 'refusal';

/**
 * The canonical per-touchpoint eval contract. Seven mandatory fields + optional
 * `graduation_metric`, frozen by S356.
 */
export interface AgentEvalContract {
  /** Stable id: tool name | prompt name | skill | recipe slug. */
  touchpoint_id: string;
  kind: TouchpointKind;
  /** Touchpoint registry: owner of record. */
  owner: string;
  /** The eval suite this touchpoint runs under (e.g. 'l1' | 'l3' | 'l4'). */
  suite_name: string;
  grounding_shape: GroundingShape;
  severity_on_fail: SeverityTier;
  /** Per-touchpoint regression tolerance (default 0.02). */
  variance_band: number;
  /** B-INV-19: in-house WS-5 auto-apply metric (optional, contract-addressable). */
  graduation_metric?: string;
}

const touchpointKindSchema = z.enum([
  'tool',
  'prompt',
  'skill',
  'inline',
  'agent_recipe',
]);

const groundingShapeSchema = z.enum([
  'structured_output',
  'forced_tool_strict',
  'citations',
  'n/a',
]);

const severityTierSchema = z.enum(['block', 'warn', 'info', 'infra']);

/** Co-located so `recordAiCall()` (T14) validates outcome signals against the same source. */
export const outcomeSignalSchema = z.enum(['win', 'fail', 'loop', 'refusal']);

/**
 * Zod schema validating registry writes at the boundary (T2). `z.infer` of this
 * schema is structurally equal to {@link AgentEvalContract}; the type assertion
 * below fails to compile if the two ever drift.
 */
export const agentEvalContractSchema = z
  .object({
    touchpoint_id: z.string(),
    kind: touchpointKindSchema,
    owner: z.string(),
    suite_name: z.string(),
    grounding_shape: groundingShapeSchema,
    severity_on_fail: severityTierSchema,
    variance_band: z.number(),
    graduation_metric: z.string().optional(),
  })
  .strict();

// Compile-time guard: the schema's inferred shape and the hand-written interface
// must remain structurally identical (S356-frozen contract). If a field is added,
// removed, or renamed on one side only, one of these assignments stops compiling.
type _SchemaMatchesInterface =
  z.infer<typeof agentEvalContractSchema> extends AgentEvalContract
    ? AgentEvalContract extends z.infer<typeof agentEvalContractSchema>
      ? true
      : never
    : never;
const _contractShapeGuard: _SchemaMatchesInterface = true;
void _contractShapeGuard;
