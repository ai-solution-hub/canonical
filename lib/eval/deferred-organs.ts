/**
 * Deferred eval-refinement organs — the "deferred, gated on signal volume"
 * register (ID-104 / B-INV-24).
 *
 * ID-104 ships the HITL *substrate* now: the touchpoint registry (T3/T4), the
 * canonical `AgentEvalContract` (T1/T2), the severity|variance model (T6/T8),
 * `recordAiCall()` capture (T16), the baseline lifecycle (T11), and the
 * graduation metric (T18/T19). Three auto-refinement *organs* are DEFERRED to a
 * NAMED follow-up Task, gated on `ai_call_events` accumulating enough signal to
 * train them. This module is the named record — NOT a silent orphan —
 * back-pointing to B-INV-24; the Orchestrator opens the follow-up Task as a
 * Task-level coordination note (spec §X#2), not a Subtask dependency.
 *
 * Each organ is anchored by a present-but-empty `/admin/refinement` endpoint
 * (T22) that ships an empty-200 stable shape today; the follow-up only fills the
 * body. The endpoints import this register so the anchor names exactly which
 * organ will fill it (see `deferredOrgansForAnchor`).
 *
 * Spec: specs/id-104-eval-engine/{PRODUCT,TECH}.md §H (B-INV-24), §X#2.
 */

/** Stable id for a deferred organ — surfaced by its anchor endpoint. */
export type DeferredOrganId =
  | 'pattern_detector'
  | 'ab_runner'
  | 'auto_rollback';

/** The present-but-empty endpoint suffix anchoring a deferred organ (T22). */
export type DeferredAnchorSuffix = 'patterns' | 'proposals';

export interface DeferredOrgan {
  /** Stable id the anchor endpoint uses to name what will fill it. */
  id: DeferredOrganId;
  /** Human-readable name. */
  name: string;
  /** What the organ does once the follow-up Task builds it. */
  summary: string;
  /** The signal-volume condition gating the follow-up build (the deferral gate). */
  gating_condition: string;
  /** Present-but-empty endpoint (T22) anchoring this organ today. */
  anchor_endpoint: `/api/refinement/touchpoints/[id]/${DeferredAnchorSuffix}`;
  /** Spec invariant this deferral is recorded against — NOT a silent orphan. */
  back_pointer: 'B-INV-24';
}

/**
 * The three deferred organs, gated on signal volume. Frozen as a named
 * follow-up per B-INV-24 — building any of these at v1 NOW, or dropping one
 * without a recorded gate + back-pointer, fails the invariant.
 */
export const DEFERRED_ORGANS = [
  {
    id: 'pattern_detector',
    name: 'Cross-touchpoint pattern detector',
    summary:
      'Mines accumulated ai_call_events across touchpoints for recurring fail/loop/refusal patterns and surfaces them as refinement candidates.',
    gating_condition:
      'ai_call_events has accumulated enough per-touchpoint signal volume to detect patterns above noise.',
    anchor_endpoint: '/api/refinement/touchpoints/[id]/patterns',
    back_pointer: 'B-INV-24',
  },
  {
    id: 'ab_runner',
    name: 'Parallel A/B runner',
    summary:
      'Runs proposed prompt/contract variants in parallel against gold standards to score a refinement before it reaches the human gate.',
    gating_condition:
      'Enough captured signal plus gold-standard coverage to make A/B deltas meaningful.',
    anchor_endpoint: '/api/refinement/touchpoints/[id]/proposals',
    back_pointer: 'B-INV-24',
  },
  {
    id: 'auto_rollback',
    name: 'Auto-rollback registry',
    summary:
      'Tracks an applied refinement and auto-reverts a touchpoint to its prior version when post-apply signal regresses past its variance_band.',
    gating_condition:
      'A graduated touchpoint with earned auto-apply trust plus enough post-apply signal to detect regression.',
    anchor_endpoint: '/api/refinement/touchpoints/[id]/proposals',
    back_pointer: 'B-INV-24',
  },
] as const satisfies readonly DeferredOrgan[];

/**
 * The deferred organ ids anchored by a given present-but-empty endpoint (T22).
 * The anchor endpoints call this so the empty-200 body self-documents which
 * organ the follow-up Task will fill — `patterns` → the pattern detector;
 * `proposals` → the A/B runner + auto-rollback registry.
 */
export function deferredOrgansForAnchor(
  suffix: DeferredAnchorSuffix,
): DeferredOrganId[] {
  return DEFERRED_ORGANS.filter((organ) =>
    organ.anchor_endpoint.endsWith(`/${suffix}`),
  ).map((organ) => organ.id);
}
