import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(() => ({
    auth: {
      admin: {
        getUserById: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: null }),
      },
    },
  })),
}));

vi.mock('@/lib/domains/procurement/procurement-queries', () => ({
  fetchActiveProcurementWithStats: vi.fn().mockResolvedValue({
    workspaces: [],
    statsMap: new Map(),
  }),
}));

vi.mock('@/lib/format', () => ({
  formatRelativeDate: vi.fn().mockReturnValue('just now'),
}));

// ---------------------------------------------------------------------------
// Helpers
//
// ID-131 {131.19}: the get_items_with_quality_flags RPC dropped at M6
// (content_items dies wholesale) — quality flags are now counted via a
// direct `.from('ingestion_quality_log')` query, deduped in-JS to distinct
// source_document_ids. These helpers build a table-dispatching mock so the
// `ingestion_quality_log` chain can be asserted/configured independently of
// every other `.from()` call fetchReorientData makes.
// ---------------------------------------------------------------------------

/**
 * Generic self-returning chain for `.from()` calls this suite doesn't care
 * about (content_history, read_marks, record_lifecycle, notifications,
 * form_response_history). Always resolves to an empty/zero result.
 */
function makeGenericChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of [
    'select',
    'eq',
    'neq',
    'gt',
    'is',
    'not',
    'or',
    'order',
    'limit',
  ]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
  return chain;
}

/**
 * Chain for `.from('ingestion_quality_log')` — mirrors the production chain
 * `.select('source_document_id').eq('resolved', false).not('source_document_id',
 * 'is', null)`, thenable to `{ data: rows, error: null }` so the code's own
 * `.then((res) => ({data: [...distinctIds], error: res.error}))` runs against
 * `rows` exactly as it would against a real Postgrest response.
 */
function makeQualityLogChain(rows: Array<{ source_document_id: string }>) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'eq', 'not']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ data: rows, error: null }),
  );
  return chain;
}

function makeSupabase(qualityLogRows: Array<{ source_document_id: string }>) {
  const qualityLogChain = makeQualityLogChain(qualityLogRows);
  const from = vi.fn((table: string) =>
    table === 'ingestion_quality_log' ? qualityLogChain : makeGenericChain(),
  );
  return {
    from,
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: { id: 'user-1', email: 'test@test.com', user_metadata: {} },
        },
        error: null,
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchReorientData quality flag query alignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries ingestion_quality_log directly for admin quality flag count (RPC removed)', async () => {
    // Dynamically import to pick up mocks
    const { fetchReorientData } = await import('@/lib/reorient');

    const supabase = makeSupabase([
      { source_document_id: 'doc-1' },
      { source_document_id: 'doc-2' },
    ]);

    const result = await fetchReorientData(
      supabase as unknown as Parameters<typeof fetchReorientData>[0],
      'user-1',
      true,
      'admin',
    );

    // Verify the direct facet query fired instead of the (now-dropped) RPC
    expect(supabase.from).toHaveBeenCalledWith('ingestion_quality_log');
    // The quality flag count should be the number of distinct source_document_ids
    expect(result.counts.quality_flags).toBe(2);
  });

  it('does not query ingestion_quality_log for non-admin users', async () => {
    const { fetchReorientData } = await import('@/lib/reorient');

    const supabase = makeSupabase([
      { source_document_id: 'doc-1' },
      { source_document_id: 'doc-2' },
    ]);

    const result = await fetchReorientData(
      supabase as unknown as Parameters<typeof fetchReorientData>[0],
      'user-1',
      false,
      'editor',
    );

    // For non-admin, the quality-flags branch short-circuits to
    // Promise.resolve({data: [], error: null}) — no from() call at all.
    expect(supabase.from).not.toHaveBeenCalledWith('ingestion_quality_log');
    expect(result.counts.quality_flags).toBe(0);
  });

  it('returns consistent count format with fetchUnifiedDashboardData — counts DISTINCT source_document_ids, not raw log rows', async () => {
    // Both fetchUnifiedDashboardData (via get_dashboard_attention_counts) and
    // fetchReorientData (via this direct query) must count distinct flagged
    // items, not raw ingestion_quality_log rows. Simulate 3 log entries
    // across 2 distinct source documents — the count must be 2.
    const { fetchReorientData } = await import('@/lib/reorient');

    const supabase = makeSupabase([
      { source_document_id: 'doc-a' },
      { source_document_id: 'doc-a' },
      { source_document_id: 'doc-b' },
    ]);

    const result = await fetchReorientData(
      supabase as unknown as Parameters<typeof fetchReorientData>[0],
      'user-1',
      true,
      'admin',
    );

    // Should be 2 (distinct source documents), not 3 (raw log rows)
    expect(result.counts.quality_flags).toBe(2);
  });
});
