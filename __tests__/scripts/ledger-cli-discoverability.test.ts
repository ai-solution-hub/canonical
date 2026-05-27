/**
 * ledger-cli-discoverability.test.ts — ID-35.22 (RESEARCH §5.1 / §5.2 — the
 * "prevent guessing" fix). Covers the three discoverability surfaces added to
 * `scripts/ledger-cli.ts`:
 *
 *   1. `schema [ledger|recordKind]` — per record kind, every field's
 *      name + Zod type + budget + required/optional + enum values, DERIVED
 *      from `Schema.shape` (so it cannot drift). The decisive asymmetry the
 *      dogfooding kept guessing is made self-documenting:
 *        subtask.dependencies: number[]  vs  task.dependencies: string[]
 *        subtask.id: number              vs  task.id: string
 *   2. per-subcommand `--help` — `<command> --help` prints that command's
 *      argv shape + flags + its target record's schema slice (replaces the
 *      old bare-global-USAGE fall-through).
 *   3. `get <ledger> <id> [field]` — single-field reads; no field = `show`.
 *
 * All three are READ-only (no write gate). `schema` / `--help` do not even
 * touch a ledger file; `get` reads the same paths `show` does.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  run,
  renderSchema,
  subcommandHelp,
  type ParsedArgs,
} from '@/scripts/ledger-cli';

const REPO = resolve(__dirname, '../..');
const REAL = {
  task: join(REPO, 'docs/reference/task-list.json'),
  roadmap: join(REPO, 'docs/reference/product-roadmap.json'),
  backlog: join(REPO, 'docs/reference/product-backlog.json'),
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-disc-'));
  copyFileSync(REAL.task, join(dir, 'task-list.json'));
  copyFileSync(REAL.roadmap, join(dir, 'product-roadmap.json'));
  copyFileSync(REAL.backlog, join(dir, 'product-backlog.json'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function args(
  subcommand: string,
  positionals: string[],
  extra: Partial<ParsedArgs['flags']> = {},
): ParsedArgs {
  return {
    subcommand,
    positionals,
    flags: {
      dryRun: false,
      pretty: false,
      regenMirrors: false,
      scoped: false,
      noRegenMirrors: true,
      ledgerDir: dir,
      ...extra,
    },
  };
}

// ── renderSchema (the type-derivation engine) ────────────────────────────────

describe('renderSchema — derives field labels from Schema.shape', () => {
  it('documents the deps-type asymmetry explicitly (the §3 root cause)', () => {
    const out = renderSchema('task');
    // The asymmetry, surfaced so an agent never guesses again.
    expect(out).toContain('task.dependencies: string[]');
    expect(out).toContain('subtask.dependencies: number[]');
    // The id-type asymmetry that drives the deps asymmetry.
    expect(out).toContain('task.id: string');
    expect(out).toContain('subtask.id: number');
  });

  it('annotates subtask.dependencies as sibling-only', () => {
    const out = renderSchema('subtask');
    expect(out).toMatch(/subtask\.dependencies: number\[\].*sibling-only/);
  });

  it('shows budgets inline on budgeted fields', () => {
    const subtask = renderSchema('subtask');
    expect(subtask).toContain('subtask.description: string ≤250');
    const item = renderSchema('item');
    expect(item).toContain('backlog.title: string ≤80');
  });

  it('expands enum fields to their allowed values inline', () => {
    const subtask = renderSchema('subtask');
    // status is an enum — values must appear so an agent never guesses a status.
    expect(subtask).toMatch(/subtask\.status: enum\([^)]*\bpending\b[^)]*\)/);
    expect(subtask).toMatch(/subtask\.status: enum\([^)]*\bdone\b[^)]*\)/);
    const item = renderSchema('item');
    expect(item).toMatch(/backlog\.priority: enum\([^)]*\bmust\b[^)]*\)/);
  });

  it('marks optional fields and keeps required fields unmarked', () => {
    const item = renderSchema('item');
    // title is optional on BacklogItemSchema; description is required.
    expect(item).toMatch(/backlog\.title:.*\(optional\)/);
    expect(item).not.toMatch(/backlog\.description:.*\(optional\)/);
  });

  it('does not crash on object-array fields (cross_doc_links)', () => {
    const task = renderSchema('task');
    expect(task).toContain('task.cross_doc_links');
  });
});

// ── `schema` subcommand ───────────────────────────────────────────────────────

describe('ledger-cli — schema subcommand', () => {
  it('schema task prints both task AND subtask slices (the asymmetry)', async () => {
    const r = await run(args('schema', ['task']));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const text = r.result as string;
      expect(text).toContain('task.dependencies: string[]');
      expect(text).toContain('subtask.dependencies: number[]');
    }
  });

  it('schema (no arg) prints every record kind', async () => {
    const r = await run(args('schema', []));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const text = r.result as string;
      expect(text).toContain('task.id: string');
      expect(text).toContain('subtask.id: number');
      expect(text).toContain('theme.');
      expect(text).toContain('backlog.title: string ≤80');
    }
  });

  it('accepts a recordKind alias (subtask) as well as a ledger name', async () => {
    const r = await run(args('schema', ['subtask']));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result as string).toContain('subtask.dependencies: number[]');
  });

  it('rejects an unknown schema target', async () => {
    const r = await run(args('schema', ['nonsense']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad-schema-target');
  });

  it('is read-only — touches no ledger file', async () => {
    const before = statSync(join(dir, 'task-list.json')).mtimeMs;
    await run(args('schema', ['task']));
    expect(statSync(join(dir, 'task-list.json')).mtimeMs).toBe(before);
  });
});

// ── per-subcommand `--help` ───────────────────────────────────────────────────

describe('ledger-cli — per-subcommand help', () => {
  it('add-subtask --help includes more than the bare global USAGE', () => {
    const help = subcommandHelp('add-subtask');
    expect(help).not.toBeNull();
    // The dogfooding gap: today add-subtask --help returns only the global
    // usage line. The fix must include the subtask schema slice.
    expect(help).toContain('subtask.dependencies: number[]');
    expect(help).toContain('add-subtask');
  });

  it('update-subtask --help carries the subtask schema slice', () => {
    const help = subcommandHelp('update-subtask');
    expect(help).not.toBeNull();
    expect(help).toContain('subtask.description: string ≤250');
  });

  it('create-backlog --help carries the backlog schema slice incl. title', () => {
    const help = subcommandHelp('create-backlog');
    expect(help).not.toBeNull();
    expect(help).toContain('backlog.title: string ≤80');
  });

  it('returns null for an unknown command (caller falls back to USAGE)', () => {
    expect(subcommandHelp('not-a-command')).toBeNull();
  });
});

// ── `get` single-field read ───────────────────────────────────────────────────

describe('ledger-cli — get single-field read', () => {
  it('get backlog 100 status prints just the status value', async () => {
    const r = await run(args('get', ['backlog', '100', 'status']));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toBe('spec_needed');
  });

  it('get backlog 100 (no field) behaves like show — returns the record', async () => {
    const r = await run(args('get', ['backlog', '100']));
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.result as { id: string }).id).toBe('100');
  });

  it('get task <id> status returns the task status scalar', async () => {
    const r = await run(args('get', ['task', '35', 'status']));
    expect(r.ok).toBe(true);
    if (r.ok) expect(typeof r.result).toBe('string');
  });

  it('record-not-found for a missing id', async () => {
    const r = await run(args('get', ['backlog', '99999', 'status']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('record-not-found');
  });

  it('field-not-found for a field absent on the record', async () => {
    const r = await run(args('get', ['backlog', '100', 'nonexistent_field']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('field-not-found');
  });

  it('bad-ledger for an unknown ledger name', async () => {
    const r = await run(args('get', ['nope', '100']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad-ledger');
  });

  it('is read-only — touches no ledger file', async () => {
    const before = statSync(join(dir, 'product-backlog.json')).mtimeMs;
    await run(args('get', ['backlog', '100', 'status']));
    expect(statSync(join(dir, 'product-backlog.json')).mtimeMs).toBe(before);
  });
});
