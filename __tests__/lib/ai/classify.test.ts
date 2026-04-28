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
    const rows: EntityMentionRow[] = [row({ canonical_name: 'iso 27001' })];
    const rels: ExtractedRelationship[] = [
      { source: selfOrgName, relationship: 'holds', target: 'ISO 27001' },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(1);
    expect(rows[0].metadata).toEqual({ holder: 'self' });
  });

  it('sets holder = "supplier" with supplier_name when source differs from client org', () => {
    const rows: EntityMentionRow[] = [row({ canonical_name: 'iso 27001' })];
    const rels: ExtractedRelationship[] = [
      {
        source: 'example-datacentre Europe',
        relationship: 'holds',
        target: 'ISO 27001',
      },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(1);
    expect(rows[0].metadata).toEqual({
      holder: 'supplier',
      supplier_name: 'example-datacentre europe',
    });
  });

  it('leaves metadata unset when no matching holds relationship exists', () => {
    const rows: EntityMentionRow[] = [row({ canonical_name: 'iso 27001' })];
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
    const rows: EntityMentionRow[] = [row({ canonical_name: 'iso 27001' })];
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
    const rows: EntityMentionRow[] = [row({ canonical_name: 'iso 27001' })];

    const count = deriveHolderMetadata(rows, []);

    expect(count).toBe(0);
  });

  // ---------------------------------------------------------------------
  // S196 synonym fallback: `complies_with` / `evidences` accepted as
  // `holds` ONLY when target is a certification entity AND no canonical
  // `holds` rel exists for that target.
  // ---------------------------------------------------------------------

  it('accepts `complies_with` as holds-synonym for cert targets (self)', () => {
    const rows: EntityMentionRow[] = [row({ canonical_name: 'iso 27001' })];
    const rels: ExtractedRelationship[] = [
      {
        source: selfOrgName,
        relationship: 'complies_with',
        target: 'ISO 27001',
      },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(1);
    expect(rows[0].metadata).toEqual({ holder: 'self' });
  });

  it('accepts `evidences` as holds-synonym for cert targets (self)', () => {
    const rows: EntityMentionRow[] = [
      row({ canonical_name: 'cyber essentials plus' }),
    ];
    const rels: ExtractedRelationship[] = [
      {
        source: selfOrgName,
        relationship: 'evidences',
        target: 'Cyber Essentials Plus',
      },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(1);
    expect(rows[0].metadata).toEqual({ holder: 'self' });
  });

  it('accepts synonym for supplier-held certs when supplier is extracted as org', () => {
    // Supplier case requires the supplier to be extracted as an
    // organisation entity in the same batch — the tightened rule
    // prevents garbage rels like "ISO 27001 complies_with X" from
    // deriving cert-held-by-cert metadata.
    const rows: EntityMentionRow[] = [
      row({ canonical_name: 'iso 27001' }),
      row({ entity_type: 'organisation', canonical_name: 'example-datacentre europe' }),
    ];
    const rels: ExtractedRelationship[] = [
      {
        source: 'example-datacentre Europe',
        relationship: 'complies_with',
        target: 'ISO 27001',
      },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(1);
    expect(rows[0].metadata).toEqual({
      holder: 'supplier',
      supplier_name: 'example-datacentre europe',
    });
  });

  it('rejects synonym when source is a cert (prevents cert-to-cert garbage rels)', () => {
    // S196 prod case: classifier emitted "ISO 27001 complies_with
    // Cyber Essentials Plus" on item 7e511dbc. Without the source-is-org
    // filter, synonym fallback produced holder='supplier',
    // supplier_name='iso 27001' — nonsense. Tightened rule requires
    // source to match clientOrgLower OR be extracted as organisation.
    const rows: EntityMentionRow[] = [
      row({ canonical_name: 'iso 27001' }),
      row({ canonical_name: 'cyber essentials plus' }),
    ];
    const rels: ExtractedRelationship[] = [
      {
        source: 'ISO 27001',
        relationship: 'complies_with',
        target: 'Cyber Essentials Plus',
      },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(0);
    expect(rows[0].metadata).toBeUndefined();
    expect(rows[1].metadata).toBeUndefined();
  });

  it('does NOT accept `complies_with` for non-certification targets', () => {
    // Only regulation rows in the batch — `complies_with GDPR` should
    // NOT trigger holder derivation because GDPR is not a certification
    // (semantically, complying with a regulation ≠ holding a cert).
    const rows: EntityMentionRow[] = [
      row({ entity_type: 'regulation', canonical_name: 'gdpr' }),
    ];
    const rels: ExtractedRelationship[] = [
      { source: selfOrgName, relationship: 'complies_with', target: 'GDPR' },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(0);
    expect(rows[0].metadata).toBeUndefined();
  });

  it('prefers `holds` over synonyms when both exist for the same cert', () => {
    // Two rels for ISO 27001: a canonical `holds` (self) + a synonym
    // `complies_with` (different source). Holds must win — synonyms are
    // only a fallback when no canonical holds exists.
    const rows: EntityMentionRow[] = [row({ canonical_name: 'iso 27001' })];
    const rels: ExtractedRelationship[] = [
      { source: selfOrgName, relationship: 'holds', target: 'ISO 27001' },
      {
        source: 'Contoso Ltd',
        relationship: 'complies_with',
        target: 'ISO 27001',
      },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(1);
    expect(rows[0].metadata).toEqual({ holder: 'self' });
  });

  it('ignores non-synonym rel_types for cert targets', () => {
    // `delivers_to`, `uses`, `supersedes` etc. must never derive holder
    // metadata regardless of target.
    const rows: EntityMentionRow[] = [row({ canonical_name: 'iso 27001' })];
    const rels: ExtractedRelationship[] = [
      { source: selfOrgName, relationship: 'references', target: 'ISO 27001' },
      { source: selfOrgName, relationship: 'requires', target: 'ISO 27001' },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(0);
    expect(rows[0].metadata).toBeUndefined();
  });

  it('synonym resolves target via canonicalise + resolveAlias', () => {
    const rows: EntityMentionRow[] = [row({ canonical_name: 'iso 27001' })];
    const rels: ExtractedRelationship[] = [
      { source: selfOrgName, relationship: 'evidences', target: 'iso27001' },
    ];

    const count = deriveHolderMetadata(rows, rels);

    expect(count).toBe(1);
    expect(rows[0].metadata).toEqual({ holder: 'self' });
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
