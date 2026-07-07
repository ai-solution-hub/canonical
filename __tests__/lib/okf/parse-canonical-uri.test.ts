import { describe, it, expect } from 'vitest';
import { parseCanonicalResourceUri } from '@/lib/okf/parse-canonical-uri';

const UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('parseCanonicalResourceUri', () => {
  it('parses a source_documents per-row pointer', () => {
    expect(
      parseCanonicalResourceUri(`canonical://source_documents/${UUID}`),
    ).toEqual({ table: 'source_documents', id: UUID });
  });

  it('parses a reference_items per-row pointer', () => {
    expect(
      parseCanonicalResourceUri(`canonical://reference_items/${UUID}`),
    ).toEqual({ table: 'reference_items', id: UUID });
  });

  it('parses a q_a_pairs scope_tag query pointer (BI-8 — never a row uuid)', () => {
    expect(
      parseCanonicalResourceUri('canonical://q_a_pairs?scope_tag=pricing'),
    ).toEqual({ table: 'q_a_pairs', scopeTag: 'pricing' });
  });

  it('parses a q_a_pairs domain+subtopic query pointer', () => {
    expect(
      parseCanonicalResourceUri(
        'canonical://q_a_pairs?domain=security&subtopic=compliance',
      ),
    ).toEqual({
      table: 'q_a_pairs',
      domain: 'security',
      subtopic: 'compliance',
    });
  });

  it('returns null for a non-canonical:// uri (an external resource link)', () => {
    expect(parseCanonicalResourceUri('https://example.com/orders')).toBeNull();
  });

  it('returns null for an unrecognised table', () => {
    expect(
      parseCanonicalResourceUri(`canonical://some_other_table/${UUID}`),
    ).toBeNull();
  });

  it('returns null for a q_a_pairs uri missing both scope_tag and domain/subtopic', () => {
    expect(parseCanonicalResourceUri('canonical://q_a_pairs')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseCanonicalResourceUri('')).toBeNull();
  });
});
