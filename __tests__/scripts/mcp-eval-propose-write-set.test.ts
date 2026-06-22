/**
 * ID-71.23 — Wave 3 propose-write + publish-refusal + auto-apply-off
 * enumeration (B-INV-6/7).
 *
 * Behaviour-first assertions over the PUBLIC declarations
 * (`PROPOSE_WRITE_TOOLS`, `PUBLISH_GATED_TRANSITIONS`, `AUTO_APPLY_WORKFLOWS`).
 * Companion to mcp-eval-headless-complete-set.test.ts ({71.22}). These are the
 * Checker's verbatim confirmation surface for the WRITE discipline:
 *
 *   B-INV-6 — headless propose-writes allowed (no publication gate); publish
 *     refused at the surface + routed to the human gate.
 *   B-INV-7 — auto-apply OFF at launch (propose-only default); the switch
 *     EXISTS but is verifiably OFF for every workflow.
 *
 * Spec: PRODUCT.md B-INV-6/7 (HC-2); TECH.md M6/M7 + §Testing-and-validation.
 */
import { describe, expect, it } from 'vitest';

import {
  PROPOSE_WRITE_TOOLS,
  PUBLISH_GATED_TRANSITIONS,
  AUTO_APPLY_WORKFLOWS,
  autoApplyVerifiablyOff,
} from '@/scripts/mcp-eval/propose-write-set';
import { CANONICAL_TOOL_NAMES } from '@/scripts/mcp-eval/fixtures';

describe('PROPOSE_WRITE_TOOLS — headless propose-writes (B-INV-6)', () => {
  it('every propose-write tool is a real, registered MCP entry', () => {
    for (const tool of PROPOSE_WRITE_TOOLS) {
      expect(
        (CANONICAL_TOOL_NAMES as readonly string[]).includes(tool),
        `propose-write tool ${tool} must be a registered MCP entry`,
      ).toBe(true);
    }
  });

  it('includes the M-CREATE create-into-store leg (create_content_item)', () => {
    expect(PROPOSE_WRITE_TOOLS).toContain('create_content_item');
  });

  it('enumerates a non-empty propose-write set (the read-set propose path exists)', () => {
    expect(PROPOSE_WRITE_TOOLS.length).toBeGreaterThan(0);
  });
});

describe('PUBLISH_GATED_TRANSITIONS — publication human-gate (B-INV-6)', () => {
  it('gates exactly the two publication-status transition tools', () => {
    const tools = PUBLISH_GATED_TRANSITIONS.map((t) => t.mcpTool).sort();
    expect(tools).toEqual([
      'update_governance_status',
      'update_publication_status',
    ]);
  });

  it('every gated transition names a registered MCP tool', () => {
    for (const t of PUBLISH_GATED_TRANSITIONS) {
      expect(
        (CANONICAL_TOOL_NAMES as readonly string[]).includes(t.mcpTool),
      ).toBe(true);
    }
  });

  it('every gated transition declares a publish value and a distinct propose value', () => {
    for (const t of PUBLISH_GATED_TRANSITIONS) {
      expect(t.publishValue).toBeTruthy();
      expect(t.proposeValue).toBeTruthy();
      expect(t.publishValue).not.toBe(t.proposeValue);
    }
  });

  it('the publishing value of update_publication_status is "published"', () => {
    const t = PUBLISH_GATED_TRANSITIONS.find(
      (x) => x.mcpTool === 'update_publication_status',
    );
    expect(t?.publishValue).toBe('published');
  });

  it('the publishing value of update_governance_status is "publish"', () => {
    const t = PUBLISH_GATED_TRANSITIONS.find(
      (x) => x.mcpTool === 'update_governance_status',
    );
    expect(t?.publishValue).toBe('publish');
  });
});

describe('AUTO_APPLY_WORKFLOWS — per-workflow auto-apply switch (B-INV-7)', () => {
  it('the switch exists (non-empty registry)', () => {
    expect(Object.keys(AUTO_APPLY_WORKFLOWS).length).toBeGreaterThan(0);
  });

  it('every workflow is verifiably OFF at launch', () => {
    expect(autoApplyVerifiablyOff()).toBe(true);
  });

  it('no workflow ships with auto-apply enabled', () => {
    expect(Object.values(AUTO_APPLY_WORKFLOWS).some(Boolean)).toBe(false);
  });
});
