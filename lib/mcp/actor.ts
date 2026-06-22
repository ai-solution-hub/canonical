/**
 * MCP actor-type model + publication human-gate guard + per-workflow
 * auto-apply switch.
 *
 * ID-71.23 — Wave 3, B-INV-6/7 (M6/M7).
 *
 * The remote-MCP surface (`app/api/mcp/[transport]/route.ts`) serves BOTH
 * runtime postures over the SAME endpoint (M8/M9 — neither privileged):
 *
 *   - the human-in-UI MCP client (Claude Desktop / claude.ai / Cowork / Code),
 *     and
 *   - KH's thin headless runtime (goose `goose run` + remote-MCP, scheduled /
 *     system-actor workflows).
 *
 * The READ set is identical across both (B-INV-1/8). The asymmetry is WRITE-
 * side and narrow:
 *
 *   - B-INV-6: a headless agent MAY create propose-writes (drafts /
 *     suggestions / "Draft content for X" / "Discuss options for Y"
 *     resolutions) into the queue with NO publication gate. But PUBLICATION
 *     stays human-gated — a headless agent attempting to PUBLISH (transition
 *     content to `published`) is REFUSED at the surface and routed to the
 *     human gate.
 *   - B-INV-7: auto-apply is OFF at launch; propose-only is the default. The
 *     per-workflow auto-apply switch EXISTS but is verifiably OFF for every
 *     workflow (auto-apply is the ID-104-earned per-workflow reward,
 *     B-INV-19 — not enabled now).
 *
 * The actor type is carried on the auth context (`authInfo.extra.actorType`),
 * populated by the transport from the `X-MCP-Actor` request header. The
 * default is `'human'` — the headless posture is opt-IN, never inferred, and
 * an unrecognised signal never silently grants headless privileges.
 *
 * Spec: PRODUCT.md B-INV-6/7; TECH.md M6/M7.
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

// ---------------------------------------------------------------------------
// Actor type
// ---------------------------------------------------------------------------

/**
 * The two runtime postures the remote-MCP surface serves. Neither is
 * privileged on the READ set; the WRITE-side publication gate distinguishes
 * them (B-INV-6).
 *
 * - `'human'` — a human-in-UI MCP client. The default posture. Publication
 *   proceeds through the role-gated human review path.
 * - `'headless'` — a scheduled / system-actor agent (goose runtime, or a
 *   Claude runtime self-identifying as headless). Propose-writes allowed;
 *   publication refused and routed to the human gate.
 */
export type McpActorType = 'human' | 'headless';

/** The request header the transport reads to populate the actor type. */
export const MCP_ACTOR_HEADER = 'x-mcp-actor';

/**
 * Resolve the caller's actor type from the auth context.
 *
 * Defaults to `'human'`: the headless posture is opt-IN (set explicitly on
 * the auth context by the transport from the `X-MCP-Actor: headless` header).
 * An absent, malformed, or unrecognised signal resolves to `'human'` so the
 * publication human-gate is never bypassed by a missing/garbled header.
 */
export function getMcpActorType(authInfo?: AuthInfo): McpActorType {
  const raw = authInfo?.extra?.actorType;
  return raw === 'headless' ? 'headless' : 'human';
}

/** True iff the caller is a headless agent (not a human-in-UI client). */
export function isHeadlessActor(authInfo?: AuthInfo): boolean {
  return getMcpActorType(authInfo) === 'headless';
}

// ---------------------------------------------------------------------------
// Publication human-gate guard (B-INV-6)
// ---------------------------------------------------------------------------

/**
 * The shape an MCP tool returns on a refused publish — an isError result
 * surfaced to the caller. Matches the `content` + `isError` subset every MCP
 * tool returns.
 */
export interface PublishRefusal {
  // Index signature mirrors the SDK `CallToolResult` shape (`{ [x: string]:
  // unknown; ... }`) so the refusal is assignable as an MCP tool return value
  // through a union in the callback's inferred return type.
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

/**
 * Guard the publication transition: if the caller is a headless agent, REFUSE
 * the publish at the surface and route the action to the human gate (B-INV-6).
 *
 * Returns the refusal result to return directly from the tool callback, or
 * `null` when the caller is a human (the publish proceeds through the existing
 * role-gated path). Propose-writes (draft creation, queue rows, suggested
 * resolutions) do NOT call this guard — only publication transitions do.
 */
export function refusePublishForHeadlessActor(
  authInfo?: AuthInfo,
): PublishRefusal | null {
  if (!isHeadlessActor(authInfo)) return null;
  return {
    content: [
      {
        type: 'text' as const,
        text:
          'Publication is human-gated: a headless agent cannot publish content. ' +
          'Create a propose-write (a draft or suggested resolution) instead — it ' +
          'lands in the review queue with no publication gate. The publish action ' +
          'has been routed to the human review gate; a human reviewer must approve ' +
          'the transition to published.',
      },
    ],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Per-workflow auto-apply switch (B-INV-7)
// ---------------------------------------------------------------------------

/**
 * The per-workflow auto-apply switch (B-INV-7 / B-INV-19).
 *
 * Auto-apply lets a workflow's headless writes land WITHOUT the propose-only
 * default — i.e. apply directly rather than queue a propose-row. It is the
 * ID-104-earned per-workflow reward: a workflow earns auto-apply only when its
 * ID-104 quality metric clears the threshold (B-INV-19).
 *
 * At launch, auto-apply is OFF for EVERY workflow — propose-only is the
 * default. The switch EXISTS (this registry) but every flag is `false`. The
 * keys enumerate the headless-write workflows that COULD earn auto-apply
 * later; none ship with it enabled. Flipping any flag to `true` is gated on an
 * ID-104 graduation and is NOT a launch change.
 */
export const AUTO_APPLY_WORKFLOWS: Readonly<Record<string, boolean>> = {
  // W5.6 re-syndication (intelligence poll → workspace feeds).
  re_syndication: false,
  // O4 reorientation briefing → propose-row into the queue (the §MVP pilot).
  reorientation_briefing: false,
  // Headless content drafting (create_content_item propose-writes).
  content_drafting: false,
  // WS-8 suggested-resolution drafting ("Draft content for X" /
  // "Discuss options for Y").
  suggested_resolution: false,
} as const;

/**
 * Is auto-apply enabled for a given workflow?
 *
 * Returns `false` for every known workflow at launch (propose-only default,
 * B-INV-7) and `false` for any unknown workflow (no workflow auto-applies
 * unless explicitly graduated). The single reader the write paths consult to
 * decide propose-only vs auto-apply — at launch it always says propose-only.
 */
export function isAutoApplyEnabled(workflow: string): boolean {
  return AUTO_APPLY_WORKFLOWS[workflow] === true;
}
