/**
 * Tests for §1.16 WP1-P2 — holder metadata derivation + dedup merge.
 *
 * Covers:
 * - `deriveHolderMetadata` helper: self-held, supplier-held, no-match,
 *   non-certification rows skipped.
 * - `dedupeEntityMentionRows` metadata merge: disjoint keys, one-null,
 *   both-null, collision (later wins).
 *
 * Pure-function tests — no mocks, no live Supabase.
 */

import { describe, it, expect } from 'vitest';
import {
  dedupeEntityMentionRows,
  deriveHolderMetadata,
  type EntityMentionRow,
  type ExtractedRelationship,
} from '@/lib/ai/classify';
import { BRANDING } from '@/lib/client-config';

const ITEM_A = '11111111-1111-4111-8111-111111111111';

/** Build an EntityMentionRow with sensible defaults. */
function row(overrides: Partial<EntityMentionRow>): EntityMentionRow {
  return {
    content_item_id: ITEM_A,
    entity_type: 'certification',
    entity_name: 'ISO 27001',
    canonical_name: 'iso 27001',
    confidence: 1.0,
    context_snippet: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// deriveHolderMetadata
// ---------------------------------------------------------------------------

describe('deriveHolderMetadata', () => {
  const selfOrgName = BRANDING.organisationName;

  it('sets holder = "self" when holds source matches client org name', () => {
    const rows: EntityMentionRow[] = [
      row({ canonical_name: 'iso 27001' }),
    ];
    const rels: ExtractedRelationship[] = [
      { source: selfOrgName, relationship: 'holds', target: 'ISO 27001' },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(1);
    expect(rows[0].metadata).toEqual({ holder: 'self' });
  });

  it('sets holder = "supplier" with supplier_name when source differs from client org', () => {
    const rows: EntityMentionRow[] = [
      row({ canonical_name: 'iso 27001' }),
    ];
    const rels: ExtractedRelationship[] = [
      { source: 'example-datacentre Europe', relationship: 'holds', target: 'ISO 27001' },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(1);
    expect(rows[0].metadata).toEqual({
      holder: 'supplier',
      supplier_name: 'example-datacentre europe',
    });
  });

  it('leaves metadata unset when no matching holds relationship exists', () => {
    const rows: EntityMentionRow[] = [
      row({ canonical_name: 'iso 27001' }),
    ];
    const rels: ExtractedRelationship[] = [
      { source: selfOrgName, relationship: 'complies_with', target: 'GDPR' },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(0);
    expect(rows[0].metadata).toBeUndefined();
  });

  it('skips non-certification entity rows', () => {
    const rows: EntityMentionRow[] = [
      row({ entity_type: 'organisation', canonical_name: 'acme ltd' }),
    ];
    const rels: ExtractedRelationship[] = [
      { source: selfOrgName, relationship: 'holds', target: 'Acme Ltd' },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(0);
    expect(rows[0].metadata).toBeUndefined();
  });

  it('handles mixed self + supplier certs in one batch', () => {
    const rows: EntityMentionRow[] = [
      row({ canonical_name: 'iso 27001' }),
      row({ canonical_name: 'iso 9001' }),
      row({ canonical_name: 'iso 14001' }),
    ];
    const rels: ExtractedRelationship[] = [
      { source: selfOrgName, relationship: 'holds', target: 'ISO 27001' },
      { source: 'example-datacentre Europe', relationship: 'holds', target: 'ISO 9001' },
      // No holds for ISO 14001
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(2);
    expect(rows[0].metadata).toEqual({ holder: 'self' });
    expect(rows[1].metadata).toEqual({
      holder: 'supplier',
      supplier_name: 'example-datacentre europe',
    });
    expect(rows[2].metadata).toBeUndefined();
  });

  it('resolves target via canonicalise + resolveAlias (case-insensitive)', () => {
    const rows: EntityMentionRow[] = [
      row({ canonical_name: 'iso 27001' }),
    ];
    // Use non-canonical casing in the relationship target
    const rels: ExtractedRelationship[] = [
      { source: selfOrgName, relationship: 'holds', target: 'iso27001' },
    ];

    const count = deriveHolderMetadata(rows, rels);

    // canonicalise('iso27001') should normalise to 'iso 27001'
    expect(count).toBe(1);
    expect(rows[0].metadata).toEqual({ holder: 'self' });
  });

  it('returns 0 for an empty relationships array', () => {
    const rows: EntityMentionRow[] = [
      row({ canonical_name: 'iso 27001' }),
    ];

    const count = deriveHolderMetadata(rows, []);

    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dedupeEntityMentionRows — metadata merge tests
// ---------------------------------------------------------------------------

describe('dedupeEntityMentionRows — metadata merge', () => {
  it('preserves disjoint metadata keys when merging duplicates', () => {
    const input: EntityMentionRow[] = [
      row({
        entity_name: 'ISO 27001',
        canonical_name: 'iso 27001',
        confidence: 0.8,
        metadata: { holder: 'self' },
      }),
      row({
        entity_name: 'ISO27001',
        canonical_name: 'iso 27001',
        confidence: 0.9,
        metadata: { supplier_name: 'foo' },
      }),
    ];

    const result = dedupeEntityMentionRows(input);

    expect(result).toHaveLength(1);
    expect(result[0].metadata).toEqual({
      holder: 'self',
      supplier_name: 'foo',
    });
  });

  it('merges when one row has metadata and the other is null', () => {
    const input: EntityMentionRow[] = [
      row({
        canonical_name: 'iso 27001',
        metadata: null,
      }),
      row({
        canonical_name: 'iso 27001',
        metadata: { holder: 'supplier', supplier_name: 'example-datacentre' },
      }),
    ];

    const result = dedupeEntityMentionRows(input);

    expect(result).toHaveLength(1);
    expect(result[0].metadata).toEqual({
      holder: 'supplier',
      supplier_name: 'example-datacentre',
    });
  });

  it('merges when one row has metadata and the other is undefined', () => {
    const input: EntityMentionRow[] = [
      row({
        canonical_name: 'iso 27001',
        // metadata is implicitly undefined (not set)
      }),
      row({
        canonical_name: 'iso 27001',
        metadata: { holder: 'self' },
      }),
    ];

    const result = dedupeEntityMentionRows(input);

    expect(result).toHaveLength(1);
    expect(result[0].metadata).toEqual({ holder: 'self' });
  });

  it('does not create empty object when both rows have null/undefined metadata', () => {
    const input: EntityMentionRow[] = [
      row({
        canonical_name: 'iso 27001',
        metadata: null,
      }),
      row({
        canonical_name: 'iso 27001',
        metadata: undefined,
      }),
    ];

    const result = dedupeEntityMentionRows(input);

    expect(result).toHaveLength(1);
    // Must not be {} — should remain falsy
    expect(result[0].metadata).toBeFalsy();
  });

  it('later row metadata keys win on collision', () => {
    const input: EntityMentionRow[] = [
      row({
        canonical_name: 'iso 27001',
        metadata: { holder: 'self', version: '2013' },
      }),
      row({
        canonical_name: 'iso 27001',
        metadata: { holder: 'supplier', supplier_name: 'example-datacentre' },
      }),
    ];

    const result = dedupeEntityMentionRows(input);

    expect(result).toHaveLength(1);
    expect(result[0].metadata).toEqual({
      holder: 'supplier',
      supplier_name: 'example-datacentre',
      version: '2013',
    });
  });
});
