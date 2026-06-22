/**
 * ID-71.24 — Wave 3 dual-runtime + bidirectional-connectivity declarative
 * source of truth (B-INV-8/9/10/11/12, M8-M12).
 *
 * Third companion to headless-complete-set.ts ({71.22}, the READ set) and
 * propose-write-set.ts ({71.23}, the WRITE discipline). Where those declare the
 * headless-complete reads and the propose/publish discipline, THIS module
 * declares the dual-runtime + connectivity discipline the L4
 * functional-correctness suite verifies:
 *
 *   - B-INV-8/9: the headless-complete set is reachable IDENTICALLY from
 *     Claude's runtimes AND the goose runtime via the SAME remote-MCP surface;
 *     the goose-consumed inventory EQUALS the Claude-runtime inventory. Tool
 *     VISIBILITY is actor-independent; only PUBLISH is gated ({71.23}).
 *   - B-INV-10: incoming = the remote MCP surface (exists, no code change;
 *     evaluated as a connection).
 *   - B-INV-11: outgoing = ONE trigger-driven push channel delivering a
 *     consumption output end-to-end.
 *   - B-INV-12: write-back scoped to the three sanctioned destinations only; a
 *     net-new source-system write-back is refused at the surface.
 *
 * This module is the declarative, unit-testable behaviour-first surface;
 * functional-correctness.ts imports it to drive the inventory-equality probe,
 * the push end-to-end delivery, and the net-new-write-back refusal MCP-only /
 * behaviourally against the live MCP surface, ALONGSIDE the {71.22}/{71.23}
 * checks (FC-90..102 untouched).
 *
 * Spec: PRODUCT.md B-INV-8..12; TECH.md M8-M12 + §MVP + §Testing-and-validation.
 */

import {
  SANCTIONED_WRITE_BACK_DESTINATIONS,
  guardWriteBack,
  netNewSourceSystemWriteBackRefused,
} from '@/lib/mcp/write-back-surface';
import {
  PUSH_MECHANISM,
  pushConsumptionOutput,
  type ConsumptionOutput,
  type PushResult,
  type PushTransport,
} from '@/lib/mcp/push-channel';

// ---------------------------------------------------------------------------
// B-INV-8/9 — dual runtime, identical inventory
// ---------------------------------------------------------------------------

/**
 * The actor headers the SAME remote-MCP surface serves. Tool inventory
 * (`tools/list`) MUST be identical across both — neither runtime is privileged
 * on visibility (B-INV-8/9). The Claude runtime sends `human`; the goose
 * runtime sends `headless`. The L4 check fetches `tools/list` under each header
 * and asserts the two inventories are equal.
 */
export const INVENTORY_ACTOR_HEADERS = ['human', 'headless'] as const;

export type InventoryActorHeader = (typeof INVENTORY_ACTOR_HEADERS)[number];

/**
 * Compare two tool inventories (the `name` arrays from two `tools/list` calls).
 * Returns `true` iff they enumerate exactly the same set of tool names — order
 * insensitive. This is the behaviour B-INV-9 asserts: the goose-consumed
 * inventory EQUALS the Claude-runtime inventory.
 *
 * Returning a boolean (not asserting) keeps it unit-testable behaviour-first
 * without a live server; the L4 check supplies the live inventories.
 */
export function inventoriesEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((name, i) => name === sortedB[i]);
}

// ---------------------------------------------------------------------------
// B-INV-12 — net-new source-system write-back refused at the surface
// ---------------------------------------------------------------------------

/**
 * A net-new source system NOT among the three sanctioned destinations — the
 * canonical refusal probe. SharePoint stays WS-6-gated and is NOT enabled by
 * ID-71; a write-back to it must be refused at the surface (B-INV-12).
 */
export const NET_NEW_SOURCE_SYSTEM_PROBE = 'sharepoint_net_new';

/** Re-export the sanctioned destinations so the L4 suite asserts ONE source of truth. */
export { SANCTIONED_WRITE_BACK_DESTINATIONS, guardWriteBack };

/**
 * True iff the write-back surface refuses the canonical net-new source-system
 * probe (B-INV-12). The L4 suite asserts this.
 */
export function netNewWriteBackRefusedAtSurface(): boolean {
  return netNewSourceSystemWriteBackRefused(NET_NEW_SOURCE_SYSTEM_PROBE);
}

/**
 * True iff EVERY sanctioned destination is allowed at the surface — the
 * positive complement of the refusal (the guard is not refusing everything).
 */
export function allSanctionedDestinationsAllowed(): boolean {
  return SANCTIONED_WRITE_BACK_DESTINATIONS.every(
    (d) => guardWriteBack(d).allowed,
  );
}

// ---------------------------------------------------------------------------
// B-INV-11 — one push delivered end-to-end (behaviour-first via mock transport)
// ---------------------------------------------------------------------------

/**
 * The canonical consumption output the §MVP pilot pushes: an O4 reorientation
 * briefing. Used by the L4 end-to-end push probe and the unit test.
 */
export const PILOT_CONSUMPTION_OUTPUT: ConsumptionOutput = {
  id: 'pilot-o4-briefing',
  kind: 'o4_reorientation_briefing',
  title: 'Daily reorientation briefing',
  body: 'Your sector moved overnight; here is what changed and what to do next.',
};

export { PUSH_MECHANISM };
export type { PushResult, PushTransport };

/**
 * Prove the push channel delivers the pilot consumption output end-to-end
 * through the supplied transport. Used by both the unit test (mock transport,
 * in-memory URL) and any caller wiring the §MVP pilot. Returns the terminal
 * {@link PushResult} the caller asserts (`delivered: true`).
 */
export async function deliverPilotPush(
  transport: PushTransport,
  url: string,
): Promise<PushResult> {
  return pushConsumptionOutput(PILOT_CONSUMPTION_OUTPUT, { transport, url });
}
