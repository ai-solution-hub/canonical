import { describe, it, expect, vi } from 'vitest';
import { runBatch } from '../../../scripts/lib/batch-runner';

/**
 * Tests for the generic read → transform → write-changed-rows loop.
 *
 * No DB: select returns an in-memory fixture, transform marks even ids as
 * changed, and write is a vi.fn() spy. Asserts dry-run writes nothing and
 * apply writes only the changed rows.
 */
interface Row {
  id: number;
  value: string;
}

const FIXTURE: Row[] = [
  { id: 1, value: 'a' }, // odd → unchanged
  { id: 2, value: 'b' }, // even → changed
  { id: 3, value: 'c' }, // odd → unchanged
  { id: 4, value: 'd' }, // even → changed
];

/** Even ids "change"; the new value is the uppercased original. */
const transform = (row: Row) => ({
  changed: row.id % 2 === 0,
  value: row.value.toUpperCase(),
});

describe('runBatch', () => {
  it('writes nothing under dryRun but still counts diffs', async () => {
    const write = vi.fn();

    const summary = await runBatch<Row, string>({
      select: async () => FIXTURE,
      transform,
      write,
      dryRun: true,
    });

    expect(write).not.toHaveBeenCalled();
    expect(summary.scanned).toBe(4);
    expect(summary.changed).toBe(2);
    expect(summary.written).toBe(0);
    expect(summary.skipped).toBe(2);
    expect(summary.errors).toBe(0);
    expect(summary.changes.map((c) => c.row.id)).toEqual([2, 4]);
  });

  it('writes only the changed rows when not dry-run', async () => {
    const write = vi.fn(async () => ({ error: null }));

    const summary = await runBatch<Row, string>({
      select: async () => FIXTURE,
      transform,
      write,
      dryRun: false,
    });

    expect(write).toHaveBeenCalledTimes(2);
    // Only the even rows, with their transformed (uppercased) value.
    expect(write).toHaveBeenCalledWith({ id: 2, value: 'b' }, 'B');
    expect(write).toHaveBeenCalledWith({ id: 4, value: 'd' }, 'D');
    expect(summary.written).toBe(2);
    expect(summary.skipped).toBe(2);
    expect(summary.errors).toBe(0);
  });

  it('passes the limit through to select', async () => {
    const select = vi.fn(async (limit: number | null) =>
      limit == null ? FIXTURE : FIXTURE.slice(0, limit),
    );

    const summary = await runBatch<Row, string>({
      select,
      transform,
      write: async () => ({ error: null }),
      dryRun: false,
      limit: 2,
    });

    expect(select).toHaveBeenCalledWith(2);
    expect(summary.scanned).toBe(2);
    expect(summary.written).toBe(1); // only id=2 in the first two rows changed
  });

  it('counts a write error and does not increment written for that row', async () => {
    const write = vi.fn(async (row: Row) =>
      row.id === 2 ? { error: { message: 'boom' } } : { error: null },
    );

    const summary = await runBatch<Row, string>({
      select: async () => FIXTURE,
      transform,
      write,
      dryRun: false,
    });

    expect(summary.changed).toBe(2);
    expect(summary.written).toBe(1); // id=4 succeeded, id=2 errored
    expect(summary.errors).toBe(1);
  });

  it('treats a void/falsy write outcome as success', async () => {
    const write = vi.fn(async () => undefined);

    const summary = await runBatch<Row, string>({
      select: async () => FIXTURE,
      transform,
      write,
      dryRun: false,
    });

    expect(summary.written).toBe(2);
    expect(summary.errors).toBe(0);
  });

  it('reports all-skipped when nothing changes', async () => {
    const write = vi.fn();

    const summary = await runBatch<Row, string>({
      select: async () => FIXTURE,
      transform: () => ({ changed: false, value: '' }),
      write,
      dryRun: false,
    });

    expect(write).not.toHaveBeenCalled();
    expect(summary.changed).toBe(0);
    expect(summary.skipped).toBe(4);
    expect(summary.written).toBe(0);
  });

  it('supports async transform', async () => {
    const summary = await runBatch<Row, string>({
      select: async () => FIXTURE,
      transform: async (row) => ({
        changed: row.id % 2 === 0,
        value: row.value.toUpperCase(),
      }),
      write: async () => ({ error: null }),
      dryRun: false,
    });

    expect(summary.written).toBe(2);
  });
});
