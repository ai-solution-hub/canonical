/**
 * ID-71.23 — Wave 3 propose-write + publish-refusal + auto-apply-off
 * declarative source of truth (B-INV-6/7, M6/M7).
 *
 * Companion to headless-complete-set.ts ({71.22}). Where that module declares
 * the headless-complete READ set, this module declares the headless WRITE
 * discipline the L4 functional-correctness suite verifies:
 *
 *   - B-INV-6: a headless agent MAY create propose-writes (drafts /
 *     suggestions / "Draft content for X" / "Discuss options for Y"
 *     resolutions) into the queue with NO publication gate inside the read
 *     set. Publication stays human-gated — a headless agent attempting to
 *     PUBLISH is REFUSED at the surface and routed to the human gate.
 *   - B-INV-7: auto-apply is OFF at launch; propose-only is the default. The
 *     per-workflow auto-apply switch EXISTS but is verifiably OFF.
 *
 * This module is the declarative, unit-testable behaviour-first surface;
 * functional-correctness.ts imports it to drive the propose-row create + the
 * publish-refusal MCP-only against the live MCP surface, alongside the
 * {71.22} headless-complete enumeration.
 *
 * Spec: PRODUCT.md B-INV-6/7 (HC-2); TECH.md M6/M7 + §Testing-and-validation.
 */

import { AUTO_APPLY_WORKFLOWS } from '@/lib/mcp/actor';

/**
 * MCP tool entries that create a propose-write (a draft / suggestion /
 * resolution into the queue) with NO publication gate (B-INV-6). A headless
 * agent can drive these to a terminal result with no human step. None of
 * these PUBLISH — they propose-into-store / queue a row.
 */
export const PROPOSE_WRITE_TOOLS = [
  // M-CREATE create-into-store leg ({71.16}): propose-into-store (reference
  // layer for URLs, cocoindex source-binding folder for source-less). Never
  // mints a published content_items row synchronously from the agent call.
  'create_content_item',
  // Review-assignment propose-write — queues review work, never publishes.
  'create_review_assignment',
] as const;

export type ProposeWriteTool = (typeof PROPOSE_WRITE_TOOLS)[number];

/**
 * MCP tool entries whose PUBLISH transition is human-gated (B-INV-6). A
 * headless agent attempting the named publishing transition is refused at the
 * surface and routed to the human gate; a human caller proceeds through the
 * existing role-gated path.
 */
export interface PublishGatedTransition {
  /** The MCP tool that exposes the publishing transition. */
  readonly mcpTool: string;
  /** The argument name carrying the target status. */
  readonly statusArg: string;
  /** The argument VALUE that constitutes a publication event (refused for headless). */
  readonly publishValue: string;
  /** A non-publishing value on the same tool (allowed for headless — propose-write). */
  readonly proposeValue: string;
}

export const PUBLISH_GATED_TRANSITIONS: readonly PublishGatedTransition[] = [
  {
    mcpTool: 'update_governance_status',
    statusArg: 'status',
    publishValue: 'publish',
    proposeValue: 'draft',
  },
  {
    mcpTool: 'update_publication_status',
    statusArg: 'new_status',
    publishValue: 'published',
    proposeValue: 'draft',
  },
] as const;

/**
 * Re-export the auto-apply switch registry so the L4 suite and the unit test
 * assert against ONE source of truth (the production config in
 * lib/mcp/actor.ts). B-INV-7: every flag is verifiably OFF at launch.
 */
export { AUTO_APPLY_WORKFLOWS } from '@/lib/mcp/actor';

/**
 * True iff the per-workflow auto-apply switch is verifiably OFF for EVERY
 * workflow (B-INV-7 — no launch auto-apply path). The L4 suite asserts this.
 */
export function autoApplyVerifiablyOff(): boolean {
  return Object.values(AUTO_APPLY_WORKFLOWS).every(
    (enabled) => enabled === false,
  );
}
