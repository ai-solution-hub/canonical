/**
 * MCP write-back surface guard — write-back scoped to the THREE sanctioned
 * destinations only.
 *
 * ID-71.24 — Wave 3, B-INV-12 (M12). The outgoing write-back half of
 * bidirectional connectivity.
 *
 * A headless (or human) agent may write BACK only to the three sanctioned
 * destinations. Any other destination — in particular a NET-NEW source system
 * (a SharePoint / Google-Drive connector not already wired) — is REFUSED at
 * this surface. Net-new source-system write-back stays WS-6-gated and is NOT
 * enabled by ID-71; the refusal is the load-bearing guard the L4 check asserts.
 *
 * ── The three sanctioned destinations (TECH M12 / §B-INV-11/12) ─────────────
 *   1. `local_fs_canonical_store` — the local-fs canonical store. Two legs:
 *      - edit-back   : `writeBackFileFirst` (lib/edit-intent/write-back.ts),
 *        the {59.9} file-first edit path (B-INV-12 edit destination);
 *      - create-into-store : the {71.16} M-CREATE create-leg (propose-into-
 *        store via create_content_item), NOT a direct-DB insert.
 *   2. `hubspot_cowork_connector` — the live HubSpot↔Cowork connector (an
 *      already-wired, sanctioned source system; the ONLY source-system
 *      write-back enabled).
 *   3. `push_delivery` — the outbound push channel (lib/mcp/push-channel.ts,
 *      B-INV-11). Delivering a consumption output outbound is a sanctioned
 *      write-back target.
 *
 * Anything else is a net-new source-system write-back → refused. The guard is
 * an ALLOW-LIST: a destination must be a known sanctioned kind to be permitted;
 * an unknown / unrecognised destination is refused (never silently allowed).
 *
 * ── Additive, no auth-seam change ───────────────────────────────────────────
 * This guard is NEW code. It does NOT modify the `createMcpClient` /
 * `checkMcpRole` role-separation seam (those carry 168 / 114 callers — HIGH
 * blast; modifying their signatures is out of scope). It composes ALONGSIDE the
 * existing auth + actor model ({71.23} actor.ts), mirroring the
 * propose-write-set / headless-complete-set declarative pattern.
 *
 * Spec: PRODUCT.md B-INV-12; TECH.md M12 + §B-INV-11/12 + §Testing-and-validation.
 */

/**
 * The three sanctioned write-back destination kinds (B-INV-12). The allow-list:
 * a write-back is permitted iff its destination is one of these.
 */
export const SANCTIONED_WRITE_BACK_DESTINATIONS = [
  // 1. local-fs canonical store (writeBackFileFirst edit-back + M-CREATE
  //    create-into-store).
  'local_fs_canonical_store',
  // 2. the live HubSpot↔Cowork connector (the only enabled source system).
  'hubspot_cowork_connector',
  // 3. outbound push delivery (the B-INV-11 push channel).
  'push_delivery',
] as const;

export type SanctionedWriteBackDestination =
  (typeof SANCTIONED_WRITE_BACK_DESTINATIONS)[number];

/**
 * The outcome of a write-back surface check. `allowed` is the load-bearing
 * signal; a refused write-back always carries a `reason` and is `allowed:
 * false`. `destination` echoes the requested destination for traceability.
 */
export interface WriteBackDecision {
  /** True iff the destination is one of the three sanctioned kinds. */
  readonly allowed: boolean;
  /** The requested destination, echoed. */
  readonly destination: string;
  /** Refusal reason; empty string on an allowed write-back. */
  readonly reason: string;
}

/**
 * Type-guard: is `destination` one of the three sanctioned write-back kinds?
 */
export function isSanctionedWriteBackDestination(
  destination: string,
): destination is SanctionedWriteBackDestination {
  return (SANCTIONED_WRITE_BACK_DESTINATIONS as readonly string[]).includes(
    destination,
  );
}

/**
 * Guard a write-back at the surface (B-INV-12).
 *
 * ALLOW-LIST semantics: the write-back is allowed iff its destination is one of
 * the three sanctioned kinds. Any other destination — most importantly a
 * net-new source system (SharePoint/Drive/etc. not already wired) — is REFUSED
 * with an explicit reason routing it to the WS-6 gate. An unknown destination
 * is NEVER silently allowed.
 *
 * @param destination the requested write-back destination kind.
 */
export function guardWriteBack(destination: string): WriteBackDecision {
  if (isSanctionedWriteBackDestination(destination)) {
    return { allowed: true, destination, reason: '' };
  }
  return {
    allowed: false,
    destination,
    reason:
      `Write-back refused at the surface: "${destination}" is not one of the ` +
      `three sanctioned destinations (${SANCTIONED_WRITE_BACK_DESTINATIONS.join(', ')}). ` +
      `A net-new source-system write-back stays WS-6-gated and is not enabled here.`,
  };
}

/**
 * Convenience: is a NET-NEW source-system write-back refused for this
 * destination? Returns `true` iff the destination is NOT sanctioned — i.e. the
 * surface refuses it. The L4 check asserts this for a SharePoint/Drive probe.
 */
export function netNewSourceSystemWriteBackRefused(
  destination: string,
): boolean {
  return !guardWriteBack(destination).allowed;
}
