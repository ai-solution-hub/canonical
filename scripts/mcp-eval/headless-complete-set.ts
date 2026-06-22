/**
 * ID-71.22 — Wave 3 headless-complete read set (B-INV-1/2/3/4/5, M1-M5).
 *
 * The launch headless-complete set is EXACTLY the union of:
 *   - O1   find/answer reads               (driven via `find`)
 *   - O4   reorientation/briefing reads     (driven via `get_reorientation`,
 *          widened beyond KH state — the read reorients the *person*, not only
 *          their KH state)
 *   - O6   exposure five-layer reads        (driven via `where_are_we_exposed`,
 *          five layers + first-class resolution affordance)
 *   - W5.6 re-syndication                   (driven via `trigger_intelligence_poll`,
 *          re-distributes an already-published consumption output)
 *
 * NO other outcome is in the launch headless set. Each member is driven
 * MCP-only (no UI affordance invoked) to a terminal result, with zero
 * human-in-UI step.
 *
 * This is the declarative source of truth for the L4 enumeration. It lives in
 * its own importable module (NOT inside functional-correctness.ts, whose
 * top-level `main()` runs on import) so the enumeration is unit-testable
 * behaviour-first without a live server, while functional-correctness.ts
 * imports it to drive each member MCP-only against the live MCP surface.
 *
 * Spec: PRODUCT.md B-INV-1..5 (HC-1); TECH.md M1-M5 + §Testing-and-validation
 *   (`bun run test:mcp-eval:fc` is the primary verifier; `bun run test` the gate).
 */

/** The launch headless-complete outcome identifiers, in stable order. */
export const HEADLESS_COMPLETE_OUTCOMES = ['O1', 'O4', 'O6', 'W5.6'] as const;

export type HeadlessCompleteOutcome =
  (typeof HEADLESS_COMPLETE_OUTCOMES)[number];

/**
 * The five-layer ordering O6 (`where_are_we_exposed`) presents (B-INV-4):
 * data you have -> its quality -> how you could use it today -> the gaps ->
 * the opportunities. Mirrors the `ExposureLayer.key` enum in
 * lib/mcp/tools/dashboard.ts.
 */
export const FIVE_LAYER_ORDER = [
  'data',
  'quality',
  'use_today',
  'gaps',
  'opportunities',
] as const;

export type FiveLayerKey = (typeof FIVE_LAYER_ORDER)[number];

/**
 * One member of the headless-complete read set. Each carries the MCP entry
 * that drives it to a terminal result and the per-invariant assertion flags
 * the L4 suite (and the unit test) verify.
 */
export interface HeadlessCompleteMember {
  /** Outcome identifier (O1/O4/O6/W5.6). */
  readonly outcome: HeadlessCompleteOutcome;
  /** Human-readable label. */
  readonly label: string;
  /**
   * The canonical MCP tool entry driving this member MCP-only to a terminal
   * result. Must be a registered tool (CANONICAL_TOOL_NAMES) and must NOT be a
   * `show_*` App-trigger (UI affordance).
   */
  readonly mcpTool: string;
  /**
   * True if this member can only be completed through a human-in-UI step.
   * MUST be false for every headless-complete member (B-INV-2).
   */
  readonly uiOnly: false;
  /** Spec invariant this member's headless-completability satisfies. */
  readonly invariant: string;

  // --- O4 widening (B-INV-3) ---------------------------------------------
  /** True iff this member must surface a non-KH-state dimension (O4). */
  readonly assertsNonKhStateDimension?: boolean;
  /**
   * The non-KH-state reorientation dimension surfaced (O4) — the read
   * reorients the person (e.g. their sector/role/day context), not only KH's
   * internal workspace state.
   */
  readonly nonKhStateDimension?: string;

  // --- O6 five-layer + resolution (B-INV-4) -------------------------------
  /** True iff this member must return the five-layer structure (O6). */
  readonly assertsFiveLayer?: boolean;
  /** The asserted five-layer ordering (O6). */
  readonly fiveLayerOrder?: readonly FiveLayerKey[];
  /** True iff this member must carry >=1 suggested-resolution affordance (O6). */
  readonly assertsResolutionAffordance?: boolean;

  // --- W5.6 re-syndication (B-INV-5) --------------------------------------
  /**
   * True iff this member re-distributes an already-published consumption
   * output (W5.6) — re-syndication, not a net-new publication gate event.
   */
  readonly reSyndicatesPublishedOutput?: boolean;
}

/**
 * The verbatim headless-complete read set. The Checker confirms this matches
 * {O1/O4/O6 reads + W5.6} exactly — no extras, no omissions (B-INV-1).
 */
export const HEADLESS_COMPLETE_SET: readonly HeadlessCompleteMember[] = [
  {
    outcome: 'O1',
    label: 'find / answer reads',
    mcpTool: 'find',
    uiOnly: false,
    invariant: 'B-INV-1/B-INV-2',
  },
  {
    outcome: 'O4',
    label: 'reorientation / briefing reads (widened beyond KH state)',
    mcpTool: 'get_reorientation',
    uiOnly: false,
    invariant: 'B-INV-3',
    assertsNonKhStateDimension: true,
    // The O4 read reorients the *person*, not only their KH state — it accepts
    // and reflects context beyond KH's own data (the user's sector / role /
    // day), framed at the person level rather than the workspace level.
    nonKhStateDimension: 'person-level sector/role/day reorientation',
  },
  {
    outcome: 'O6',
    label: 'exposure five-layer reads',
    mcpTool: 'where_are_we_exposed',
    uiOnly: false,
    invariant: 'B-INV-4',
    assertsFiveLayer: true,
    fiveLayerOrder: FIVE_LAYER_ORDER,
    assertsResolutionAffordance: true,
  },
  {
    outcome: 'W5.6',
    label: 're-syndication',
    mcpTool: 'trigger_intelligence_poll',
    uiOnly: false,
    invariant: 'B-INV-5',
    reSyndicatesPublishedOutput: true,
  },
] as const;
