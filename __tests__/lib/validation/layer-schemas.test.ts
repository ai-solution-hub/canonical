import { describe, it, expect } from 'vitest';
import { createMockSupabaseClient } from '../../helpers/mock-supabase';
import { fetchActiveLayerKeys } from '@/lib/validation/layer-schemas';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

describe('fetchActiveLayerKeys', () => {
  it('returns key array from active layer_vocabulary rows ordered by display_order', async () => {
    const mock = createMockSupabaseClient();
    // Override the default chain `.then` to return layer rows
    mock._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          { key: 'sales_brief' },
          { key: 'bid_detail' },
          { key: 'company_reference' },
          { key: 'research' },
        ],
        error: null,
      }),
    );

    const keys = await fetchActiveLayerKeys(
      mock as unknown as SupabaseClient<Database>,
    );

    expect(keys).toEqual([
      'sales_brief',
      'bid_detail',
      'company_reference',
      'research',
    ]);

    // Verify correct table and filters were used
    expect(mock.from).toHaveBeenCalledWith('layer_vocabulary');
    expect(mock._chain.select).toHaveBeenCalledWith('key');
    expect(mock._chain.eq).toHaveBeenCalledWith('is_active', true);
    expect(mock._chain.order).toHaveBeenCalledWith('display_order', {
      ascending: true,
    });
  });

  it('throws on Supabase error', async () => {
    const mock = createMockSupabaseClient();
    mock._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: null,
        error: { message: 'connection refused' },
      }),
    );

    await expect(
      fetchActiveLayerKeys(mock as unknown as SupabaseClient<Database>),
    ).rejects.toThrow('Layer vocabulary fetch failed: connection refused');
  });

  it('throws on empty result', async () => {
    const mock = createMockSupabaseClient();
    mock._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [],
        error: null,
      }),
    );

    await expect(
      fetchActiveLayerKeys(mock as unknown as SupabaseClient<Database>),
    ).rejects.toThrow('No active layers found in layer_vocabulary');
  });
});
