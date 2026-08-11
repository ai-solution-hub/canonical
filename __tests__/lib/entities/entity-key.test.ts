import { describe, expect, it } from 'vitest';

import { entityKey } from '@/lib/entities/entity-key';
import { canonicalise } from '@/lib/entities/entity-dedup';

/**
 * `entityKey` is the TS side of the pipeline's `canonicalise_entity_name`.
 * `get_entity_summary` joins entity_mentions to entity_relationships by raw
 * string equality, so a lookup key that disagrees with the written key finds
 * nothing.
 */
describe('entityKey', () => {
  it('lowercases and trims', () => {
    expect(entityKey('  Acme Corp  ')).toBe('acme corp');
  });

  it('returns empty for an empty name', () => {
    expect(entityKey('')).toBe('');
  });

  it('folds Latin diacritics via NFKD', () => {
    expect(entityKey('Café')).toBe('cafe');
  });

  it('rewrites nothing else — surface variants stay distinct', () => {
    // Collapsing these is resolution's job, not the key's (DR-140).
    expect(entityKey('ISO27001')).toBe('iso27001');
    expect(entityKey('ISO 27001:2022')).toBe('iso 27001:2022');
    expect(entityKey('ISO/IEC 27001')).toBe('iso/iec 27001');
    expect(entityKey('Acme Ltd.')).toBe('acme ltd.');
  });

  it('is idempotent', () => {
    for (const raw of ['ISO27001', '  Café  ', 'Acme Ltd.', 'gdpr']) {
      expect(entityKey(entityKey(raw))).toBe(entityKey(raw));
    }
  });

  it('is not the display formatter', () => {
    // The regression this pins: the MCP entity lookup used `canonicalise`,
    // which title-cases and expands company suffixes for RENDERING. Keys built
    // that way never matched the stored lowercase canonicals.
    expect(canonicalise('acme ltd.')).not.toBe(entityKey('acme ltd.'));
    expect(entityKey('acme ltd.')).toBe('acme ltd.');
  });
});
