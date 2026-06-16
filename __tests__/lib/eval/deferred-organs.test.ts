/**
 * Deferred eval-refinement organs register (ID-104.19 / T24 / B-INV-24).
 *
 * B-INV-24 pass: the three deferred organs are recorded as a NAMED follow-up
 * with a signal-volume gating condition + a back-pointer to B-INV-24, and the
 * `patterns`/`proposals` endpoints anchor them present-but-empty. Fail: an organ
 * is built at v1 now, OR an organ is dropped without a recorded gate/back-pointer
 * (a silent orphan). This guard holds the named-deferral shape.
 *
 * Spec: specs/id-104-eval-engine/{PRODUCT,TECH}.md §H (B-INV-24).
 */
import { describe, it, expect } from 'vitest';
import {
  DEFERRED_ORGANS,
  deferredOrgansForAnchor,
  type DeferredOrganId,
} from '@/lib/eval/deferred-organs';

describe('deferred eval-refinement organs register (B-INV-24)', () => {
  it('names exactly the three deferred organs', () => {
    const ids = DEFERRED_ORGANS.map((organ) => organ.id).sort();
    expect(ids).toEqual<DeferredOrganId[]>([
      'ab_runner',
      'auto_rollback',
      'pattern_detector',
    ]);
  });

  it('records each organ as a named follow-up: name + summary + signal-volume gate + B-INV-24 back-pointer + anchor', () => {
    for (const organ of DEFERRED_ORGANS) {
      expect(organ.name.length).toBeGreaterThan(0);
      expect(organ.summary.length).toBeGreaterThan(0);
      // The gating condition must reference accumulating signal — the deferral
      // is gated on signal volume, not silently dropped.
      expect(organ.gating_condition).toMatch(/signal|ai_call_events/i);
      // Back-pointer to the spec invariant — NOT a silent orphan.
      expect(organ.back_pointer).toBe('B-INV-24');
      // Anchored by a present-but-empty endpoint (T22).
      expect(organ.anchor_endpoint).toMatch(
        /^\/api\/refinement\/touchpoints\/\[id\]\/(patterns|proposals)$/,
      );
    }
  });

  it('anchors the cross-touchpoint pattern detector to the patterns endpoint', () => {
    expect(deferredOrgansForAnchor('patterns')).toEqual<DeferredOrganId[]>([
      'pattern_detector',
    ]);
  });

  it('anchors the A/B runner + auto-rollback registry to the proposals endpoint', () => {
    expect(deferredOrgansForAnchor('proposals')).toEqual<DeferredOrganId[]>([
      'ab_runner',
      'auto_rollback',
    ]);
  });
});
