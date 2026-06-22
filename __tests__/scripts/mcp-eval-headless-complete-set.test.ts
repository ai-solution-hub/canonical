/**
 * ID-71.22 — Wave 3 headless-complete read set enumeration (B-INV-1/2/3/4/5).
 *
 * Behaviour-first assertions over the PUBLIC enumeration export
 * (`HEADLESS_COMPLETE_SET`). The enumeration declares the launch
 * headless-complete read set the L4 functional-correctness suite drives
 * MCP-only to a terminal result. These tests are the Checker's verbatim
 * confirmation surface: they assert the set is EXACTLY {O1/O4/O6 reads + W5.6}
 * — no extras, no omissions — and that each member carries the assertion its
 * spec invariant requires.
 *
 * Spec: PRODUCT.md B-INV-1..5 (HC-1); TECH.md M1-M5 + §Testing-and-validation.
 *   B-INV-1 — enumerate exactly {O1/O4/O6 reads + W5.6}
 *   B-INV-2 — each driven MCP-only to a terminal result, zero human-in-UI step
 *   B-INV-3 — O4 widened beyond KH state (non-KH-state dimension surfaced)
 *   B-INV-4 — O6 five-layer ordering + >=1 resolution affordance
 *   B-INV-5 — W5.6 re-syndication MCP-only to a delivered re-syndication
 */
import { describe, expect, it } from 'vitest';

import {
  HEADLESS_COMPLETE_SET,
  HEADLESS_COMPLETE_OUTCOMES,
  FIVE_LAYER_ORDER,
  type HeadlessCompleteMember,
} from '@/scripts/mcp-eval/headless-complete-set';
import { CANONICAL_TOOL_NAMES } from '@/scripts/mcp-eval/fixtures';

describe('HEADLESS_COMPLETE_SET enumeration (B-INV-1)', () => {
  it('enumerates exactly the O1/O4/O6 reads plus W5.6 — no other outcome', () => {
    const outcomes = HEADLESS_COMPLETE_SET.map((m) => m.outcome).sort();
    expect(outcomes).toEqual(['O1', 'O4', 'O6', 'W5.6']);
  });

  it('declares exactly four members (no extras, no omissions)', () => {
    expect(HEADLESS_COMPLETE_SET).toHaveLength(4);
    expect(HEADLESS_COMPLETE_OUTCOMES).toEqual(['O1', 'O4', 'O6', 'W5.6']);
  });

  it('admits no outcome outside the launch headless union', () => {
    const launchUnion = new Set(['O1', 'O4', 'O6', 'W5.6']);
    for (const member of HEADLESS_COMPLETE_SET) {
      expect(launchUnion.has(member.outcome)).toBe(true);
    }
  });
});

describe('each member is driven MCP-only to a terminal result (B-INV-2)', () => {
  it('drives every member via a real, registered MCP tool entry', () => {
    for (const member of HEADLESS_COMPLETE_SET) {
      expect(
        (CANONICAL_TOOL_NAMES as readonly string[]).includes(member.mcpTool),
      ).toBe(true);
    }
  });

  it('invokes no human-in-UI step for any member', () => {
    for (const member of HEADLESS_COMPLETE_SET) {
      expect(member.uiOnly).toBe(false);
    }
  });

  // The App-trigger tools render an interactive MCP App surface (a UI
  // affordance). They are the UI-only counterparts of the headless reads and
  // MUST NOT be the enumerated drivers — the headless read is the `get_*` /
  // `trigger_*` entry, not the `show_*` App trigger.
  it('never enumerates a show_* App-trigger tool as the headless driver', () => {
    for (const member of HEADLESS_COMPLETE_SET) {
      expect(member.mcpTool.startsWith('show_')).toBe(false);
    }
  });
});

describe('O1 find/answer read', () => {
  const o1 = byOutcome('O1');

  it('is driven by the consolidated find entry', () => {
    expect(o1.mcpTool).toBe('find');
  });
});

describe('O4 reorientation/briefing read (B-INV-3 — widened beyond KH state)', () => {
  const o4 = byOutcome('O4');

  it('is driven by the headless reorientation read, not the App trigger', () => {
    expect(o4.mcpTool).toBe('get_reorientation');
  });

  it('asserts a non-KH-state dimension (reorients the person, not only KH state)', () => {
    expect(o4.assertsNonKhStateDimension).toBe(true);
    expect(o4.nonKhStateDimension).toBeTruthy();
    expect(typeof o4.nonKhStateDimension).toBe('string');
  });
});

describe('O6 exposure read (B-INV-4 — five-layer + resolution)', () => {
  const o6 = byOutcome('O6');

  it('is driven by the consolidated five-layer exposure entry', () => {
    expect(o6.mcpTool).toBe('where_are_we_exposed');
  });

  it('asserts the five-layer ordering: data -> quality -> use_today -> gaps -> opportunities', () => {
    expect(o6.assertsFiveLayer).toBe(true);
    expect(o6.fiveLayerOrder).toEqual(FIVE_LAYER_ORDER);
    expect(FIVE_LAYER_ORDER).toEqual([
      'data',
      'quality',
      'use_today',
      'gaps',
      'opportunities',
    ]);
  });

  it('asserts at least one suggested-resolution affordance', () => {
    expect(o6.assertsResolutionAffordance).toBe(true);
  });
});

describe('W5.6 re-syndication (B-INV-5 — MCP-only to a delivered re-syndication)', () => {
  const w56 = byOutcome('W5.6');

  it('is driven by an MCP re-syndication entry, not a UI feed App', () => {
    expect(w56.mcpTool).toBe('trigger_intelligence_poll');
    expect(w56.uiOnly).toBe(false);
  });

  it('re-distributes an already-published consumption output (not a net-new publication gate)', () => {
    expect(w56.reSyndicatesPublishedOutput).toBe(true);
  });
});

function byOutcome(outcome: string): HeadlessCompleteMember {
  const member = HEADLESS_COMPLETE_SET.find((m) => m.outcome === outcome);
  if (!member) {
    throw new Error(`headless-complete set is missing outcome ${outcome}`);
  }
  return member;
}
