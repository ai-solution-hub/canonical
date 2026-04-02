import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bridgeTemporalReferencesToEntities } from '@/lib/entities/entity-metadata-bridge';
import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

describe('bridgeTemporalReferencesToEntities', () => {
  let mockSupabase: ReturnType<typeof createMockSupabaseClient>;
  const contentItemId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
    vi.clearAllMocks();
  });

  function setupContentItem(temporalRefs: unknown[]) {
    // First call: content_items query
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        metadata: {
          ai_temporal_references: temporalRefs,
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

    // Verify update was called with metadata containing expiry_date
    expect(mockSupabase.from).toHaveBeenCalledWith('entity_mentions');
    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ expiry_date: '2027-03-01' }),
      }),
    );
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

    // Should still match via token matching and call update
    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ expiry_date: '2027-03-01' }),
      }),
    );
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

    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ date_obtained: '2026-06-15' }),
      }),
    );
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
});
