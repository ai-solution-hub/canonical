/**
 * Tests for the DB-backed baseline store (T11/T12, B-INV-11/12).
 *
 * Behaviour-first per test-philosophy.md: we assert the OBSERVABLE outcome of
 * each store operation — which row resolves as the active baseline, that a
 * promotion writes both an `eval_baselines` row AND an `eval_baseline_audit`
 * row carrying who/when/which `registry_version`, that history returns prior
 * baselines newest-first, and that a comparison yields per-metric deltas — not
 * the internal query-builder plumbing.
 *
 * The store reads/writes via `sb()` against a `SupabaseClient<Database>`; tests
 * inject the canonical `createMockSupabaseTable` mock (shared Supabase mock — no
 * live DB) and configure terminal resolutions per case.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { createMockSupabaseTable } from '@/__tests__/helpers/mock-supabase';
import {
  loadBaseline,
  promoteBaseline,
  baselineHistory,
  compareBaselines,
  bootstrapBaselinesFromFixtures,
  type StoredBaseline,
} from '@/lib/eval/baseline-store';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A representative stored-baseline row as PostgREST would return it. */
function row(overrides: Partial<StoredBaseline> = {}): StoredBaseline {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    touchpoint_id: 'classification',
    metrics: { domain_accuracy: 0.97, subtopic_accuracy: 0.95 },
    thresholds: {
      domain_accuracy: { min: 0.7, max_drop: 0.05 },
      subtopic_accuracy: { min: 0.5, max_drop: 0.1 },
    },
    registry_version: 1,
    promoted_by: 'eval-team',
    promoted_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// loadBaseline — resolves the active baseline from eval_baselines (NOT JSON)
// ---------------------------------------------------------------------------

describe('loadBaseline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the newest eval_baselines row as the active baseline', async () => {
    const supabase = createMockSupabaseTable();
    const active = row({
      promoted_at: '2026-06-10T00:00:00.000Z',
      metrics: { domain_accuracy: 0.99 },
    });
    // loadBaseline reads the newest row via .maybeSingle() after ordering.
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: active,
      error: null,
    });

    const result = await loadBaseline(
      supabase as unknown as SupabaseClient<Database>,
      'classification',
    );

    expect(supabase.from).toHaveBeenCalledWith('eval_baselines');
    expect(result).not.toBeNull();
    expect(result?.touchpoint_id).toBe('classification');
    expect(result?.metrics.domain_accuracy).toBe(0.99);
  });

  it('returns null when no baseline row exists for the touchpoint (first run)', async () => {
    const supabase = createMockSupabaseTable();
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const result = await loadBaseline(
      supabase as unknown as SupabaseClient<Database>,
      'never-promoted',
    );

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// promoteBaseline — writes a baseline row AND an audit row (who/when/version)
// ---------------------------------------------------------------------------

describe('promoteBaseline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a new eval_baselines row with the promoted metrics + thresholds', async () => {
    const supabase = createMockSupabaseTable();
    const inserted = row({ promoted_by: 'liam', registry_version: 3 });
    // The baseline insert returns the new row via .select().single().
    supabase._chain.single.mockResolvedValueOnce({
      data: inserted,
      error: null,
    });
    // The audit insert resolves with no row needed.
    supabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const promoted = await promoteBaseline(
      supabase as unknown as SupabaseClient<Database>,
      'classification',
      {
        metrics: { domain_accuracy: 0.98 },
        thresholds: { domain_accuracy: { min: 0.7, max_drop: 0.05 } },
        registryVersion: 3,
      },
      'liam',
    );

    // A baseline row was inserted into eval_baselines.
    expect(supabase.from).toHaveBeenCalledWith('eval_baselines');
    const baselineInsert = supabase._chain.insert.mock.calls.find((c) => {
      const payload = c[0] as Record<string, unknown>;
      return payload.metrics !== undefined && payload.promoted_by !== undefined;
    });
    expect(baselineInsert).toBeDefined();
    const baselinePayload = baselineInsert![0] as Record<string, unknown>;
    expect(baselinePayload.touchpoint_id).toBe('classification');
    expect(baselinePayload.metrics).toEqual({ domain_accuracy: 0.98 });
    expect(baselinePayload.thresholds).toEqual({
      domain_accuracy: { min: 0.7, max_drop: 0.05 },
    });
    expect(baselinePayload.registry_version).toBe(3);
    expect(baselinePayload.promoted_by).toBe('liam');

    expect(promoted.promoted_by).toBe('liam');
    expect(promoted.registry_version).toBe(3);
  });

  it('writes an eval_baseline_audit row capturing actor + registry_version', async () => {
    const supabase = createMockSupabaseTable();
    supabase._chain.single.mockResolvedValueOnce({
      data: row({ promoted_by: 'liam', registry_version: 3 }),
      error: null,
    });
    supabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    await promoteBaseline(
      supabase as unknown as SupabaseClient<Database>,
      'classification',
      {
        metrics: { domain_accuracy: 0.98 },
        thresholds: { domain_accuracy: { min: 0.7, max_drop: 0.05 } },
        registryVersion: 3,
      },
      'liam',
    );

    // An audit row was inserted into eval_baseline_audit.
    expect(supabase.from).toHaveBeenCalledWith('eval_baseline_audit');
    const auditInsert = supabase._chain.insert.mock.calls.find((c) => {
      const payload = c[0] as Record<string, unknown>;
      return payload.actor !== undefined && payload.action !== undefined;
    });
    expect(auditInsert).toBeDefined();
    const auditPayload = auditInsert![0] as Record<string, unknown>;
    expect(auditPayload.touchpoint_id).toBe('classification');
    expect(auditPayload.actor).toBe('liam');
    expect(auditPayload.action).toBe('promote');
    expect(auditPayload.registry_version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// baselineHistory — prior baselines, newest first
// ---------------------------------------------------------------------------

describe('baselineHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns prior baselines for the touchpoint, newest first', async () => {
    const supabase = createMockSupabaseTable();
    const newer = row({
      id: '22222222-2222-4222-8222-222222222222',
      promoted_at: '2026-06-10T00:00:00.000Z',
      registry_version: 2,
    });
    const older = row({
      id: '11111111-1111-4111-8111-111111111111',
      promoted_at: '2026-06-01T00:00:00.000Z',
      registry_version: 1,
    });
    // History reads the ordered list by awaiting the chain directly.
    supabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [newer, older], error: null }),
    );

    const history = await baselineHistory(
      supabase as unknown as SupabaseClient<Database>,
      'classification',
    );

    expect(supabase.from).toHaveBeenCalledWith('eval_baselines');
    expect(history).toHaveLength(2);
    expect(history[0].registry_version).toBe(2);
    expect(history[1].registry_version).toBe(1);
    // Ordered by promoted_at DESC.
    expect(supabase._chain.order).toHaveBeenCalledWith('promoted_at', {
      ascending: false,
    });
  });

  it('returns an empty array when the touchpoint has no baselines', async () => {
    const supabase = createMockSupabaseTable();
    supabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const history = await baselineHistory(
      supabase as unknown as SupabaseClient<Database>,
      'unknown',
    );

    expect(history).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// compareBaselines — per-metric deltas between two baselines
// ---------------------------------------------------------------------------

describe('compareBaselines', () => {
  it('returns the signed delta for each shared metric (b - a)', () => {
    const a = row({ metrics: { domain_accuracy: 0.9, keyword_overlap: 0.8 } });
    const b = row({
      metrics: { domain_accuracy: 0.95, keyword_overlap: 0.75 },
    });

    const deltas = compareBaselines(a, b);

    const byMetric = Object.fromEntries(deltas.map((d) => [d.metric_name, d]));
    expect(byMetric.domain_accuracy.baseline_value).toBe(0.9);
    expect(byMetric.domain_accuracy.current_value).toBe(0.95);
    expect(byMetric.domain_accuracy.delta).toBeCloseTo(0.05, 10);
    // A drop yields a negative delta.
    expect(byMetric.keyword_overlap.delta).toBeCloseTo(-0.05, 10);
  });

  it('treats a metric absent from one side as 0 on that side', () => {
    const a = row({ metrics: { domain_accuracy: 0.9 } });
    const b = row({ metrics: { domain_accuracy: 0.9, new_metric: 0.4 } });

    const deltas = compareBaselines(a, b);
    const byMetric = Object.fromEntries(deltas.map((d) => [d.metric_name, d]));

    // The new metric is present only in b → baseline (a) side is 0.
    expect(byMetric.new_metric.baseline_value).toBe(0);
    expect(byMetric.new_metric.current_value).toBe(0.4);
    expect(byMetric.new_metric.delta).toBeCloseTo(0.4, 10);
  });
});

// ---------------------------------------------------------------------------
// bootstrap — seeds the 4 flat-JSON fixtures into eval_baselines rows
// ---------------------------------------------------------------------------

describe('bootstrapBaselinesFromFixtures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('seeds one eval_baselines row per JSON fixture (4 suites)', async () => {
    const supabase = createMockSupabaseTable();
    supabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const summary = await bootstrapBaselinesFromFixtures(
      supabase as unknown as SupabaseClient<Database>,
      'bootstrap',
    );

    // One insert per fixture file (classification, entity-classification,
    // search, summarisation).
    expect(supabase.from).toHaveBeenCalledWith('eval_baselines');
    expect(summary.seeded).toBe(4);

    // The seeded touchpoint ids mirror the fixture suite names.
    const seededTouchpoints = supabase._chain.insert.mock.calls
      .map((c) => (c[0] as Record<string, unknown>).touchpoint_id)
      .filter((id): id is string => typeof id === 'string');
    expect(seededTouchpoints).toEqual(
      expect.arrayContaining([
        'classification',
        'entity-classification',
        'search',
        'summarisation',
      ]),
    );
  });

  it('carries each fixture metrics + thresholds into the seeded row', async () => {
    const supabase = createMockSupabaseTable();
    supabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    await bootstrapBaselinesFromFixtures(
      supabase as unknown as SupabaseClient<Database>,
      'bootstrap',
    );

    const classificationRow = supabase._chain.insert.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((p) => p.touchpoint_id === 'classification');
    expect(classificationRow).toBeDefined();
    // The classification fixture's domain_accuracy metric is carried verbatim.
    const metrics = classificationRow!.metrics as Record<string, number>;
    expect(metrics.domain_accuracy).toBeCloseTo(0.9746835443037974, 10);
    const thresholds = classificationRow!.thresholds as Record<
      string,
      { min?: number; max_drop?: number }
    >;
    expect(thresholds.domain_accuracy.min).toBe(0.7);
  });
});
