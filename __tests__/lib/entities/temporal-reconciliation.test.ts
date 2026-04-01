import { describe, it, expect } from 'vitest';
import { reconcileTemporalReferences } from '@/lib/entities/temporal-reconciliation';
import type { ClassificationTemporalReference } from '@/lib/ai/classify';

describe('reconcileTemporalReferences', () => {
  it('should carry related_entity from AI refs through reconciliation', () => {
    const aiRefs: ClassificationTemporalReference[] = [
      {
        date: '2027-03-01',
        context: 'ISO 27001 certification expires',
        context_type: 'expiry',
        related_entity: 'ISO 27001',
      },
    ];
    const result = reconcileTemporalReferences(aiRefs, undefined);
    expect(result).toHaveLength(1);
    expect(result[0].related_entity).toBe('ISO 27001');
    expect(result[0].source).toBe('ai');
  });

  it('should default related_entity to undefined for regex refs', () => {
    const regexRefs = [
      {
        date: '2027-03-01',
        type: 'expiry' as const,
        confidence: 'high' as const,
        context: 'expires March 2027',
      },
    ];
    const result = reconcileTemporalReferences(undefined, regexRefs);
    expect(result).toHaveLength(1);
    expect(result[0].related_entity).toBeUndefined();
    expect(result[0].source).toBe('regex');
  });

  it('should preserve related_entity when merging AI and regex refs (source = both)', () => {
    const aiRefs: ClassificationTemporalReference[] = [
      {
        date: '2027-03-01',
        context: 'GDPR effective date',
        context_type: 'effective',
        related_entity: 'GDPR',
      },
    ];
    const regexRefs = [
      {
        date: '2027-03-01',
        type: 'effective' as const,
        confidence: 'high' as const,
        context: 'effective March 2027',
      },
    ];
    const result = reconcileTemporalReferences(aiRefs, regexRefs);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('both');
    expect(result[0].related_entity).toBe('GDPR');
  });

  it('should handle AI ref without related_entity gracefully', () => {
    const aiRefs: ClassificationTemporalReference[] = [
      {
        date: '2025-01-01',
        context: 'Company founded in 2025',
        context_type: 'historical',
      },
    ];
    const result = reconcileTemporalReferences(aiRefs, undefined);
    expect(result).toHaveLength(1);
    expect(result[0].related_entity).toBeUndefined();
  });

  it('should carry multiple related_entity values for different refs', () => {
    const aiRefs: ClassificationTemporalReference[] = [
      {
        date: '2027-03-01',
        context: 'ISO 27001 certification expires',
        context_type: 'expiry',
        related_entity: 'ISO 27001',
      },
      {
        date: '2026-06-15',
        context: 'Cyber Essentials Plus renewed',
        context_type: 'effective',
        related_entity: 'Cyber Essentials Plus',
      },
    ];
    const result = reconcileTemporalReferences(aiRefs, undefined);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.related_entity === 'ISO 27001')).toBeDefined();
    expect(result.find((r) => r.related_entity === 'Cyber Essentials Plus')).toBeDefined();
  });
});
