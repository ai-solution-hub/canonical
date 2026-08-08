/**
 * {132.49} G-CONCEPT-GRAPH-UNION — the union-graph concept-id scheme.
 *
 * The union graph merges sibling bundles into one node set, so ids are
 * qualified by their owning `bundleId`. Server (graph build) and client
 * (link resolution) both depend on this being ONE scheme — these cases pin
 * the round-trip that makes a resolved link target match a served node id.
 */
import { describe, it, expect } from 'vitest';
import {
  namespaceUnionId,
  splitUnionId,
  UNION_ID_SEPARATOR,
} from '@/lib/okf/union-id';

describe('union concept ids', () => {
  it('qualifies a bundle-relative concept id with its owning bundle', () => {
    expect(namespaceUnionId('acme', 'services/orders')).toBe(
      `acme${UNION_ID_SEPARATOR}services/orders`,
    );
  });

  it('recovers the bundle and concept from a namespaced id', () => {
    expect(splitUnionId('acme::services/orders')).toEqual({
      bundleId: 'acme',
      conceptId: 'services/orders',
    });
  });

  it('reports no bundle for a bare per-bundle id, leaving it untouched', () => {
    // `<BundleViewer>` serves un-namespaced ids; callers must be able to
    // treat both views uniformly without knowing which one they are in.
    expect(splitUnionId('services/orders')).toEqual({
      bundleId: null,
      conceptId: 'services/orders',
    });
  });

  it('survives a round-trip for every bundle and concept shape in play', () => {
    const cases: Array<[string, string]> = [
      ['acme', 'glossary'],
      ['acme', 'services/orders'],
      ['my.bundle-1', 'a/b/c'],
      ['acme', 'weird::path'], // separator inside the concept path
    ];
    for (const [bundleId, conceptId] of cases) {
      expect(splitUnionId(namespaceUnionId(bundleId, conceptId))).toEqual({
        bundleId,
        conceptId,
      });
    }
  });
});
