/**
 * MCP outgoing push channel — one trigger-driven delivery of a consumption
 * output, end-to-end.
 *
 * ID-71.24 — Wave 3, B-INV-11 (M11). The MVP pilot's
 * deliver-to-one-outbound-channel leg.
 *
 * Connectivity is bidirectional. INCOMING is the remote-MCP surface
 * (`app/api/mcp/[transport]/route.ts`, B-INV-10 — exists, no code change).
 * OUTGOING is THIS channel: a trigger-driven push that delivers a single
 * consumption output (e.g. an O4 reorientation briefing) to ONE outbound
 * channel, headlessly, with no human-in-UI step.
 *
 * ── Mechanism (TECH M11 leaves RSS/webhook/email open) ──────────────────────
 * TECH.md M11 specifies "one trigger-driven push channel (RSS/webhook/email)
 * delivering a consumption output" and leaves the concrete mechanism open. We
 * pick **webhook** — the simplest mechanism that proves end-to-end delivery:
 * a single HTTP POST of the rendered consumption output to a configured
 * outbound URL. No RSS feed store, no SMTP/email-provider account, no
 * inbox-polling — one request, one terminal delivery result, fully assertable
 * behaviour-first against a mocked transport.
 *
 * ── Transport seam (behaviour-first) ────────────────────────────────────────
 * The delivery is driven through an injectable `PushTransport`. The default
 * transport is a `fetch`-backed webhook POST; tests inject a mock transport and
 * assert the END-TO-END outcome (trigger → render → deliver → terminal result)
 * without a live network. The live L4 check supplies the real transport; when
 * the outbound webhook URL is not configured in the worktree the channel
 * reports a config-skip (an infra-skip, the same precedent as {71.22}'s
 * live-server checks) rather than a failure.
 *
 * ── This is NOT a publication event ─────────────────────────────────────────
 * Push DELIVERS an already-produced consumption output to an outbound channel.
 * It does not transition any content to `published` (that stays human-gated,
 * B-INV-6 / {71.23}). Push is one of the three sanctioned write-back
 * destinations (B-INV-12 / {71.24} write-back-surface.ts) precisely because it
 * is an outbound delivery, not a source-system write.
 *
 * Spec: PRODUCT.md B-INV-11; TECH.md M11 + §MVP + §Testing-and-validation.
 */

/** The push mechanisms TECH M11 admits; we ship `webhook`. */
export type PushMechanism = 'webhook' | 'rss' | 'email';

/** The mechanism this channel ships at launch (the simplest end-to-end proof). */
export const PUSH_MECHANISM: PushMechanism = 'webhook';

/**
 * A consumption output to push. The minimal shape a delivery needs: an
 * identifier for traceability, a human-readable title, and the rendered body.
 * `kind` records which consumption surface produced it (the §MVP pilot pushes
 * an O4 reorientation briefing).
 */
export interface ConsumptionOutput {
  /** Stable identifier for the output (e.g. the briefing/content id). */
  readonly id: string;
  /** The consumption surface that produced it (e.g. 'o4_reorientation_briefing'). */
  readonly kind: string;
  /** Human-readable title. */
  readonly title: string;
  /** The rendered body delivered to the outbound channel. */
  readonly body: string;
}

/**
 * What the transport receives: the destination plus the rendered payload. The
 * payload is the serialised consumption output the outbound channel consumes.
 */
export interface PushDelivery {
  /** The outbound channel URL the webhook POSTs to. */
  readonly url: string;
  /** The push mechanism used (always `webhook` at launch). */
  readonly mechanism: PushMechanism;
  /** The rendered payload (JSON string) delivered to the channel. */
  readonly payload: string;
  /** The source consumption output, for traceability. */
  readonly output: ConsumptionOutput;
}

/**
 * The terminal result of a push attempt. `delivered` is the end-to-end success
 * signal the L4 check and the unit test assert. A non-delivered result always
 * carries a `reason`; `skipped` distinguishes a config-skip (no outbound URL
 * configured — infra-skip) from a genuine delivery failure.
 */
export interface PushResult {
  /** True iff the consumption output was delivered end-to-end to the channel. */
  readonly delivered: boolean;
  /** True iff delivery was skipped because the channel is not configured. */
  readonly skipped: boolean;
  /** Mechanism used / attempted. */
  readonly mechanism: PushMechanism;
  /** The output id, echoed for traceability. */
  readonly outputId: string;
  /** Failure / skip reason; empty string on a delivered result. */
  readonly reason: string;
}

/**
 * The delivery transport seam. A transport takes a fully-formed delivery and
 * returns whether the outbound channel accepted it. The default transport
 * POSTs the payload over HTTP (webhook); tests inject a mock that records the
 * delivery and returns a deterministic outcome.
 */
export interface PushTransport {
  /**
   * Deliver the payload to the outbound channel. Returns `true` iff the channel
   * accepted it. MUST NOT throw for a transport-level rejection — return
   * `false`; throwing is reserved for genuinely unexpected errors so the caller
   * can surface them rather than silently swallow a delivery failure.
   */
  send(delivery: PushDelivery): Promise<boolean>;
}

/**
 * Render a consumption output to the wire payload the outbound channel
 * consumes. Kept separate so the rendered shape is assertable independently of
 * the transport.
 */
export function renderConsumptionOutput(output: ConsumptionOutput): string {
  return JSON.stringify({
    id: output.id,
    kind: output.kind,
    title: output.title,
    body: output.body,
    deliveredAt: new Date().toISOString(),
  });
}

/**
 * The default webhook transport: a single HTTP POST of the rendered payload to
 * the configured outbound URL. A 2xx response is a delivery; any other status
 * (or a network error) is a non-delivery (returns `false`), never a silent
 * success.
 */
export const webhookTransport: PushTransport = {
  async send(delivery: PushDelivery): Promise<boolean> {
    try {
      const response = await fetch(delivery.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: delivery.payload,
      });
      return response.ok;
    } catch {
      // Network-level failure is a non-delivery, surfaced as `delivered: false`
      // by the caller — not a thrown error and not a silent success.
      return false;
    }
  },
};

/**
 * The trigger-driven push: deliver ONE consumption output to ONE outbound
 * channel, end-to-end (B-INV-11).
 *
 * This is the function a scheduled / headless trigger calls (the §MVP pilot's
 * cron → remote-MCP → render briefing → push leg). It:
 *   1. resolves the outbound channel URL (arg, else `MCP_PUSH_WEBHOOK_URL`);
 *      when none is configured it returns a config-skip (infra-skip) — NOT a
 *      failure — so the worktree run without delivery secrets degrades cleanly;
 *   2. renders the consumption output to the wire payload;
 *   3. delivers it through the transport (default webhook; mock in tests);
 *   4. returns a terminal {@link PushResult} the caller (and the L4 check)
 *      asserts on.
 *
 * @param output  the consumption output to deliver.
 * @param options injectable transport + explicit outbound URL (tests supply a
 *                mock transport and an in-memory URL; production omits both and
 *                gets the webhook transport + the configured env URL).
 */
export async function pushConsumptionOutput(
  output: ConsumptionOutput,
  options: {
    transport?: PushTransport;
    url?: string;
  } = {},
): Promise<PushResult> {
  const url = options.url ?? process.env.MCP_PUSH_WEBHOOK_URL ?? '';
  const mechanism = PUSH_MECHANISM;

  if (!url) {
    // No outbound channel configured — config-skip (infra-skip), not a failure.
    return {
      delivered: false,
      skipped: true,
      mechanism,
      outputId: output.id,
      reason:
        'no outbound channel configured (MCP_PUSH_WEBHOOK_URL unset) — push skipped',
    };
  }

  const transport = options.transport ?? webhookTransport;
  const payload = renderConsumptionOutput(output);
  const delivery: PushDelivery = { url, mechanism, payload, output };

  const accepted = await transport.send(delivery);
  return {
    delivered: accepted,
    skipped: false,
    mechanism,
    outputId: output.id,
    reason: accepted ? '' : 'outbound channel rejected the delivery',
  };
}
