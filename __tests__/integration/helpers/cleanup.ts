/**
 * Cleanup Utilities for Integration Tests
 *
 * Provides cleanup functions for test data created during integration tests.
 * For mock-based tests, cleanup simply resets the mock state.
 * For live DB tests, cleanup deletes test data respecting FK constraints.
 */
import type { MockSupabaseClient } from '../../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Mock cleanup
// ---------------------------------------------------------------------------

/**
 * Reset all mock state on a MockSupabaseClient.
 * Call in beforeEach to ensure clean state between tests.
 */
export function resetMockClient(client: MockSupabaseClient): void {
  client.from.mockClear();
  client.rpc.mockClear();
  client.auth.getUser.mockClear();

  const chainable = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;

  for (const method of chainable) {
    client._chain[method].mockClear();
    client._chain[method].mockReturnValue(client._chain);
  }

  client._chain.single.mockReset();
  client._chain.single.mockResolvedValue({ data: null, error: null });
  client._chain.maybeSingle.mockReset();
  client._chain.maybeSingle.mockResolvedValue({ data: null, error: null });
  client._chain.csv.mockReset();
  client._chain.csv.mockResolvedValue({ data: null, error: null });
  client._chain.then.mockReset();
  client._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
  );
}

// ---------------------------------------------------------------------------
// Live DB cleanup (for future use when running against real database)
// ---------------------------------------------------------------------------

/**
 * Tracked IDs for cleanup in live DB tests.
 * Items must be deleted in reverse order of creation to respect FK constraints:
 * content_items -> guide_sections -> guides
 */
export interface TrackedTestData {
  contentItemIds: string[];
  guideSectionIds: string[];
  guideIds: string[];
}

export function createTracker(): TrackedTestData {
  return {
    contentItemIds: [],
    guideSectionIds: [],
    guideIds: [],
  };
}

/**
 * Delete all tracked test data from the live database.
 * Deletes in FK-safe order: content_items first, then guide_sections, then guides.
 *
 * Uses try/finally to ensure all cleanup attempts run even if earlier ones fail.
 */
export async function cleanupTrackedData(
  supabase: { from: (table: string) => { delete: () => { in: (col: string, ids: string[]) => Promise<{ error: unknown }> } } },
  tracker: TrackedTestData,
): Promise<void> {
  const errors: unknown[] = [];

  // Delete content items first (no FK dependencies on guides/sections)
  if (tracker.contentItemIds.length > 0) {
    try {
      const { error } = await supabase
        .from('content_items')
        .delete()
        .in('id', tracker.contentItemIds);
      if (error) errors.push(error);
    } catch (e) {
      errors.push(e);
    }
  }

  // Delete guide sections (depends on guides via FK)
  if (tracker.guideSectionIds.length > 0) {
    try {
      const { error } = await supabase
        .from('guide_sections')
        .delete()
        .in('id', tracker.guideSectionIds);
      if (error) errors.push(error);
    } catch (e) {
      errors.push(e);
    }
  }

  // Delete guides last
  if (tracker.guideIds.length > 0) {
    try {
      const { error } = await supabase
        .from('guides')
        .delete()
        .in('id', tracker.guideIds);
      if (error) errors.push(error);
    } catch (e) {
      errors.push(e);
    }
  }

  if (errors.length > 0) {
    console.error('Cleanup errors:', errors);
  }
}
