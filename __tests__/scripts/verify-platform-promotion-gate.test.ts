import { describe, it, expect } from 'vitest';
import {
  N_CONTENT,
  N_FEED,
  N_WALK,
  coalesceRunTimestampMs,
  selectLatestRun,
  extractStageCounts,
  evaluateG1,
  evaluateG2,
  evaluateG3,
  evaluateG4,
  evaluateG5,
  evaluateG6,
  evaluateG7,
  formatGateTable,
  type GateResult,
} from '../../scripts/verify-platform-promotion-gate';
import { PLATFORM_TARGETS } from '../../scripts/seed-platform-workspaces';

/**
 * Behaviour tests for the ID-134 {134.6} promotion-confidence gate's DB-free
 * helper logic: run-selection (coalesce-ordering), stage-count extraction,
 * and the G1–G7 pass/fail evaluators. No live DB — these are the pure
 * decision functions the CLI bootstrap wires up against real query results.
 *
 * Test philosophy: behaviour, not implementation — assertions are on
 * `GateResult.pass` + observable `detail` content, not on internal call
 * shape.
 */

function run(
  overrides: Partial<Parameters<typeof selectLatestRun>[0][number]> = {},
) {
  return {
    id: 'run-1',
    op_id: 'op-1',
    status: 'completed',
    completed_at: '2026-07-02T17:20:40.053Z',
    ended_at: '2026-07-02T17:20:40.053Z',
    created_at: '2026-07-02T17:20:40.110Z',
    result: null,
    progress: null,
    ...overrides,
  };
}

describe('selectLatestRun / coalesceRunTimestampMs', () => {
  it('returns null for an empty candidate set', () => {
    expect(selectLatestRun([])).toBeNull();
  });

  it('picks the row with the latest coalesced timestamp', () => {
    const older = run({
      id: 'older',
      completed_at: '2026-07-02T16:00:00.000Z',
    });
    const newer = run({
      id: 'newer',
      completed_at: '2026-07-02T17:20:40.053Z',
    });
    expect(selectLatestRun([older, newer])?.id).toBe('newer');
    expect(selectLatestRun([newer, older])?.id).toBe('newer');
  });

  it('falls back through ended_at then created_at when completed_at is null', () => {
    // An in-progress start row: completed_at set at insert time, ended_at
    // null. Its own coalesce uses completed_at (never both null in this
    // schema), but the fallback chain is exercised directly here.
    const row = run({
      completed_at: null,
      ended_at: null,
      created_at: '2026-07-02T12:00:00.000Z',
    });
    expect(coalesceRunTimestampMs(row)).toBe(
      new Date('2026-07-02T12:00:00.000Z').getTime(),
    );
  });

  it('prefers a later in-progress start row over an earlier terminal row of a different op_id', () => {
    // This documents the RUN-SELECT contract precisely: the WHERE clause has
    // no status filter, so a fresher non-terminal row can legitimately win
    // the coalesce-DESC ordering. G1 (not selectLatestRun) is what reports
    // that as a failure.
    const olderCompleted = run({
      id: 'older-completed',
      status: 'completed',
      completed_at: '2026-07-02T16:00:00.000Z',
    });
    const newerInProgress = run({
      id: 'newer-in-progress',
      status: 'in_progress',
      completed_at: '2026-07-02T18:00:00.000Z',
      ended_at: null,
    });
    const selected = selectLatestRun([olderCompleted, newerInProgress]);
    expect(selected?.id).toBe('newer-in-progress');
    expect(evaluateG1(selected ?? null).pass).toBe(false);
  });
});

describe('extractStageCounts', () => {
  it('reads stage_counts from result when present', () => {
    const counts = extractStageCounts({
      result: { stage_counts: { chunking: 8, source_walk: 12 } },
      progress: null,
    });
    expect(counts.chunking).toBe(8);
    expect(counts.source_walk).toBe(12);
  });

  it('falls back to progress.stage_counts when result lacks it', () => {
    const counts = extractStageCounts({
      result: { extractor_version: 'v1' },
      progress: { stage_counts: { chunking: 0 } },
    });
    expect(counts.chunking).toBe(0);
  });

  it('returns an empty object when neither column carries stage_counts', () => {
    expect(extractStageCounts({ result: null, progress: null })).toEqual({});
  });
});

describe('evaluateG1', () => {
  it('fails when no run was selected', () => {
    expect(evaluateG1(null).pass).toBe(false);
  });

  it('passes for a terminal completed row', () => {
    expect(evaluateG1(run({ status: 'completed' })).pass).toBe(true);
  });

  it('fails for a non-completed status', () => {
    const result = evaluateG1(run({ status: 'failed' }));
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('failed');
  });
});

describe('evaluateG2 (stage coherence)', () => {
  it('passes when source_walk clears the lower bound and embedding matches chunking', () => {
    expect(evaluateG2(N_WALK, 8, 8, null).pass).toBe(true);
    expect(evaluateG2(N_WALK + 10, 8, 8, null).pass).toBe(true);
  });

  it('fails when source_walk is below the lower bound', () => {
    expect(evaluateG2(N_WALK - 1, 8, 8, null).pass).toBe(false);
  });

  it('fails when source_walk is absent from stage_counts', () => {
    expect(evaluateG2(undefined, 8, 8, null).pass).toBe(false);
  });

  it('fails when chunking is zero', () => {
    expect(evaluateG2(N_WALK, 0, 0, null).pass).toBe(false);
  });

  it('fails when the embedded count under-reports vs chunk count (the empirical rollup drift)', () => {
    // Live-observed: stage_counts.embedding=7 while actual embedded rows=8/8.
    // G2 derives its embedding number from the live join (chunkCheck), not
    // the rollup counter, so a genuine live shortfall (7 embedded of 8
    // chunks) must still fail.
    expect(evaluateG2(N_WALK, 8, 7, null).pass).toBe(false);
  });

  it('surfaces a query error as a failing gate', () => {
    const result = evaluateG2(N_WALK, 8, 8, 'network blip');
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('network blip');
  });
});

describe('evaluateG3 (source_documents count)', () => {
  const expected = N_CONTENT + N_FEED;

  it('passes on the exact expected count', () => {
    expect(evaluateG3(expected, null).pass).toBe(true);
  });

  it('fails one below or one above the expected count', () => {
    expect(evaluateG3(expected - 1, null).pass).toBe(false);
    expect(evaluateG3(expected + 1, null).pass).toBe(false);
  });
});

describe('evaluateG4 (HEADLINE: content_chunks embedded)', () => {
  it('passes when every chunk is embedded', () => {
    expect(evaluateG4(8, 8, [], null).pass).toBe(true);
  });

  it('fails when zero chunks exist for the run', () => {
    expect(evaluateG4(0, 0, [], null).pass).toBe(false);
  });

  it('fails and lists missing ids when some chunks are unembedded', () => {
    const result = evaluateG4(8, 6, ['a', 'b'], null);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('a');
    expect(result.detail).toContain('b');
  });

  it('truncates the missing-id preview beyond 5 entries', () => {
    const missing = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const result = evaluateG4(8, 1, missing, null);
    expect(result.detail).toContain('+2 more');
  });
});

describe('evaluateG5 (q_a_extractions)', () => {
  it('fails when there are zero rows', () => {
    expect(evaluateG5([], null).pass).toBe(false);
  });

  it('fails when any row has a null source_document_id', () => {
    const result = evaluateG5(
      [{ source_document_id: 'sd-1' }, { source_document_id: null }],
      null,
    );
    expect(result.pass).toBe(false);
  });

  it('passes when at least one row and none null', () => {
    expect(evaluateG5([{ source_document_id: 'sd-1' }], null).pass).toBe(true);
  });
});

describe('evaluateG6 (reference_items)', () => {
  it('passes on exactly N_FEED rows all non-null', () => {
    const rows = Array.from({ length: N_FEED }, (_, i) => ({
      source_document_id: `sd-${i}`,
    }));
    expect(evaluateG6(rows, null).pass).toBe(true);
  });

  it('fails when the count does not equal N_FEED', () => {
    expect(evaluateG6([{ source_document_id: 'sd-1' }], null).pass).toBe(false);
  });
});

describe('evaluateG7 (Platform DSN isolation)', () => {
  it('passes for the known prod ref', () => {
    const resolved = {
      target: 'prod' as const,
      url: `https://${PLATFORM_TARGETS.prod.projectRef}.supabase.co`,
      serviceRoleKey: 'x',
      projectRef: PLATFORM_TARGETS.prod.projectRef,
    };
    expect(evaluateG7(resolved).pass).toBe(true);
  });

  it('fails for an unrecognised project ref', () => {
    const resolved = {
      target: 'prod' as const,
      url: 'https://some-other-project.supabase.co',
      serviceRoleKey: 'x',
      projectRef: 'some-other-project',
    };
    expect(evaluateG7(resolved).pass).toBe(false);
  });
});

describe('formatGateTable', () => {
  it('renders PASS/FAIL/INFO tags per row', () => {
    const results: GateResult[] = [
      { id: 'G1', label: 'a', pass: true, detail: 'ok' },
      { id: 'G4', label: 'b', pass: false, detail: 'bad' },
      { id: 'E', label: 'c', pass: true, informational: true, detail: 'fyi' },
    ];
    const table = formatGateTable(results);
    expect(table).toContain('[PASS] G1');
    expect(table).toContain('[FAIL] G4');
    expect(table).toContain('[INFO] E');
  });
});
