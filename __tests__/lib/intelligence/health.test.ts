// __tests__/lib/intelligence/health.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- mock supabase clients require flexible typing */
import { describe, it, expect } from 'vitest';
import {
  getPipelineHealth,
  getSourceHealthSummary,
} from '@/lib/intelligence/health';
import {
  createMockSupabaseTableDispatch,
  type MockTableResolution,
} from '@/__tests__/helpers/mock-supabase';

// Each lib function reads one or two tables and awaits at a chain terminal;
// route each table to its own thenable chain resolving to the fixture data.
function createMockSupabase(
  tableResolutions: Record<string, MockTableResolution<any>> = {},
) {
  return createMockSupabaseTableDispatch(tableResolutions);
}

describe('getPipelineHealth', () => {
  it('returns healthy status when recent run exists and no failures', async () => {
    const recentTime = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 mins ago
    const supabase = createMockSupabase({
      si_processing_queue: {
        data: [{ completed_at: recentTime }],
        error: null,
      },
      feed_sources: {
        data: [
          { id: 's1', consecutive_failures: 0, is_active: true },
          { id: 's2', consecutive_failures: 0, is_active: true },
        ],
        error: null,
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
      si_processing_queue: {
        data: [{ completed_at: recentTime }],
        error: null,
      },
      feed_sources: {
        data: [
          { id: 's1', consecutive_failures: 10, is_active: true },
          { id: 's2', consecutive_failures: 3, is_active: true },
        ],
        error: null,
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
      si_processing_queue: {
        data: [{ completed_at: oldTime }],
        error: null,
      },
      feed_sources: {
        data: [{ id: 's1', consecutive_failures: 0, is_active: true }],
        error: null,
      },
    });

    const health = await getPipelineHealth(supabase as any);
    expect(health.healthy).toBe(false);
    expect(health.statusMessage).toContain('hours');
  });

  it('reports unhealthy when pipeline has never run', async () => {
    const supabase = createMockSupabase({
      si_processing_queue: {
        data: [],
        error: null,
      },
      feed_sources: {
        data: [{ id: 's1', consecutive_failures: 0, is_active: true }],
        error: null,
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
      feed_sources: {
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
      feed_sources: {
        data: [],
        error: null,
      },
    });

    const summary = await getSourceHealthSummary(supabase as any, 'ws-empty');
    expect(summary.sources).toHaveLength(0);
    expect(summary.healthySources).toBe(0);
    expect(summary.failingSources).toBe(0);
  });

  it('counts disabled sources at failure limit', async () => {
    const supabase = createMockSupabase({
      feed_sources: {
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
      },
    });

    const summary = await getSourceHealthSummary(supabase as any, 'ws-1');
    expect(summary.disabledSources).toBe(1);
    expect(summary.failingSources).toBe(1);
  });
});
