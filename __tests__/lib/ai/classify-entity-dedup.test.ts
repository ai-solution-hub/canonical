/**
 * Regression tests for S174 WP3 — dedupe entity_mention rows by
 * (content_item_id, canonical_name, entity_type) before upsert.
 *
 * Background: during S169 evals, a handful of items per 93-item run
 * failed to persist entity mentions with Postgres error 21000
 * ("ON CONFLICT DO UPDATE command cannot affect row a second time").
 * The canonicalise + resolveAlias + toLowerCase chain in Step 15 can
 * collapse two distinct Pass 1 outputs (e.g. "ISO 27001" and
 * "ISO27001", or "DPO" and "Data Protection Officer") onto the same
 * triple. The fix dedupes at the client boundary so the upsert
 * payload is always triple-unique.
 *
 * See `dedupeEntityMentionRows` in `lib/ai/classify.ts` for merge
 * semantics. Tests here are a pure-function regression suite — no
 * live Supabase and no mocks.
 */

import { describe, it, expect } from 'vitest';
import {
  dedupeEntityMentionRows,
  type EntityMentionRow,
} from '@/lib/ai/classify';

const ITEM_A = '11111111-1111-4111-8111-111111111111';
const ITEM_B = '22222222-2222-4222-8222-222222222222';

/** Build an EntityMentionRow with sensible defaults for the fields a test doesn't pin. */
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

describe('dedupeEntityMentionRows', () => {
  it('returns the input unchanged (length + order) when there are no duplicates', () => {
    const input: EntityMentionRow[] = [
      row({ canonical_name: 'iso 27001', entity_type: 'certification' }),
      row({ canonical_name: 'gdpr', entity_type: 'regulation' }),
      row({
        canonical_name: 'acme ltd',
        entity_type: 'organisation',
        entity_name: 'Acme Ltd',
      }),
    ];

    const result = dedupeEntityMentionRows(input);

    expect(result).toHaveLength(input.length);
    expect(result.map((r) => r.canonical_name)).toEqual([
      'iso 27001',
      'gdpr',
      'acme ltd',
    ]);
  });

  it('collapses a two-row duplicate: max confidence, first entity_name, first non-null snippet', () => {
    const input: EntityMentionRow[] = [
      row({
        entity_name: 'ISO 27001',
        canonical_name: 'iso 27001',
        confidence: 0.8,
        context_snippet: 'first snippet',
      }),
      row({
        entity_name: 'ISO27001',
        canonical_name: 'iso 27001',
        confidence: 0.95,
        context_snippet: 'second snippet',
      }),
    ];

    const result = dedupeEntityMentionRows(input);

    expect(result).toHaveLength(1);
    const [merged] = result;
    expect(merged.canonical_name).toBe('iso 27001');
    expect(merged.entity_type).toBe('certification');
    expect(merged.content_item_id).toBe(ITEM_A);
    expect(merged.confidence).toBe(0.95); // max
    expect(merged.entity_name).toBe('ISO 27001'); // first encountered
    expect(merged.context_snippet).toBe('first snippet'); // first non-null
  });

  it('three-row duplicate with null-then-text-then-text snippets → picks the middle row text (first non-null)', () => {
    const input: EntityMentionRow[] = [
      row({
        entity_name: 'DPO',
        canonical_name: 'data protection officer',
        entity_type: 'role',
        confidence: 0.5,
        context_snippet: null,
      }),
      row({
        entity_name: 'Data Protection Officer',
        canonical_name: 'data protection officer',
        entity_type: 'role',
        confidence: 0.9,
        context_snippet: 'middle-row context',
      }),
      row({
        entity_name: 'data protection officer',
        canonical_name: 'data protection officer',
        entity_type: 'role',
        confidence: 0.7,
        context_snippet: 'third-row context',
      }),
    ];

    const result = dedupeEntityMentionRows(input);

    expect(result).toHaveLength(1);
    const [merged] = result;
    expect(merged.entity_name).toBe('DPO'); // first encountered
    expect(merged.confidence).toBe(0.9); // max
    expect(merged.context_snippet).toBe('middle-row context'); // first non-null
  });

  it('mixed input: 5 rows, 2 unique triples (one with 3 duplicates) → 2 output rows, stable order', () => {
    const input: EntityMentionRow[] = [
      // Triple A (3 duplicates, first appears at index 0)
      row({
        canonical_name: 'iso 27001',
        entity_type: 'certification',
        confidence: 0.6,
        entity_name: 'ISO 27001',
        context_snippet: null,
      }),
      // Triple B (2 duplicates, first appears at index 1)
      row({
        canonical_name: 'gdpr',
        entity_type: 'regulation',
        confidence: 0.8,
        entity_name: 'GDPR',
        context_snippet: 'gdpr ctx',
      }),
      // Triple A dup
      row({
        canonical_name: 'iso 27001',
        entity_type: 'certification',
        confidence: 0.99,
        entity_name: 'ISO27001',
        context_snippet: 'iso ctx second',
      }),
      // Triple B dup
      row({
        canonical_name: 'gdpr',
        entity_type: 'regulation',
        confidence: 0.4,
        entity_name: 'gdpr',
        context_snippet: 'gdpr ctx second',
      }),
      // Triple A dup
      row({
        canonical_name: 'iso 27001',
        entity_type: 'certification',
        confidence: 0.7,
        entity_name: 'ISO 27k',
        context_snippet: 'iso ctx third',
      }),
    ];

    const result = dedupeEntityMentionRows(input);

    expect(result).toHaveLength(2);
    // Stable order: triple A first (first appeared at index 0), then triple B.
    expect(result.map((r) => r.canonical_name)).toEqual(['iso 27001', 'gdpr']);

    const tripleA = result[0];
    expect(tripleA.confidence).toBe(0.99); // max across 0.6, 0.99, 0.7
    expect(tripleA.entity_name).toBe('ISO 27001'); // first encountered
    expect(tripleA.context_snippet).toBe('iso ctx second'); // first non-null

    const tripleB = result[1];
    expect(tripleB.confidence).toBe(0.8); // max across 0.8, 0.4
    expect(tripleB.entity_name).toBe('GDPR'); // first encountered
    expect(tripleB.context_snippet).toBe('gdpr ctx'); // first non-null
  });

  it('rows with different entity_type but same canonical_name + content_item_id are NOT collapsed', () => {
    const input: EntityMentionRow[] = [
      row({
        canonical_name: 'acme',
        entity_type: 'organisation',
        entity_name: 'Acme',
      }),
      row({
        canonical_name: 'acme',
        entity_type: 'project',
        entity_name: 'Acme',
      }),
    ];

    const result = dedupeEntityMentionRows(input);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.entity_type)).toEqual([
      'organisation',
      'project',
    ]);
  });

  it('rows with same canonical_name + type but different content_item_id are NOT collapsed', () => {
    const input: EntityMentionRow[] = [
      row({
        content_item_id: ITEM_A,
        canonical_name: 'gdpr',
        entity_type: 'regulation',
      }),
      row({
        content_item_id: ITEM_B,
        canonical_name: 'gdpr',
        entity_type: 'regulation',
      }),
    ];

    const result = dedupeEntityMentionRows(input);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.content_item_id)).toEqual([ITEM_A, ITEM_B]);
  });

  it('does not mutate the input array or its row objects', () => {
    const original: EntityMentionRow = {
      content_item_id: ITEM_A,
      entity_type: 'certification',
      entity_name: 'ISO 27001',
      canonical_name: 'iso 27001',
      confidence: 0.5,
      context_snippet: null,
    };
    const duplicate: EntityMentionRow = {
      content_item_id: ITEM_A,
      entity_type: 'certification',
      entity_name: 'ISO27001',
      canonical_name: 'iso 27001',
      confidence: 0.99,
      context_snippet: 'second',
    };
    const input: EntityMentionRow[] = [original, duplicate];
    const snapshotOriginal = { ...original };
    const snapshotDuplicate = { ...duplicate };

    const result = dedupeEntityMentionRows(input);

    expect(input).toHaveLength(2); // input array unchanged
    expect(original).toEqual(snapshotOriginal); // row objects unchanged
    expect(duplicate).toEqual(snapshotDuplicate);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toBe(original); // result rows are fresh objects
  });

  it('returns an empty array when given an empty array', () => {
    expect(dedupeEntityMentionRows([])).toEqual([]);
  });
});
