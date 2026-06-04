/**
 * Unit tests for the PURE `detectStalls` predicate of the datapath stall-watch
 * (ID-66 {66.15}, `deploy/onprem/monitor/datapath-watch.ts`).
 *
 * The predicate is deterministic: it takes rows + config + an explicit `now`
 * (passed in, NOT read from Date.now() — KH date-test discipline), and returns
 * the stall alerts. No live DB, no env, no clock. These tests assert REAL
 * behaviour across the five documented scenarios:
 *
 *   idle / in-flight (within threshold) / stalled (condition A) /
 *   terminal-failure (condition B) / silence-during-active-ingestion (condition C),
 *
 * plus the idle-mode guard (silence must NOT alert when not ingesting / idle boot).
 */

import { describe, it, expect } from 'vitest';
import {
  detectStalls,
  type MonitorConfig,
  type PipelineRunRow,
} from '@/deploy/onprem/monitor/datapath-watch';

// Fixed clock — all relative timestamps below are derived from this.
const NOW = new Date('2026-06-04T12:00:00.000Z');
const NOW_MS = NOW.getTime();

/** Build an ISO timestamp `minutes` before NOW. */
function minutesAgo(minutes: number): string {
  return new Date(NOW_MS - minutes * 60_000).toISOString();
}

/** A config with ingestion ACTIVE (source staged, INGESTION_EXPECTED true). */
function activeConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    stallThresholdMinutes: 30,
    expectedRunWindowMinutes: 60,
    ingestionExpected: true,
    cocoindexSourcePath: '/corpus/staged',
    ...overrides,
  };
}

/** A config in IDLE boot — no source path, ingestion not expected. */
function idleConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    stallThresholdMinutes: 30,
    expectedRunWindowMinutes: 60,
    ingestionExpected: false,
    cocoindexSourcePath: '',
    ...overrides,
  };
}

function row(overrides: Partial<PipelineRunRow>): PipelineRunRow {
  return {
    pipeline_name: 'cocoindex_ingest',
    status: 'completed',
    started_at: minutesAgo(5),
    completed_at: minutesAgo(5),
    op_id: 'op-default',
    error_message: null,
    ...overrides,
  };
}

describe('detectStalls', () => {
  it('idle: no rows, ingestion not expected → no alert (idle-mode guard)', () => {
    const alerts = detectStalls([], idleConfig(), NOW);
    expect(alerts).toEqual([]);
  });

  it('in-flight within threshold: in_progress row younger than threshold → no alert', () => {
    const rows: PipelineRunRow[] = [
      row({
        op_id: 'op-1',
        status: 'in_progress',
        started_at: minutesAgo(10), // 10 < 30 threshold
        completed_at: minutesAgo(10), // Gotcha-C: stamped even on flow-start
      }),
    ];
    const alerts = detectStalls(rows, activeConfig(), NOW);
    expect(alerts.filter((a) => a.condition === 'A')).toHaveLength(0);
  });

  it('stalled: in_progress past threshold with no terminal row → condition A alert', () => {
    const rows: PipelineRunRow[] = [
      row({
        op_id: 'op-stuck',
        pipeline_name: 'cocoindex_ingest',
        status: 'in_progress',
        started_at: minutesAgo(45), // 45 > 30 threshold, no terminal row
        completed_at: minutesAgo(45),
      }),
    ];
    const alerts = detectStalls(rows, activeConfig(), NOW);
    const a = alerts.filter((x) => x.condition === 'A');
    expect(a).toHaveLength(1);
    expect(a[0].opId).toBe('op-stuck');
    expect(a[0].severity).toBe('error');
    expect(a[0].message).toContain('Stuck-in-flight');
    expect(a[0].message).toContain('op-stuck');
  });

  it('stalled but terminal row present for same op_id → NO condition A alert', () => {
    // Keys off op_id + status (Gotcha-C), NOT completed_at: an old in_progress row
    // with a matching terminal row is a CLOSED run, not a stall.
    const rows: PipelineRunRow[] = [
      row({
        op_id: 'op-closed',
        status: 'in_progress',
        started_at: minutesAgo(50),
        completed_at: minutesAgo(50),
      }),
      row({
        op_id: 'op-closed',
        status: 'completed',
        started_at: minutesAgo(48),
        completed_at: minutesAgo(48),
      }),
    ];
    const alerts = detectStalls(rows, activeConfig(), NOW);
    expect(alerts.filter((a) => a.condition === 'A')).toHaveLength(0);
  });

  it('terminal-failure: a failed row → condition B alert (host-side cross-check)', () => {
    const rows: PipelineRunRow[] = [
      row({
        op_id: 'op-fail',
        pipeline_name: 'cocoindex_ingest',
        status: 'failed',
        started_at: minutesAgo(3),
        completed_at: minutesAgo(3),
        error_message: 'embedding provider 503',
      }),
    ];
    const alerts = detectStalls(rows, activeConfig(), NOW);
    const b = alerts.filter((x) => x.condition === 'B');
    expect(b).toHaveLength(1);
    expect(b[0].opId).toBe('op-fail');
    expect(b[0].severity).toBe('error');
    expect(b[0].message).toContain('Terminal failure');
    expect(b[0].message).toContain('embedding provider 503');
  });

  it('silence during active ingestion: INGESTION_EXPECTED, no recent row → condition C alert', () => {
    const rows: PipelineRunRow[] = [
      // Only an old row, older than the 60-min expected-run window.
      row({
        op_id: 'op-old',
        status: 'completed',
        started_at: minutesAgo(90),
        completed_at: minutesAgo(90),
      }),
    ];
    const alerts = detectStalls(rows, activeConfig(), NOW);
    const c = alerts.filter((x) => x.condition === 'C');
    expect(c).toHaveLength(1);
    expect(c[0].severity).toBe('error');
    expect(c[0].message).toContain('Datapath silence');
  });

  it('silence guard: idle boot (empty source path) → NO condition C alert despite no rows', () => {
    const alerts = detectStalls([], idleConfig({ ingestionExpected: true }), NOW);
    // ingestionExpected is true here, but the source path is empty → idle boot,
    // so the idle-mode guard must suppress condition C.
    expect(alerts.filter((a) => a.condition === 'C')).toHaveLength(0);
  });

  it('silence guard: ingestion NOT expected → NO condition C alert despite no rows', () => {
    const alerts = detectStalls(
      [],
      activeConfig({ ingestionExpected: false }),
      NOW,
    );
    expect(alerts.filter((a) => a.condition === 'C')).toHaveLength(0);
  });

  it('recent row during active ingestion → NO condition C alert', () => {
    const rows: PipelineRunRow[] = [
      row({
        op_id: 'op-fresh',
        status: 'completed',
        started_at: minutesAgo(5), // well within 60-min window
        completed_at: minutesAgo(5),
      }),
    ];
    const alerts = detectStalls(rows, activeConfig(), NOW);
    expect(alerts.filter((a) => a.condition === 'C')).toHaveLength(0);
  });

  it('combined: one stalled op_id + one failed row → both A and B fire', () => {
    const rows: PipelineRunRow[] = [
      row({
        op_id: 'op-stuck',
        status: 'in_progress',
        started_at: minutesAgo(40),
        completed_at: minutesAgo(40),
      }),
      row({
        op_id: 'op-fail',
        status: 'failed',
        started_at: minutesAgo(2),
        completed_at: minutesAgo(2),
        error_message: 'boom',
      }),
    ];
    const alerts = detectStalls(rows, activeConfig(), NOW);
    expect(alerts.filter((a) => a.condition === 'A')).toHaveLength(1);
    expect(alerts.filter((a) => a.condition === 'B')).toHaveLength(1);
    // op-fail is recent, so condition C should NOT also fire.
    expect(alerts.filter((a) => a.condition === 'C')).toHaveLength(0);
  });
});
