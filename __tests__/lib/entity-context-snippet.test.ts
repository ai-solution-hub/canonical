/**
 * Tests for entity context snippet extraction.
 * Suite 4 of the data flow integration test Phase 2.
 */

import { describe, it, expect } from 'vitest';
import { extractEntityContext } from '@/lib/entities/entity-context';

describe('extractEntityContext', () => {
  const longText =
    'The organisation holds ISO 27001 certification which was awarded in 2023. ' +
    'This demonstrates our commitment to information security management and ensures ' +
    'that all data handling processes meet international standards for security.';

  it('T4.1: extracts snippet when entity name is found', () => {
    const snippet = extractEntityContext(longText, 'ISO 27001');

    expect(snippet).not.toBeNull();
    expect(snippet).toContain('ISO 27001');
    // Should have surrounding context
    expect(snippet!.length).toBeGreaterThan('ISO 27001'.length);
  });

  it('T4.2: uses first occurrence when entity appears multiple times', () => {
    const text =
      'We achieved ISO 27001 in 2020. Later, ISO 27001 was renewed in 2023.';
    const snippet = extractEntityContext(text, 'ISO 27001');

    expect(snippet).not.toBeNull();
    expect(snippet).toContain('ISO 27001');
    // Should contain context from the first occurrence
    expect(snippet).toContain('achieved');
  });

  it('T4.3: returns null when entity name is not found', () => {
    const snippet = extractEntityContext(longText, 'Cyber Essentials Plus');
    expect(snippet).toBeNull();
  });

  it('T4.4: no leading ellipsis when entity is at start of text', () => {
    const text =
      'ISO 27001 is an international standard for information security.';
    const snippet = extractEntityContext(text, 'ISO 27001');

    expect(snippet).not.toBeNull();
    expect(snippet).not.toMatch(/^\.\.\./);
    expect(snippet).toContain('ISO 27001');
  });

  it('T4.5: no trailing ellipsis when entity is at end of text', () => {
    const text = 'We comply with ISO 27001';
    const snippet = extractEntityContext(text, 'ISO 27001');

    expect(snippet).not.toBeNull();
    expect(snippet).not.toMatch(/\.\.\.$/);
    expect(snippet).toContain('ISO 27001');
  });

  it('returns null for empty text', () => {
    expect(extractEntityContext('', 'ISO 27001')).toBeNull();
  });

  it('returns null for empty entity name', () => {
    expect(extractEntityContext(longText, '')).toBeNull();
  });

  it('performs case-insensitive matching', () => {
    const text = 'We hold iso 27001 certification.';
    const snippet = extractEntityContext(text, 'ISO 27001');

    expect(snippet).not.toBeNull();
    expect(snippet).toContain('iso 27001');
  });

  it('adds leading ellipsis when entity is deep in text', () => {
    // Create text where entity is far from the start (>80 chars in)
    const prefix = 'A'.repeat(100);
    const text = `${prefix} ISO 27001 is important.`;
    const snippet = extractEntityContext(text, 'ISO 27001');

    expect(snippet).not.toBeNull();
    expect(snippet).toMatch(/^\.\.\./);
  });

  it('adds trailing ellipsis when entity is far from end', () => {
    const suffix = 'B'.repeat(100);
    const text = `ISO 27001 is important. ${suffix}`;
    const snippet = extractEntityContext(text, 'ISO 27001');

    expect(snippet).not.toBeNull();
    expect(snippet).toMatch(/\.\.\.$/);
  });
});
