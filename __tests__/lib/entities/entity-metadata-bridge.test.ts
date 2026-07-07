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

  function setupContentItem(temporalRefs: unknown[], regexRefs?: unknown[]) {
    // First call: source_documents query (ID-131 {131.17} G-IMS-DELETE
    // KEEP-list — re-pointed off content_items; `contentItemId` IS the
    // source_documents id directly, no separate source_document_id FK column
    // to resolve; `metadata` -> `extraction_metadata`).
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        extraction_metadata: {
          ai_temporal_references: temporalRefs,
          ...(regexRefs ? { temporal_references: regexRefs } : {}),
        },
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
      data: { extraction_metadata: null },
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
      data: { extraction_metadata: {} },
      error: null,
    });

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
  });

  it('should skip entity_mentions writes when no mentions match the source document id ({131.26} guard, BL-396)', async () => {
    // Analogue of the classify.ts sourceDocumentId guard for this module:
    // `sourceDocumentId` here is now a direct identity assignment off
    // `contentItemId` (ID-131.17 repoint comment above), so there's no
    // standalone `if (!sourceDocumentId)` conditional left to unit test —
    // but the entity_mentions lookup keyed on it
    // (`.eq('source_document_id', sourceDocumentId)`) has its own
    // no-match early-return (skip path) that had no positive coverage.
    setupContentItem([
      {
        date: '2027-03-01',
        context: 'Annual security audit certification renewal',
        context_type: 'expiry',
        related_entity: 'ISO 27001',
      },
    ]);
    setupEntityMentions([]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
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

  // ---------------------------------------------------------------------
  // BL-407: ported from the pre-reorg __tests__/lib/entity-metadata-bridge
  // .test.ts (T1.2-T1.6, T1.9-T1.14) — the tokenMatch-fallback precision,
  // multi-ref/multi-mention, merge-semantics, and duration/ordering
  // scenarios below had no equivalent coverage in this file. T1.1, T1.7 and
  // T1.8 were dropped as exact-duplicate coverage of tests already above.
  // ---------------------------------------------------------------------

  it('should bridge multiple certifications with distinct dates via token matching', async () => {
    setupContentItem([
      {
        date: '2025-06-30',
        context: 'ISO 27001 expiry',
        context_type: 'expiry',
      },
      {
        date: '2025-12-01',
        context: 'Cyber Essentials renewal',
        context_type: 'expiry',
      },
    ]);

    // Two entity_mentions rows means two UPDATE calls — capture each write
    // in order so both persisted rows can be asserted independently.
    const persistedUpdates: Record<string, unknown>[] = [];
    mockSupabase._chain.update.mockImplementation(
      (payload: { metadata?: Record<string, unknown> }) => {
        if (payload && 'metadata' in payload) {
          persistedUpdates.push(payload.metadata ?? {});
        }
        return mockSupabase._chain;
      },
    );

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: {},
      },
      {
        id: 'em-2',
        canonical_name: 'Cyber Essentials',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(persistedUpdates).toContainEqual(
      expect.objectContaining({ expiry_date: '2025-06-30' }),
    );
    expect(persistedUpdates).toContainEqual(
      expect.objectContaining({ expiry_date: '2025-12-01' }),
    );
  });

  it('should bridge an effective date alongside an expiry date for the same entity', async () => {
    setupContentItem([
      {
        date: '2024-01-15',
        context: 'ISO 27001 awarded',
        context_type: 'effective',
      },
      {
        date: '2025-06-30',
        context: 'ISO 27001 expiry',
        context_type: 'expiry',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(readBackMentionMetadata()).toMatchObject({
      date_obtained: '2024-01-15',
      expiry_date: '2025-06-30',
    });
  });

  it('should preserve pre-existing unrelated metadata fields when merging (merge semantics)', async () => {
    setupContentItem([
      {
        date: '2025-06-30',
        context: 'ISO 27001 expiry',
        context_type: 'expiry',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: {
          manual_note: 'Reviewed by compliance team',
          scope: 'UK operations',
        },
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(readBackMentionMetadata()).toMatchObject({
      manual_note: 'Reviewed by compliance team',
      scope: 'UK operations',
      expiry_date: '2025-06-30',
    });
  });

  it('should not bridge a fallback token-matched reference against an unrelated entity', async () => {
    setupContentItem([
      {
        date: '2025-06-30',
        context: 'GDPR compliance review date',
        context_type: 'expiry',
      },
    ]);

    // Entity is ISO 27001 but the temporal reference is about GDPR — no
    // related_entity is set, so this exercises the tokenMatch fallback's
    // negative (no-match) branch, distinct from the related_entity
    // no-match branch covered above.
    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  it('should merge AI and regex temporal reference paths via real reconciliation', async () => {
    setupContentItem(
      [
        {
          date: '2025-06-30',
          context: 'ISO 27001 expiry',
          context_type: 'expiry',
        },
      ],
      [
        {
          date: '2024-01-15',
          type: 'effective',
          confidence: 'high',
          context: 'ISO 27001 awarded',
        },
      ],
    );

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(readBackMentionMetadata()).toMatchObject({
      expiry_date: '2025-06-30',
      date_obtained: '2024-01-15',
    });
  });

  it('should match via token overlap when the entity canonical name is a substring of the context (no related_entity)', async () => {
    setupContentItem([
      {
        date: '2025-06-30',
        context: 'ISO 27001 cert renewal due',
        context_type: 'expiry',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(readBackMentionMetadata()).toMatchObject({
      expiry_date: '2025-06-30',
    });
  });

  it('should match via partial token overlap when the context omits part of the canonical name (no related_entity)', async () => {
    setupContentItem([
      {
        date: '2025-12-01',
        context: '27001 certification expires 2025',
        context_type: 'expiry',
      },
    ]);

    // Context omits the "ISO" prefix — naive substring matching would fail;
    // token-level coverage/confidence scoring still finds the match.
    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(readBackMentionMetadata()).toMatchObject({
      expiry_date: '2025-12-01',
    });
  });

  it('should compute expiry_date from a duration value when date_obtained is available in the same batch', async () => {
    setupContentItem([
      {
        date: '2024-06-15',
        context: 'ISO 27001 awarded',
        context_type: 'effective',
      },
      {
        date: 'P3Y',
        context: 'ISO 27001 certification valid for 3 years',
        context_type: 'expiry',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(readBackMentionMetadata()).toMatchObject({
      date_obtained: '2024-06-15',
      expiry_date: '2027-06-15',
    });
  });

  it('should store renewal_period without computing expiry_date for an explicit-expiry duration with no date_obtained', async () => {
    setupContentItem([
      {
        date: 'P3Y',
        context: 'ISO 27001 certification valid for 3 years',
        context_type: 'expiry',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    // Duration cannot be resolved to a calendar date without date_obtained,
    // but renewal_period is stored as useful lifecycle metadata.
    expect(readBackMentionMetadata()).toMatchObject({ renewal_period: 'P3Y' });
    expect(mockSupabase._chain.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          expiry_date: expect.any(String),
        }),
      }),
    );
  });

  it('should sort effective refs before expiry refs so duration computation sees date_obtained (order-independent input)', async () => {
    // Refs arrive expiry-before-effective — the bridge's own sort must
    // reorder them so date_obtained is available before P3Y is computed
    // (protects sortRefsEffectiveFirst independently of input ordering).
    setupContentItem([
      {
        date: 'P3Y',
        context: 'ISO 27001 valid for 3 years',
        context_type: 'expiry',
      },
      {
        date: '2024-06-15',
        context: 'ISO 27001 granted',
        context_type: 'effective',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: {},
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(readBackMentionMetadata()).toMatchObject({
      date_obtained: '2024-06-15',
      expiry_date: '2027-06-15',
    });
  });

  it('should compute expiry_date from a duration value using a pre-existing date_obtained already on the entity', async () => {
    setupContentItem([
      {
        date: 'P3Y',
        context: 'ISO 27001 valid for 3 years',
        context_type: 'expiry',
      },
    ]);

    // date_obtained already on the mention from a previous bridge run — no
    // 'effective' ref in THIS batch supplies it.
    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: { date_obtained: '2023-01-01' },
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockSupabase as unknown as SupabaseClient<Database>,
      contentItemId,
    );

    expect(readBackMentionMetadata()).toMatchObject({
      date_obtained: '2023-01-01',
      expiry_date: '2026-01-01',
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
