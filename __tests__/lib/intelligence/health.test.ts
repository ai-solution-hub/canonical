// __tests__/lib/intelligence/health.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- mock supabase clients require flexible typing */
import { describe, it, expect, vi } from 'vitest';
import { getPipelineHealth, getSourceHealthSummary } from '@/lib/intelligence/health';

function createMockSupabase(overrides: Record<string, any> = {}) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
  };

  // Make chain thenable (so await works on the chain directly)
  const createChain = () => {
    const c = { ...chain };
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
    c.order = vi.fn().mockReturnValue(c);
    c.limit = vi.fn().mockReturnValue(c);
    return c;
  };

  return {
    from: vi.fn().mockImplementation((table: string) => {
      const c = createChain();
      if (overrides[table]) {
        return overrides[table](c);
      }
      return c;
    }),
    ...overrides._extra,
  };
}

describe('getPipelineHealth', () => {
  it('returns healthy status when recent run exists and no failures', async () => {
    const recentTime = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 mins ago
    const supabase = createMockSupabase({
      si_processing_queue: (chain: any) => {
        chain.limit = vi.fn().mockResolvedValue({
          data: [{ completed_at: recentTime }],
          error: null,
        });
        return chain;
      },
      feed_sources: (chain: any) => {
        // Return chain that resolves to sources with no failures
        chain.eq = vi.fn().mockResolvedValue({
          data: [
            { id: 's1', consecutive_failures: 0, is_active: true },
            { id: 's2', consecutive_failures: 0, is_active: true },
          ],
          error: null,
        });
        return chain;
      },
    });

    const health = await getPipelineHealth(supabase as any);
    expect(health.healthy).toBe(true);
    expect(health.lastSuccessfulRun).toBe(recentTime);
    expect(health.sourcesWithFailures).toBe(0);
    expect(health.sourcesAtFailureLimit).toBe(0);
    expect(health.totalActiveSources).toBe(2);
  });

  it('reports unhealthy when sources are at failure limit', async () => {
    const recentTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const supabase = createMockSupabase({
      si_processing_queue: (chain: any) => {
        chain.limit = vi.fn().mockResolvedValue({
          data: [{ completed_at: recentTime }],
          error: null,
        });
        return chain;
      },
      feed_sources: (chain: any) => {
        chain.eq = vi.fn().mockResolvedValue({
          data: [
            { id: 's1', consecutive_failures: 10, is_active: true },
            { id: 's2', consecutive_failures: 3, is_active: true },
          ],
          error: null,
        });
        return chain;
      },
    });

    const health = await getPipelineHealth(supabase as any);
    expect(health.healthy).toBe(false);
    expect(health.sourcesAtFailureLimit).toBe(1);
    expect(health.sourcesWithFailures).toBe(2);
    expect(health.statusMessage).toContain('failure limit');
  });

  it('reports unhealthy when pipeline has not run recently', async () => {
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48 hours ago
    const supabase = createMockSupabase({
      si_processing_queue: (chain: any) => {
        chain.limit = vi.fn().mockResolvedValue({
          data: [{ completed_at: oldTime }],
          error: null,
        });
        return chain;
      },
      feed_sources: (chain: any) => {
        chain.eq = vi.fn().mockResolvedValue({
          data: [{ id: 's1', consecutive_failures: 0, is_active: true }],
          error: null,
        });
        return chain;
      },
    });

    const health = await getPipelineHealth(supabase as any);
    expect(health.healthy).toBe(false);
    expect(health.statusMessage).toContain('hours');
  });

  it('reports unhealthy when pipeline has never run', async () => {
    const supabase = createMockSupabase({
      si_processing_queue: (chain: any) => {
        chain.limit = vi.fn().mockResolvedValue({
          data: [],
          error: null,
        });
        return chain;
      },
      feed_sources: (chain: any) => {
        chain.eq = vi.fn().mockResolvedValue({
          data: [{ id: 's1', consecutive_failures: 0, is_active: true }],
          error: null,
        });
        return chain;
      },
    });

    const health = await getPipelineHealth(supabase as any);
    expect(health.healthy).toBe(false);
    expect(health.lastSuccessfulRun).toBeNull();
    expect(health.statusMessage).toContain('never');
  });
});

describe('getSourceHealthSummary', () => {
  it('returns per-source health data for a workspace', async () => {
    const supabase = createMockSupabase({
      feed_sources: (chain: any) => {
        chain.order = vi.fn().mockResolvedValue({
          data: [
            {
              id: 's1',
              name: 'DfE Feed',
              url: 'https://www.gov.uk/feed',
              last_polled_at: '2026-04-05T10:00:00Z',
              last_polled_status: 'success',
              last_polled_error: null,
              consecutive_failures: 0,
              polling_interval_minutes: 30,
              article_count: 42,
              is_active: true,
            },
            {
              id: 's2',
              name: 'Ofsted Feed',
              url: 'https://www.gov.uk/ofsted',
              last_polled_at: '2026-04-05T09:00:00Z',
              last_polled_status: 'error',
              last_polled_error: 'Rate limited by www.gov.uk',
              consecutive_failures: 3,
              polling_interval_minutes: 60,
              article_count: 15,
              is_active: true,
            },
          ],
          error: null,
        });
        return chain;
      },
    });

    const summary = await getSourceHealthSummary(supabase as any, 'ws-1');
    expect(summary.workspaceId).toBe('ws-1');
    expect(summary.sources).toHaveLength(2);
    expect(summary.healthySources).toBe(1);
    expect(summary.failingSources).toBe(1);
    expect(summary.sources[1].lastPolledError).toContain('Rate limited');
  });

  it('returns empty summary when no sources exist', async () => {
    const supabase = createMockSupabase({
      feed_sources: (chain: any) => {
        chain.order = vi.fn().mockResolvedValue({
          data: [],
          error: null,
        });
        return chain;
      },
    });

    const summary = await getSourceHealthSummary(supabase as any, 'ws-empty');
    expect(summary.sources).toHaveLength(0);
    expect(summary.healthySources).toBe(0);
    expect(summary.failingSources).toBe(0);
  });

  it('counts disabled sources at failure limit', async () => {
    const supabase = createMockSupabase({
      feed_sources: (chain: any) => {
        chain.order = vi.fn().mockResolvedValue({
          data: [
            {
              id: 's1',
              name: 'Dead Feed',
              url: 'https://broken.example.com/feed',
              last_polled_at: '2026-04-01T10:00:00Z',
              last_polled_status: 'error',
              last_polled_error: 'Connection refused',
              consecutive_failures: 10,
              polling_interval_minutes: 30,
              article_count: 0,
              is_active: true,
            },
          ],
          error: null,
        });
        return chain;
      },
    });

    const summary = await getSourceHealthSummary(supabase as any, 'ws-1');
    expect(summary.disabledSources).toBe(1);
    expect(summary.failingSources).toBe(1);
  });
});
