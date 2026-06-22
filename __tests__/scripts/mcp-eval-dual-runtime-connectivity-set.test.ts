/**
 * ID-71.24 — Wave 3 dual-runtime + bidirectional-connectivity enumeration
 * (B-INV-8/9/10/11/12).
 *
 * Behaviour-first assertions over the PUBLIC declarations, the THIRD companion
 * to mcp-eval-headless-complete-set.test.ts ({71.22}) and
 * mcp-eval-propose-write-set.test.ts ({71.23}). These are the Checker's
 * verbatim confirmation surface for dual runtime + bidirectional connectivity:
 *
 *   B-INV-8/9 — goose inventory EQUALS Claude inventory (actor-independent
 *     tool visibility over the SAME remote-MCP surface).
 *   B-INV-11 — ONE push delivered end-to-end (proved via a mocked transport).
 *   B-INV-12 — net-new source-system write-back REFUSED at the surface; the
 *     three sanctioned destinations allowed.
 *
 * Spec: PRODUCT.md B-INV-8..12; TECH.md M8-M12 + §MVP + §Testing-and-validation.
 */
import { describe, expect, it } from 'vitest';

import {
  INVENTORY_ACTOR_HEADERS,
  inventoriesEqual,
  SANCTIONED_WRITE_BACK_DESTINATIONS,
  guardWriteBack,
  NET_NEW_SOURCE_SYSTEM_PROBE,
  netNewWriteBackRefusedAtSurface,
  allSanctionedDestinationsAllowed,
  deliverPilotPush,
  PILOT_CONSUMPTION_OUTPUT,
  PUSH_MECHANISM,
} from '@/scripts/mcp-eval/dual-runtime-connectivity-set';
import {
  pushConsumptionOutput,
  renderConsumptionOutput,
  type PushDelivery,
  type PushTransport,
} from '@/lib/mcp/push-channel';
import {
  isSanctionedWriteBackDestination,
  netNewSourceSystemWriteBackRefused,
} from '@/lib/mcp/write-back-surface';

// ---------------------------------------------------------------------------
// B-INV-8/9 — dual runtime, identical inventory
// ---------------------------------------------------------------------------

describe('inventory equality — goose inventory == Claude inventory (B-INV-8/9)', () => {
  it('serves both the human (Claude) and headless (goose) actor headers', () => {
    expect(INVENTORY_ACTOR_HEADERS).toEqual(['human', 'headless']);
  });

  it('treats two identical inventories as equal regardless of order', () => {
    const claude = ['find', 'get_reorientation', 'where_are_we_exposed'];
    const goose = ['where_are_we_exposed', 'find', 'get_reorientation'];
    expect(inventoriesEqual(claude, goose)).toBe(true);
  });

  it('treats inventories with a missing tool as NOT equal (a runtime-privileged entry would fail this)', () => {
    const claude = ['find', 'get_reorientation', 'where_are_we_exposed'];
    const gooseMissingOne = ['find', 'get_reorientation'];
    expect(inventoriesEqual(claude, gooseMissingOne)).toBe(false);
  });

  it('treats inventories with an extra tool as NOT equal', () => {
    const claude = ['find', 'get_reorientation'];
    const gooseExtra = ['find', 'get_reorientation', 'secret_headless_tool'];
    expect(inventoriesEqual(claude, gooseExtra)).toBe(false);
  });

  it('treats same-length but differing inventories as NOT equal', () => {
    expect(inventoriesEqual(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B-INV-12 — write-back scoped to three sanctioned destinations
// ---------------------------------------------------------------------------

describe('write-back surface guard — three sanctioned destinations (B-INV-12)', () => {
  it('enumerates exactly the three sanctioned destinations', () => {
    expect([...SANCTIONED_WRITE_BACK_DESTINATIONS].sort()).toEqual([
      'hubspot_cowork_connector',
      'local_fs_canonical_store',
      'push_delivery',
    ]);
  });

  it('allows every sanctioned destination', () => {
    expect(allSanctionedDestinationsAllowed()).toBe(true);
    for (const d of SANCTIONED_WRITE_BACK_DESTINATIONS) {
      expect(guardWriteBack(d).allowed).toBe(true);
      expect(isSanctionedWriteBackDestination(d)).toBe(true);
    }
  });

  it('refuses a net-new source-system write-back at the surface', () => {
    expect(netNewWriteBackRefusedAtSurface()).toBe(true);
    const decision = guardWriteBack(NET_NEW_SOURCE_SYSTEM_PROBE);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/refused at the surface/i);
    expect(decision.reason).toMatch(/WS-6/);
  });

  it('refuses any unknown destination (allow-list, never silently permits)', () => {
    expect(netNewSourceSystemWriteBackRefused('google_drive_net_new')).toBe(
      true,
    );
    expect(guardWriteBack('arbitrary_unknown').allowed).toBe(false);
    expect(guardWriteBack('').allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B-INV-11 — one push delivered end-to-end (behaviour, via mock transport)
// ---------------------------------------------------------------------------

describe('push channel — one consumption output delivered end-to-end (B-INV-11)', () => {
  it('ships the webhook mechanism (the simplest end-to-end proof)', () => {
    expect(PUSH_MECHANISM).toBe('webhook');
  });

  it('delivers the pilot consumption output end-to-end through the transport', async () => {
    const sent: PushDelivery[] = [];
    const mockTransport: PushTransport = {
      async send(delivery) {
        sent.push(delivery);
        return true;
      },
    };

    const result = await deliverPilotPush(
      mockTransport,
      'https://outbound.example/hook',
    );

    // The end-to-end success signal.
    expect(result.delivered).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.outputId).toBe(PILOT_CONSUMPTION_OUTPUT.id);
    expect(result.reason).toBe('');

    // The transport received exactly one delivery carrying the rendered output.
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://outbound.example/hook');
    expect(sent[0].mechanism).toBe('webhook');
    const payload = JSON.parse(sent[0].payload);
    expect(payload.id).toBe(PILOT_CONSUMPTION_OUTPUT.id);
    expect(payload.kind).toBe('o4_reorientation_briefing');
    expect(payload.body).toBe(PILOT_CONSUMPTION_OUTPUT.body);
  });

  it('reports a non-delivery (not a silent success) when the channel rejects', async () => {
    const rejectingTransport: PushTransport = {
      async send() {
        return false;
      },
    };
    const result = await pushConsumptionOutput(PILOT_CONSUMPTION_OUTPUT, {
      transport: rejectingTransport,
      url: 'https://outbound.example/hook',
    });
    expect(result.delivered).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.reason).toMatch(/rejected/i);
  });

  it('config-skips (infra-skip, not a failure) when no outbound channel is configured', async () => {
    const prior = process.env.MCP_PUSH_WEBHOOK_URL;
    delete process.env.MCP_PUSH_WEBHOOK_URL;
    try {
      const result = await pushConsumptionOutput(PILOT_CONSUMPTION_OUTPUT);
      expect(result.delivered).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.reason).toMatch(/no outbound channel configured/i);
    } finally {
      if (prior !== undefined) process.env.MCP_PUSH_WEBHOOK_URL = prior;
    }
  });

  it('renders the consumption output to a JSON payload the outbound channel consumes', () => {
    const payload = JSON.parse(
      renderConsumptionOutput(PILOT_CONSUMPTION_OUTPUT),
    );
    expect(payload.id).toBe(PILOT_CONSUMPTION_OUTPUT.id);
    expect(payload.title).toBe(PILOT_CONSUMPTION_OUTPUT.title);
    expect(typeof payload.deliveredAt).toBe('string');
  });
});
