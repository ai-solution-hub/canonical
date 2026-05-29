/**
 * ledger-renormalise.test.ts — ID-65.5 re-normalise tool
 * (`scripts/ledger-renormalise.ts`). The one-shot that rewrites all three
 * ledgers via `escapeSerialise(detectSchema(text).data)` to clear the ~7-line
 * residual drift (RESEARCH §8), so a subsequent `escapeSerialise(detectSchema(
 * text).data)` round-trip becomes byte-identical and a later `--whole-file` (or
 * always-whole-file delete) write is itself minimal-diff.
 *
 * DOGFOODING HAZARD: this tool writes ledger JSON. EVERY test runs against a
 * TEMP dir holding COPIES of the real ledgers (or a synthetic residual) — NEVER
 * the real `docs/reference/*.json`. We drive the exported `renormaliseLedgers`
 * directly with the temp dir; the CLI's own `--ledger-dir` plumbing is exercised
 * by passing the same dir.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  copyFileSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { renormaliseLedgers } from '@/scripts/ledger-renormalise';
import { detectSchema } from '@/lib/ledger/detect-schema';
import { escapeSerialise } from '@/lib/ledger/scoped-serialise';

const REPO = resolve(__dirname, '../..');
const REAL = {
  task: join(REPO, 'docs/reference/task-list.json'),
  roadmap: join(REPO, 'docs/reference/product-roadmap.json'),
  backlog: join(REPO, 'docs/reference/product-backlog.json'),
};
const FILES = [
  'task-list.json',
  'product-roadmap.json',
  'product-backlog.json',
] as const;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-renorm-'));
  copyFileSync(REAL.task, join(dir, 'task-list.json'));
  copyFileSync(REAL.roadmap, join(dir, 'product-roadmap.json'));
  copyFileSync(REAL.backlog, join(dir, 'product-backlog.json'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A no-op escapeSerialise(detectSchema(text).data) round-trip is byte-identical
 * iff the file is already in the canonical normalised form (the §8 residual is
 * cleared). Returns whether the round-trip is a true byte-level no-op. */
function roundTripIsByteIdentical(path: string): boolean {
  const text = readFileSync(path, 'utf8');
  const detected = detectSchema(JSON.parse(text));
  if (detected.kind === 'unknown') throw new Error(`${path}: unknown kind`);
  return escapeSerialise(detected.data) === text;
}

describe('ledger-renormalise — clears the residual so the round-trip is a no-op', () => {
  it('after re-normalising, escapeSerialise(detectSchema(text).data) is byte-identical for all three ledgers', () => {
    renormaliseLedgers(dir);
    for (const f of FILES) {
      expect(roundTripIsByteIdentical(join(dir, f)), f).toBe(true);
    }
  });

  it('clears a SYNTHETIC residual (raw-UTF8 + reordered keys) — round-trip becomes a no-op', () => {
    // Build a deliberate residual: re-emit the task ledger with RAW non-ASCII
    // (JSON.stringify, no \uXXXX escaping) and a perturbed top-level key order.
    // This is the kind of drift §8 describes (an earlier pass emitted a slightly
    // different escaping/order). Pre-condition: the round-trip is NOT a no-op.
    const taskPath = join(dir, 'task-list.json');
    const parsed = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<
      string,
      unknown
    >;
    // Reorder top-level keys (put `tasks` first) + emit raw UTF-8 (no escaping).
    const reordered: Record<string, unknown> = {};
    if ('tasks' in parsed) reordered.tasks = parsed.tasks;
    for (const k of Object.keys(parsed)) {
      if (k !== 'tasks') reordered[k] = parsed[k];
    }
    writeFileSync(taskPath, JSON.stringify(reordered, null, 2) + '\n');

    // Sanity: the residual is real — the round-trip is NOT byte-identical yet.
    expect(roundTripIsByteIdentical(taskPath)).toBe(false);

    // Re-normalise clears it.
    const reports = renormaliseLedgers(dir);
    expect(roundTripIsByteIdentical(taskPath)).toBe(true);

    // The task ledger report records a non-trivial line change (the residual).
    const taskReport = reports.find((r) => r.path.endsWith('task-list.json'));
    expect(taskReport).toBeDefined();
    expect(taskReport!.changedLines).toBeGreaterThan(0);
    expect(taskReport!.structuralDiffs).toBe(0);
  });

  it('is idempotent — a second run is a no-op (noopStable) on every ledger', () => {
    renormaliseLedgers(dir);
    const second = renormaliseLedgers(dir);
    for (const r of second) {
      expect(r.noopStable, r.path).toBe(true);
      expect(r.changedLines, r.path).toBe(0);
    }
  });

  it('--check mode writes nothing (a residual stays a residual)', () => {
    const taskPath = join(dir, 'task-list.json');
    const parsed = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const reordered: Record<string, unknown> = {};
    if ('tasks' in parsed) reordered.tasks = parsed.tasks;
    for (const k of Object.keys(parsed)) {
      if (k !== 'tasks') reordered[k] = parsed[k];
    }
    const residual = JSON.stringify(reordered, null, 2) + '\n';
    writeFileSync(taskPath, residual);

    const reports = renormaliseLedgers(dir, /* checkOnly */ true);
    // Nothing written — the file is byte-identical to the synthetic residual.
    expect(readFileSync(taskPath, 'utf8')).toBe(residual);
    const taskReport = reports.find((r) => r.path.endsWith('task-list.json'));
    expect(taskReport!.noopStable).toBe(false);
    expect(taskReport!.changedLines).toBeGreaterThan(0);
  });

  it('preserves semantic content — the parsed document is unchanged by normalisation', () => {
    const before = FILES.map((f) =>
      JSON.parse(readFileSync(join(dir, f), 'utf8')),
    );
    renormaliseLedgers(dir);
    const after = FILES.map((f) =>
      JSON.parse(readFileSync(join(dir, f), 'utf8')),
    );
    for (let i = 0; i < FILES.length; i++) {
      expect(after[i], FILES[i]).toEqual(before[i]);
    }
  });
});
