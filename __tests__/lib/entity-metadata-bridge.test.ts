/**
 * Tests for entity metadata bridge — connects temporal references to entity mentions.
 * Suite 1 of the data flow integration test Phase 2.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../helpers/mock-supabase';

// Mock the temporal reconciliation module
vi.mock('@/lib/entities/temporal-reconciliation', () => ({
  reconcileTemporalReferences: vi.fn(),
}));

import { bridgeTemporalReferencesToEntities } from '@/lib/entities/entity-metadata-bridge';
import { reconcileTemporalReferences } from '@/lib/entities/temporal-reconciliation';

const mockReconcile = vi.mocked(reconcileTemporalReferences);

describe('bridgeTemporalReferencesToEntities', () => {
  let mockClient: MockSupabaseClient;
  const contentItemId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

  // Track calls per table
  let fromCalls: Map<string, number>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockSupabaseClient();
    fromCalls = new Map();

    // We need to differentiate responses per table.
    // Override .from() to track which table is being queried.
    mockClient.from.mockImplementation((table: string) => {
      const callIndex = fromCalls.get(table) ?? 0;
      fromCalls.set(table, callIndex + 1);

      // Return a fresh chain-like object for each table call
      const chain = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        then: vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
        ),
      };

      // Store the chain so tests can configure per-table responses
      (mockClient as unknown as Record<string, unknown>)[
        `_${table}_chain_${callIndex}`
      ] = chain;
      return chain;
    });
  });

  function setupContentItem(metadata: Record<string, unknown>) {
    // First .from('content_items') call returns item metadata
    mockClient.from.mockImplementationOnce(() => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { metadata },
          error: null,
        }),
      };
      return chain;
    });
  }

  function setupEntityMentions(
    mentions: Array<{
      id: string;
      canonical_name: string;
      entity_type: string;
      metadata: Record<string, unknown> | null;
    }>,
  ) {
    // Second .from('entity_mentions') call returns mentions
    mockClient.from.mockImplementationOnce(() => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: mentions, error: null }),
        ),
      };
      return chain;
    });
  }

  /**
   * Models an `entity_mentions` UPDATE that persists the row, then lets the
   * test read the persisted metadata back. `update(payload)` records the
   * written `metadata` into `persisted`; `readBack()` returns the row state
   * the next reader would observe — so assertions check the persisted-then-
   * read-back state, not merely that the mock was invoked.
   */
  function setupUpdateCall() {
    let persisted: Record<string, unknown> | null = null;
    const updateChain = {
      update: vi.fn((payload: { metadata: Record<string, unknown> }) => {
        persisted = payload.metadata;
        return updateChain;
      }),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null }),
      ),
      /** The metadata persisted to the row, as a follow-up read would see it. */
      readBack: () => persisted,
    };
    mockClient.from.mockImplementationOnce(() => updateChain);
    return updateChain;
  }

  it('T1.1: bridges single certification with expiry date', async () => {
    const aiRefs = [
      {
        date: '2025-06-30',
        context: 'ISO 27001 certification expiry',
        context_type: 'expiry' as const,
      },
    ];

    setupContentItem({ ai_temporal_references: aiRefs });
    mockReconcile.mockReturnValue([
      {
        date: '2025-06-30',
        context: 'ISO 27001 certification expiry',
        context_type: 'expiry',
        source: 'ai',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: null,
      },
    ]);

    const updateChain = setupUpdateCall();

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    expect(updateChain.readBack()).toMatchObject({ expiry_date: '2025-06-30' });
  });

  it('T1.2: bridges multiple certifications with distinct dates', async () => {
    const aiRefs = [
      {
        date: '2025-06-30',
        context: 'ISO 27001 expiry',
        context_type: 'expiry' as const,
      },
      {
        date: '2025-12-01',
        context: 'Cyber Essentials renewal',
        context_type: 'expiry' as const,
      },
    ];

    setupContentItem({ ai_temporal_references: aiRefs });
    mockReconcile.mockReturnValue([
      {
        date: '2025-06-30',
        context: 'ISO 27001 expiry',
        context_type: 'expiry',
        source: 'ai',
      },
      {
        date: '2025-12-01',
        context: 'Cyber Essentials renewal',
        context_type: 'expiry',
        source: 'ai',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: null,
      },
      {
        id: 'em-2',
        canonical_name: 'Cyber Essentials',
        entity_type: 'certification',
        metadata: null,
      },
    ]);

    // Two update calls expected
    const update1 = setupUpdateCall();
    const update2 = setupUpdateCall();

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    expect(update1.readBack()).toMatchObject({ expiry_date: '2025-06-30' });
    expect(update2.readBack()).toMatchObject({ expiry_date: '2025-12-01' });
  });

  it('T1.3: bridges effective date alongside expiry date', async () => {
    const aiRefs = [
      {
        date: '2024-01-15',
        context: 'ISO 27001 awarded',
        context_type: 'effective' as const,
      },
      {
        date: '2025-06-30',
        context: 'ISO 27001 expiry',
        context_type: 'expiry' as const,
      },
    ];

    setupContentItem({ ai_temporal_references: aiRefs });
    mockReconcile.mockReturnValue([
      {
        date: '2024-01-15',
        context: 'ISO 27001 awarded',
        context_type: 'effective',
        source: 'ai',
      },
      {
        date: '2025-06-30',
        context: 'ISO 27001 expiry',
        context_type: 'expiry',
        source: 'ai',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: null,
      },
    ]);

    const updateChain = setupUpdateCall();

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    expect(updateChain.readBack()).toMatchObject({
      date_obtained: '2024-01-15',
      expiry_date: '2025-06-30',
    });
  });

  it('T1.4: preserves existing manual metadata (merge semantics)', async () => {
    setupContentItem({
      ai_temporal_references: [
        {
          date: '2025-06-30',
          context: 'ISO 27001 expiry',
          context_type: 'expiry',
        },
      ],
    });
    mockReconcile.mockReturnValue([
      {
        date: '2025-06-30',
        context: 'ISO 27001 expiry',
        context_type: 'expiry',
        source: 'ai',
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

    const updateChain = setupUpdateCall();

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    expect(updateChain.readBack()).toMatchObject({
      manual_note: 'Reviewed by compliance team',
      scope: 'UK operations',
      expiry_date: '2025-06-30',
    });
  });

  it('T1.5: no matching temporal reference — metadata unchanged', async () => {
    setupContentItem({
      ai_temporal_references: [
        {
          date: '2025-06-30',
          context: 'GDPR compliance review date',
          context_type: 'expiry',
        },
      ],
    });
    mockReconcile.mockReturnValue([
      {
        date: '2025-06-30',
        context: 'GDPR compliance review date',
        context_type: 'expiry',
        source: 'ai',
      },
    ]);

    // Entity is ISO 27001 but temporal reference mentions GDPR — no match
    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: null,
      },
    ]);

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    // No update call should have been made (no further from() calls)
    // The from() mock should only have been called twice (content_items + entity_mentions)
    expect(mockClient.from).toHaveBeenCalledTimes(2);
  });

  it('T1.6: both AI and regex temporal references are merged', async () => {
    setupContentItem({
      ai_temporal_references: [
        {
          date: '2025-06-30',
          context: 'ISO 27001 expiry',
          context_type: 'expiry',
        },
      ],
      temporal_references: [
        {
          date: '2024-01-15',
          type: 'effective',
          confidence: 'high',
          context: 'ISO 27001 awarded',
        },
      ],
    });

    mockReconcile.mockReturnValue([
      {
        date: '2025-06-30',
        context: 'ISO 27001 expiry',
        context_type: 'expiry',
        source: 'ai',
      },
      {
        date: '2024-01-15',
        context: 'ISO 27001 awarded',
        context_type: 'effective',
        source: 'regex',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: null,
      },
    ]);

    const updateChain = setupUpdateCall();

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    // Both reconcile inputs should have been passed
    expect(mockReconcile).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ date: '2025-06-30' })]),
      expect.arrayContaining([expect.objectContaining({ date: '2024-01-15' })]),
    );

    expect(updateChain.readBack()).toMatchObject({
      expiry_date: '2025-06-30',
      date_obtained: '2024-01-15',
    });
  });

  it('T1.7: non-certification entities are skipped', async () => {
    setupContentItem({
      ai_temporal_references: [
        {
          date: '2025-06-30',
          context: 'Acme Corp founded',
          context_type: 'historical',
        },
      ],
    });
    mockReconcile.mockReturnValue([
      {
        date: '2025-06-30',
        context: 'Acme Corp founded',
        context_type: 'historical',
        source: 'ai',
      },
    ]);

    // Entity mentions query returns empty because the IN filter excludes non-cert types
    setupEntityMentions([]);

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    // No update calls — only 2 from() calls (content_items + entity_mentions)
    expect(mockClient.from).toHaveBeenCalledTimes(2);
  });

  it('T1.8: empty temporal references — no-op', async () => {
    setupContentItem({ some_other_field: 'value' });

    // reconcile should not even be called since there are no refs
    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    // Only 1 from() call (content_items), no entity_mentions query
    expect(mockClient.from).toHaveBeenCalledTimes(1);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  // --- Phase 4: Token-level matching tests ---

  it('T1.9: token matching — "ISO 27001 cert renewal" matches "ISO 27001 Certification"', async () => {
    setupContentItem({
      ai_temporal_references: [
        {
          date: '2025-06-30',
          context: 'ISO 27001 cert renewal due',
          context_type: 'expiry',
        },
      ],
    });
    mockReconcile.mockReturnValue([
      {
        date: '2025-06-30',
        context: 'ISO 27001 cert renewal due',
        context_type: 'expiry',
        source: 'ai',
      },
    ]);

    // Canonical name is longer than the mention in context — old substring matching would fail
    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: null,
      },
    ]);

    const updateChain = setupUpdateCall();

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    expect(updateChain.readBack()).toMatchObject({ expiry_date: '2025-06-30' });
  });

  it('T1.10: token matching — partial name match with short entity name', async () => {
    setupContentItem({
      ai_temporal_references: [
        {
          date: '2025-12-01',
          context: '27001 certification expires 2025',
          context_type: 'expiry',
        },
      ],
    });
    mockReconcile.mockReturnValue([
      {
        date: '2025-12-01',
        context: '27001 certification expires 2025',
        context_type: 'expiry',
        source: 'ai',
      },
    ]);

    // Context omits "ISO" prefix — old substring matching would fail
    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: null,
      },
    ]);

    const updateChain = setupUpdateCall();

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    // Should match with 50% coverage (1 of 2 tokens) and confidence 0.6
    expect(updateChain.readBack()).toMatchObject({ expiry_date: '2025-12-01' });
  });

  // --- Phase 4: Duration-to-date computation tests ---

  it('T1.11: duration P3Y with date_obtained computes expiry_date', async () => {
    setupContentItem({
      ai_temporal_references: [
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
      ],
    });
    // Effective refs sorted before expiry by bridge logic
    mockReconcile.mockReturnValue([
      {
        date: '2024-06-15',
        context: 'ISO 27001 awarded',
        context_type: 'effective',
        source: 'ai',
      },
      {
        date: 'P3Y',
        context: 'ISO 27001 certification valid for 3 years',
        context_type: 'expiry',
        source: 'ai',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: null,
      },
    ]);

    const updateChain = setupUpdateCall();

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    expect(updateChain.readBack()).toMatchObject({
      date_obtained: '2024-06-15',
      expiry_date: '2027-06-15',
    });
  });

  it('T1.12: duration P3Y without date_obtained — no expiry computed, renewal_period stored', async () => {
    setupContentItem({
      ai_temporal_references: [
        {
          date: 'P3Y',
          context: 'ISO 27001 certification valid for 3 years',
          context_type: 'expiry',
        },
      ],
    });
    mockReconcile.mockReturnValue([
      {
        date: 'P3Y',
        context: 'ISO 27001 certification valid for 3 years',
        context_type: 'expiry',
        source: 'ai',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: null,
      },
    ]);

    // Duration without date_obtained now stores renewal_period as fallback
    const updateChain = setupUpdateCall();

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    // Duration cannot be resolved to a calendar date without date_obtained,
    // but renewal_period is stored as useful lifecycle metadata
    expect(mockClient.from).toHaveBeenCalledTimes(3);
    expect(updateChain.readBack()).toMatchObject({ renewal_period: 'P3Y' });
    // expiry_date should NOT be set since no date_obtained was available
    expect(updateChain.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ expiry_date: expect.any(String) }),
      }),
    );
  });

  it('T1.13: effective-first ordering ensures duration can be computed', async () => {
    // Reconcile returns expiry BEFORE effective — bridge should sort them
    setupContentItem({
      ai_temporal_references: [
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
      ],
    });
    mockReconcile.mockReturnValue([
      {
        date: 'P3Y',
        context: 'ISO 27001 valid for 3 years',
        context_type: 'expiry',
        source: 'ai',
      },
      {
        date: '2024-06-15',
        context: 'ISO 27001 granted',
        context_type: 'effective',
        source: 'ai',
      },
    ]);

    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: null,
      },
    ]);

    const updateChain = setupUpdateCall();

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    // Bridge should sort effective before expiry, so date_obtained is set before P3Y is computed
    expect(updateChain.readBack()).toMatchObject({
      date_obtained: '2024-06-15',
      expiry_date: '2027-06-15',
    });
  });

  it('T1.14: duration with existing date_obtained in metadata', async () => {
    setupContentItem({
      ai_temporal_references: [
        {
          date: 'P3Y',
          context: 'ISO 27001 valid for 3 years',
          context_type: 'expiry',
        },
      ],
    });
    mockReconcile.mockReturnValue([
      {
        date: 'P3Y',
        context: 'ISO 27001 valid for 3 years',
        context_type: 'expiry',
        source: 'ai',
      },
    ]);

    // Entity already has date_obtained from a previous bridge run
    setupEntityMentions([
      {
        id: 'em-1',
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        metadata: { date_obtained: '2023-01-01' },
      },
    ]);

    const updateChain = setupUpdateCall();

    await bridgeTemporalReferencesToEntities(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      contentItemId,
    );

    expect(updateChain.readBack()).toMatchObject({
      date_obtained: '2023-01-01',
      expiry_date: '2026-01-01',
    });
  });
});
