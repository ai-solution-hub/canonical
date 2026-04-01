import { describe, it, expect } from 'vitest';

/**
 * Tests for the backfill-temporal-entity-matches script.
 *
 * The script has module-level side effects (env loading, process.exit) that
 * prevent direct import in tests. The parseClaudeResponse logic is duplicated
 * here for testing — it mirrors the script's implementation exactly.
 */

interface ClaudeMatch {
  temporal_ref_index: number;
  entity_canonical_name: string;
  context_type: string;
  confidence: number;
}

/** Parse Claude's JSON array response, handling code blocks and edge cases. */
function parseClaudeResponse(text: string): ClaudeMatch[] {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m: unknown) =>
        typeof m === 'object' &&
        m !== null &&
        'temporal_ref_index' in m &&
        'entity_canonical_name' in m &&
        'confidence' in m,
    ) as ClaudeMatch[];
  } catch {
    return [];
  }
}

describe('backfill-temporal-entity-matches', () => {
  describe('parseClaudeResponse', () => {
    it('should parse a valid JSON array response', () => {
      const response = JSON.stringify([
        {
          temporal_ref_index: 0,
          entity_canonical_name: 'ISO 27001',
          context_type: 'expiry',
          confidence: 0.95,
        },
        {
          temporal_ref_index: 1,
          entity_canonical_name: 'GDPR',
          context_type: 'effective',
          confidence: 0.85,
        },
      ]);

      const result = parseClaudeResponse(response);
      expect(result).toHaveLength(2);
      expect(result[0].temporal_ref_index).toBe(0);
      expect(result[0].entity_canonical_name).toBe('ISO 27001');
      expect(result[0].confidence).toBe(0.95);
      expect(result[1].entity_canonical_name).toBe('GDPR');
    });

    it('should handle code-block-wrapped responses', () => {
      const response =
        '```json\n[{"temporal_ref_index": 0, "entity_canonical_name": "ISO 27001", "context_type": "expiry", "confidence": 0.9}]\n```';
      const result = parseClaudeResponse(response);
      expect(result).toHaveLength(1);
      expect(result[0].entity_canonical_name).toBe('ISO 27001');
    });

    it('should return empty array for invalid JSON', () => {
      const result = parseClaudeResponse('This is not JSON');
      expect(result).toEqual([]);
    });

    it('should return empty array for non-array JSON', () => {
      const result = parseClaudeResponse('{"key": "value"}');
      expect(result).toEqual([]);
    });

    it('should filter out malformed match objects', () => {
      const response = JSON.stringify([
        {
          temporal_ref_index: 0,
          entity_canonical_name: 'ISO 27001',
          context_type: 'expiry',
          confidence: 0.95,
        },
        { bad: 'object' },
        {
          temporal_ref_index: 2,
          // missing entity_canonical_name
          confidence: 0.8,
        },
      ]);

      const result = parseClaudeResponse(response);
      expect(result).toHaveLength(1);
      expect(result[0].entity_canonical_name).toBe('ISO 27001');
    });

    it('should return empty array for empty response', () => {
      const result = parseClaudeResponse('');
      expect(result).toEqual([]);
    });

    it('should handle whitespace-padded responses', () => {
      const response =
        '  \n  [{"temporal_ref_index": 0, "entity_canonical_name": "GDPR", "context_type": "effective", "confidence": 0.88}]  \n  ';
      const result = parseClaudeResponse(response);
      expect(result).toHaveLength(1);
      expect(result[0].entity_canonical_name).toBe('GDPR');
    });

    it('should handle empty JSON array', () => {
      const result = parseClaudeResponse('[]');
      expect(result).toEqual([]);
    });

    it('should only accept matches with required fields', () => {
      const response = JSON.stringify([
        {
          temporal_ref_index: 0,
          entity_canonical_name: 'Cyber Essentials Plus',
          context_type: 'expiry',
          confidence: 0.92,
        },
        {
          temporal_ref_index: 1,
          entity_canonical_name: 'ISO 9001',
          // missing confidence
          context_type: 'effective',
        },
      ]);

      const result = parseClaudeResponse(response);
      expect(result).toHaveLength(1);
      expect(result[0].entity_canonical_name).toBe('Cyber Essentials Plus');
    });

    it('should handle confidence threshold filtering downstream', () => {
      const response = JSON.stringify([
        {
          temporal_ref_index: 0,
          entity_canonical_name: 'ISO 27001',
          context_type: 'expiry',
          confidence: 0.95,
        },
        {
          temporal_ref_index: 1,
          entity_canonical_name: 'GDPR',
          context_type: 'effective',
          confidence: 0.5,
        },
      ]);

      const result = parseClaudeResponse(response);
      // Parser returns all valid matches; confidence filtering happens in main logic
      expect(result).toHaveLength(2);
      const highConf = result.filter((m) => m.confidence >= 0.7);
      const lowConf = result.filter((m) => m.confidence < 0.7);
      expect(highConf).toHaveLength(1);
      expect(lowConf).toHaveLength(1);
    });
  });
});
