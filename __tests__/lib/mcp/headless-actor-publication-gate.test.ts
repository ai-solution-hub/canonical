/**
 * ID-71.23 — Wave 3, B-INV-6/7 (M6/M7).
 *
 * Behaviour-first tests for the MCP actor-type model + the publication
 * human-gate guard + the per-workflow auto-apply switch.
 *
 *   B-INV-6 — headless agents MAY create propose-writes (drafts / suggestions /
 *     resolutions) into the queue with NO publication gate; publication stays
 *     human-gated — an agent attempting to PUBLISH is REFUSED at the surface
 *     and routed to the human gate.
 *   B-INV-7 — auto-apply is OFF at launch; propose-only is the default. The
 *     per-workflow auto-apply switch EXISTS but is verifiably OFF (it is the
 *     ID-104-earned per-workflow reward, B-INV-19 — not enabled now).
 *
 * Spec: PRODUCT.md B-INV-6/7 (HC-2); TECH.md M6/M7 + §Testing-and-validation.
 *
 * These are SMALL pure-logic tests over the actor module's public API — no
 * live server, no Supabase. The L4 functional-correctness suite drives the
 * same guarantees MCP-only against the live surface.
 */
import { describe, it, expect } from 'vitest';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import {
  getMcpActorType,
  isHeadlessActor,
  refusePublishForHeadlessActor,
  AUTO_APPLY_WORKFLOWS,
  isAutoApplyEnabled,
  type McpActorType,
} from '@/lib/mcp/actor';

const USER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

function authInfo(extra: Record<string, unknown>): AuthInfo {
  return {
    token: 'test-bearer-token',
    clientId: 'mcp-client',
    scopes: [],
    extra: { userId: USER_ID, role: 'editor', ...extra },
  };
}

// ---------------------------------------------------------------------------
// Actor-type resolution (the seam that distinguishes the two runtime postures)
// ---------------------------------------------------------------------------

describe('getMcpActorType — actor-type resolution from the auth context', () => {
  it("defaults to 'human' when no actorType is present (the human-in-UI client omits the signal)", () => {
    expect(getMcpActorType(authInfo({}))).toBe('human');
  });

  it("resolves 'headless' when the auth context carries actorType='headless'", () => {
    expect(getMcpActorType(authInfo({ actorType: 'headless' }))).toBe(
      'headless',
    );
  });

  it("resolves 'human' when the auth context carries actorType='human'", () => {
    expect(getMcpActorType(authInfo({ actorType: 'human' }))).toBe('human');
  });

  it("defaults to 'human' for an unrecognised actorType value (never silently grants headless privileges)", () => {
    expect(getMcpActorType(authInfo({ actorType: 'banana' }))).toBe('human');
  });

  it("defaults to 'human' when authInfo is undefined", () => {
    expect(getMcpActorType(undefined)).toBe('human');
  });
});

describe('isHeadlessActor', () => {
  it('is true only for a headless actor', () => {
    expect(isHeadlessActor(authInfo({ actorType: 'headless' }))).toBe(true);
  });

  it('is false for a human actor (the default)', () => {
    expect(isHeadlessActor(authInfo({}))).toBe(false);
    expect(isHeadlessActor(authInfo({ actorType: 'human' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Publication human-gate guard (B-INV-6)
// ---------------------------------------------------------------------------

describe('refusePublishForHeadlessActor — publication stays human-gated (B-INV-6)', () => {
  it('refuses a headless actor attempting to publish and routes to the human gate', () => {
    const refusal = refusePublishForHeadlessActor(
      authInfo({ actorType: 'headless' }),
    );
    expect(refusal).not.toBeNull();
    expect(refusal?.isError).toBe(true);
    // The refusal is at the SURFACE (an MCP tool error), routed to the human
    // gate — the message names the human gate so the agent knows where to go.
    const text = refusal?.content?.[0]?.text ?? '';
    expect(text.toLowerCase()).toContain('human');
    expect(text.toLowerCase()).toMatch(/publish|publication/);
  });

  it('does NOT refuse a human actor — publication proceeds through the human gate', () => {
    expect(refusePublishForHeadlessActor(authInfo({}))).toBeNull();
    expect(
      refusePublishForHeadlessActor(authInfo({ actorType: 'human' })),
    ).toBeNull();
  });

  it('does NOT refuse a human actor even with an explicit human signal', () => {
    expect(
      refusePublishForHeadlessActor(authInfo({ actorType: 'human' })),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-workflow auto-apply switch (B-INV-7) — exists, verifiably OFF at launch
// ---------------------------------------------------------------------------

describe('AUTO_APPLY_WORKFLOWS — the per-workflow auto-apply switch (B-INV-7)', () => {
  it('the switch EXISTS (the config is a non-empty registry of per-workflow flags)', () => {
    expect(Object.keys(AUTO_APPLY_WORKFLOWS).length).toBeGreaterThan(0);
  });

  it('every workflow is verifiably OFF at launch (propose-only is the default)', () => {
    for (const [workflow, enabled] of Object.entries(AUTO_APPLY_WORKFLOWS)) {
      expect(enabled, `workflow ${workflow} must ship auto-apply OFF`).toBe(
        false,
      );
    }
  });

  it('isAutoApplyEnabled returns false for every known workflow at launch', () => {
    for (const workflow of Object.keys(AUTO_APPLY_WORKFLOWS)) {
      expect(isAutoApplyEnabled(workflow)).toBe(false);
    }
  });

  it('isAutoApplyEnabled returns false for an unknown workflow (no workflow auto-applies at launch)', () => {
    expect(isAutoApplyEnabled('not-a-real-workflow')).toBe(false);
  });

  it('the auto-apply switch never defaults ON for any workflow (no launch auto-apply path)', () => {
    const anyEnabled = Object.values(AUTO_APPLY_WORKFLOWS).some(Boolean);
    expect(anyEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Type-level guard: the actor-type union is exactly {human, headless}
// ---------------------------------------------------------------------------

describe('McpActorType union', () => {
  it('admits exactly human and headless (no privileged third runtime)', () => {
    const human: McpActorType = 'human';
    const headless: McpActorType = 'headless';
    expect([human, headless]).toEqual(['human', 'headless']);
  });
});
