import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  bridgeTemporalReferencesToEntities,
  inferContextType,
} from '@/lib/entities/entity-metadata-bridge';
import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

describe('bridgeTemporalReferencesToEntities', () => {
  let mockSupabase: ReturnType<typeof createMockSupabaseClient>;
  const contentItemId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  /** Captures the metadata persisted to entity_mentions by the last UPDATE. */
  let persistedMetadata: Record<string, unknown> | null;

  /**
   * The entity_mentions row state a follow-up read would observe after the
   * bridge has run — i.e. the persisted metadata. Null when no UPDATE fired.
   */
  function readBackMentionMetadata(): Record<string, unknown> | null {
    return persistedMetadata;
  }

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
    vi.clearAllMocks();
    persistedMetadata = null;
    // Record what the bridge persists so tests can read the row back rather
    // than only asserting that the update mock was invoked.
    mockSupabase._chain.update.mockImplementation(
      (payload: { metadata?: Record<string, unknown> }) => {
        if (payload && 'metadata' in payload) {
          persistedMetadata = payload.metadata ?? null;
        }
        return mockSupabase._chain;
      },
    );
  });

  function setupContentItem(temporalRefs: unknown[]) {
    // First call: content_items query. Includes a linked source_document_id
    // (ID-131.26) — the bridge resolves entity_mentions off this field, not
    // contentItemId directly.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        metadata: {
          ai_temporal_references: temporalRefs,
        },
        source_document_id: contentItemId,
      },
      error: null,
    });
  }

  function setupEntityMentions(mentions: unknown[]) {
    // Second call: entity_mentions query (resolves via then)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (value: unknown) => void) =>
        resolve({ data: mentions, error: null }),
    );
  }

  it('should bridge using related_entity when present (direct match)', async () => {
    setupContentItem([
      {
        date: '2027-03-01',
        context: 'Annual security audit certification renewal',
        context_type: 'expiry',
        related_entity: 'ISO 27001',
      },
    ]);

    setupEntityMentions([
      {
        id: 'mention-1',
        canonical_name: 'iso 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    // Verify the persisted entity_mentions row carries expiry_date
    expect(mockSupabase.from).toHaveBeenCalledWith('entity_mentions');
    expect(readBackMentionMetadata()).toMatchObject({
      expiry_date: '2027-03-01',
    });
  });

  it('should fall back to token matching when related_entity is absent', async () => {
    setupContentItem([
      {
        date: '2027-03-01',
        context: 'ISO 27001 certification expires March 2027',
        context_type: 'expiry',
        // No related_entity
      },
    ]);

    setupEntityMentions([
      {
        id: 'mention-1',
        canonical_name: 'iso 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    // Should still match via token matching and persist expiry_date
    expect(readBackMentionMetadata()).toMatchObject({
      expiry_date: '2027-03-01',
    });
  });

  it('should handle case-insensitive related_entity matching', async () => {
    setupContentItem([
      {
        date: '2026-06-15',
        context: 'Certification obtained',
        context_type: 'effective',
        related_entity: 'ISO 27001',
      },
    ]);

    setupEntityMentions([
      {
        id: 'mention-1',
        canonical_name: 'iso 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(readBackMentionMetadata()).toMatchObject({
      date_obtained: '2026-06-15',
    });
  });

  it('should not bridge when related_entity does not match any entity', async () => {
    setupContentItem([
      {
        date: '2027-03-01',
        context: 'PCI DSS certification expires',
        context_type: 'expiry',
        related_entity: 'PCI DSS',
      },
    ]);

    setupEntityMentions([
      {
        id: 'mention-1',
        canonical_name: 'iso 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    // Update should NOT have been called — related_entity doesn't match,
    // and token matching won't find 'iso 27001' in 'PCI DSS certification expires'
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  it('should return early when content item has no metadata', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { metadata: null },
      error: null,
    });

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    // Should not attempt entity_mentions query
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
  });

  it('should return early when content item has no temporal references', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { metadata: {} },
      error: null,
    });

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
  });

  it('should store renewal_period for matched ref with unknown context_type and duration date', async () => {
    setupContentItem([
      {
        date: 'P1Y',
        context: 'Annual renewal cycle',
        context_type: 'unknown',
        related_entity: 'Cyber Essentials Plus',
      },
    ]);

    setupEntityMentions([
      {
        id: 'mention-1',
        canonical_name: 'Cyber Essentials Plus',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    // "Annual renewal cycle" contains "renewal" keyword so inferred as expiry,
    // but since there is no date_obtained, it stores as renewal_period
    expect(readBackMentionMetadata()).toMatchObject({ renewal_period: 'P1Y' });
  });

  it('should infer expiry from context keywords when context_type is unknown', async () => {
    setupContentItem([
      {
        date: '2027-06-15',
        context: 'ISO 27001 certification expires June 2027',
        context_type: 'unknown',
        related_entity: 'ISO 27001',
      },
    ]);

    setupEntityMentions([
      {
        id: 'mention-1',
        canonical_name: 'iso 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(readBackMentionMetadata()).toMatchObject({
      expiry_date: '2027-06-15',
    });
  });

  it('should infer effective from context keywords when context_type is unknown', async () => {
    setupContentItem([
      {
        date: '2024-03-15',
        context: 'ISO 27001 certification achieved March 2024',
        context_type: 'unknown',
        related_entity: 'ISO 27001',
      },
    ]);

    setupEntityMentions([
      {
        id: 'mention-1',
        canonical_name: 'iso 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(readBackMentionMetadata()).toMatchObject({
      date_obtained: '2024-03-15',
    });
  });

  it('should handle historical context_type with keyword inference', async () => {
    setupContentItem([
      {
        date: '2023-01-10',
        context: 'GDPR came into force across the EU',
        context_type: 'historical',
        related_entity: 'GDPR',
      },
    ]);

    setupEntityMentions([
      {
        id: 'mention-1',
        canonical_name: 'GDPR',
        entity_type: 'regulation',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(readBackMentionMetadata()).toMatchObject({
      date_obtained: '2023-01-10',
    });
  });

  it('should store renewal_period for duration with ambiguous unknown context', async () => {
    setupContentItem([
      {
        date: 'PT72H',
        context: '72-hour breach reporting window',
        context_type: 'unknown',
        related_entity: 'GDPR',
      },
    ]);

    setupEntityMentions([
      {
        id: 'mention-1',
        canonical_name: 'GDPR',
        entity_type: 'regulation',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    // No expiry or effective keywords, so falls through to duration storage
    expect(readBackMentionMetadata()).toMatchObject({
      renewal_period: 'PT72H',
    });
  });
});

describe('inferContextType', () => {
  it('should return "expiry" for context with expiry keywords', () => {
    expect(inferContextType('Certification expires March 2027')).toBe('expiry');
    expect(inferContextType('Annual renewal cycle for ISO 27001')).toBe(
      'expiry',
    );
    expect(inferContextType('Valid until December 2026')).toBe('expiry');
    expect(inferContextType('Certification due for renewal')).toBe('expiry');
  });

  it('should return "effective" for context with effective keywords', () => {
    expect(inferContextType('Certification achieved in 2024')).toBe(
      'effective',
    );
    expect(inferContextType('GDPR came into force in 2018')).toBe('effective');
    expect(inferContextType('ISO 27001 certified since 2023')).toBe(
      'effective',
    );
    expect(inferContextType('Regulation introduced in January')).toBe(
      'effective',
    );
  });

  it('should return null when both expiry and effective keywords present', () => {
    expect(
      inferContextType('Certification achieved, renewal due next year'),
    ).toBeNull();
  });

  it('should return null when no keywords match', () => {
    expect(inferContextType('72-hour breach reporting window')).toBeNull();
    expect(inferContextType('Annual security audits required')).toBeNull();
  });

  it('should return null for empty context', () => {
    expect(inferContextType('')).toBeNull();
  });

  it('should be case-insensitive', () => {
    expect(inferContextType('CERTIFICATION EXPIRES SOON')).toBe('expiry');
    expect(inferContextType('CERTIFIED IN 2023')).toBe('effective');
  });
});
