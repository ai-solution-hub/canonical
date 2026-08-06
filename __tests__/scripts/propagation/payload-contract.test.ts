import { describe, it, expect } from 'vitest';
import { PAYLOAD_CONTRACT } from '@/scripts/propagation/payload-contract';

/**
 * ID-95 {95.11} PI-18 payload-contract invariants. These assert the written
 * contract the {95.13} fan-out worker implements against: the v1 payload set, its
 * FK-dependency ordering, and that every entry carries a usable stable key.
 */
describe('PAYLOAD_CONTRACT (PI-18 canonical-content propagation)', () => {
  it('describes exactly the five canonical payload tables (id-417 / DR-130: the taxonomy pair retired)', () => {
    expect(PAYLOAD_CONTRACT).toHaveLength(5);

    expect(PAYLOAD_CONTRACT.map((e) => e.table)).toEqual([
      'layer_vocabulary',
      'application_types',
      'form_types',
      'form_requirement_templates',
      'reference_items',
    ]);
  });

  it('orders every fkRemap target before the table that references it', () => {
    const order = PAYLOAD_CONTRACT.map((e) => e.table);
    for (const [index, entry] of PAYLOAD_CONTRACT.entries()) {
      if (entry.fkRemap) {
        const refIndex = order.indexOf(entry.fkRemap.referencesTable);
        expect(
          refIndex,
          `${entry.table}.fkRemap target must precede it`,
        ).toBeGreaterThanOrEqual(0);
        expect(refIndex).toBeLessThan(index);
      }
    }
  });

  it('gives every entry a non-empty stableKey of non-empty column names', () => {
    for (const entry of PAYLOAD_CONTRACT) {
      expect(
        entry.stableKey.length,
        `${entry.table} needs a stableKey`,
      ).toBeGreaterThan(0);
      for (const col of entry.stableKey) {
        expect(typeof col).toBe('string');
        expect(col.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('sets the v1 tombstone policy to delete-absent on every entry', () => {
    for (const entry of PAYLOAD_CONTRACT) {
      expect(entry.tombstone).toBe('delete-absent');
    }
  });

  it('carries no fkRemap entries after the taxonomy pair retired (id-417 / DR-130)', () => {
    for (const entry of PAYLOAD_CONTRACT) {
      expect(entry.fkRemap).toBeNull();
    }
  });

  it('excludes client-provenance tables from the payload set', () => {
    const tables = new Set(PAYLOAD_CONTRACT.map((e) => e.table));
    for (const excluded of [
      'guides',
      'entity_mentions',
      'q_a_pairs',
      'form_responses',
      'source_documents',
    ]) {
      expect(tables.has(excluded), `${excluded} must not be propagated`).toBe(
        false,
      );
    }
  });
});
