import { describe, it, expect } from 'vitest';
import { PAYLOAD_CONTRACT } from '@/scripts/propagation/payload-contract';

/**
 * ID-95 {95.11} PI-18 payload-contract invariants. These assert the written
 * contract the {95.13} fan-out worker implements against: the v1 payload set, its
 * FK-dependency ordering, and that every entry carries a usable stable key.
 */
describe('PAYLOAD_CONTRACT (PI-18 canonical-content propagation)', () => {
  it('describes exactly the seven v1 canonical payload tables', () => {
    expect(PAYLOAD_CONTRACT).toHaveLength(7);

    expect(PAYLOAD_CONTRACT.map((e) => e.table)).toEqual([
      'taxonomy_domains',
      'taxonomy_subtopics',
      'layer_vocabulary',
      'application_types',
      'form_types',
      'form_template_requirements',
      'reference_items',
    ]);
  });

  it('lists tables in FK-dependency order (taxonomy_domains before taxonomy_subtopics)', () => {
    const order = PAYLOAD_CONTRACT.map((e) => e.table);
    expect(order.indexOf('taxonomy_domains')).toBeLessThan(
      order.indexOf('taxonomy_subtopics'),
    );
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

  it('models the per-DB uuid FK on taxonomy_subtopics as a domain-name remap', () => {
    const subtopics = PAYLOAD_CONTRACT.find(
      (e) => e.table === 'taxonomy_subtopics',
    );
    expect(subtopics?.fkRemap).toEqual({
      column: 'domain_id',
      referencesTable: 'taxonomy_domains',
      referencesStableKey: ['name'],
    });
    expect(subtopics?.stableKey).toContain('domain_name');
  });

  it('excludes client-provenance tables from the payload set', () => {
    const tables = new Set(PAYLOAD_CONTRACT.map((e) => e.table));
    for (const excluded of [
      'content_items',
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
