/**
 * ledger-cli-input.test.ts — input-layer unit tests for the ledger-CLI v2
 * plumbing (ID-35.15): value-flag parsing + reject-unknown-flags, the
 * `readRecordInput` precedence resolver (positional-JSON → --file/stdin →
 * named-flags), and the `nextId` max+1 auto-id helper.
 *
 * Per RESEARCH §2.2 (auto-id), §2.4 (input modes), §5.3 (reject-unknown-flags).
 * Pure plumbing — these tests exercise the exported helpers directly, NOT a
 * command's end-to-end behaviour (commands consume the plumbing in later
 * subtasks).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, readRecordInput, nextId } from '@/scripts/ledger-cli';
import { detectSchema } from '@/lib/ledger/detect-schema';
import { readFileSync } from 'node:fs';

const REPO = resolve(__dirname, '../..');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-input-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parseArgs — value-flags + reject-unknown (ID-35.15)', () => {
  it('consumes the next token for each known value-flag', () => {
    const r = parseArgs([
      'create-backlog',
      '--title',
      'A nice heading',
      '--description',
      'A short summary.',
      '--status',
      'parked',
      '--priority',
      'should',
      '--depends',
      '1,2',
      '--id',
      '200',
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.subcommand).toBe('create-backlog');
    expect(r.parsed.flags.title).toBe('A nice heading');
    expect(r.parsed.flags.description).toBe('A short summary.');
    expect(r.parsed.flags.status).toBe('parked');
    expect(r.parsed.flags.priority).toBe('should');
    expect(r.parsed.flags.depends).toBe('1,2');
    expect(r.parsed.flags.id).toBe('200');
  });

  it('still parses the boolean flags and --ledger-dir', () => {
    const r = parseArgs([
      'flip-task',
      '6',
      'done',
      '--dry-run',
      '--scoped',
      '--ledger-dir',
      '/tmp/x',
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.flags.dryRun).toBe(true);
    expect(r.parsed.flags.scoped).toBe(true);
    expect(r.parsed.flags.ledgerDir).toBe('/tmp/x');
    expect(r.parsed.positionals).toEqual(['6', 'done']);
    expect(r.parsed.subcommand).toBe('flip-task');
  });

  it('rejects an unknown flag (exit-worthy) and lists known flags', () => {
    const r = parseArgs(['create-backlog', '--titel', 'typo']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('--titel');
    // The error must surface the known-flag list so the operator can self-correct.
    expect(r.error).toContain('--title');
  });

  it('consumes the next token for --effort-estimate ({35.42})', () => {
    // {35.42} adds --effort-estimate as a named value-flag so a single
    // open-task can set TaskSchema.effort_estimate (a string) without a
    // follow-up `update-task <id> effort_estimate '…'`.
    const r = parseArgs([
      'open-task',
      '--title',
      'A task',
      '--effort-estimate',
      '1.5 PLAN units',
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.flags.effortEstimate).toBe('1.5 PLAN units');
  });
});

describe('readRecordInput — precedence + equivalence (ID-35.15)', () => {
  const record = {
    title: 'Equivalent heading',
    description: 'Same record three ways.',
    status: 'parked',
  };

  it('yields the record from positional JSON', () => {
    const p = parseArgs(['create-backlog', JSON.stringify(record)]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = readRecordInput(p.parsed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual(record);
  });

  it('yields the same record from --file', () => {
    const file = join(dir, 'rec.json');
    writeFileSync(file, JSON.stringify(record), 'utf8');
    const p = parseArgs(['create-backlog', '--file', file]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = readRecordInput(p.parsed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual(record);
  });

  it('yields an equivalent record from named flags', () => {
    const p = parseArgs([
      'create-backlog',
      '--title',
      record.title,
      '--description',
      record.description,
      '--status',
      record.status,
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = readRecordInput(p.parsed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Named-flags build an object with exactly the supplied fields.
    expect(r.value).toMatchObject(record);
  });

  it('parses --depends into a string[] in the named-flags object ({35.29})', () => {
    // {35.29} changed the parser contract: --depends emits string[] always;
    // the add-subtask call site coerces to number[] (subtask.dependencies is
    // number[]); open-task / create-backlog keep the string[] verbatim
    // (task.dependencies / item.dependencies are both string[]). This keeps
    // readRecordInput schema-agnostic — same pattern as {35.28} for --id.
    const p = parseArgs([
      'add-subtask',
      '--title',
      'Sub',
      '--depends',
      '1,2,3',
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = readRecordInput(p.parsed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.value as { dependencies: string[] }).dependencies).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('maps --effort-estimate to the snake_case effort_estimate field ({35.42})', () => {
    // The flag key is camelCase (effortEstimate) but the schema field is
    // snake_case (TaskSchema.effort_estimate) — readRecordInput bridges them.
    const p = parseArgs([
      'open-task',
      '--title',
      'A task',
      '--effort-estimate',
      '3 days',
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = readRecordInput(p.parsed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.value as { effort_estimate: string }).effort_estimate).toBe(
      '3 days',
    );
  });

  it('errors on a --file that does not exist', () => {
    const p = parseArgs(['create-backlog', '--file', join(dir, 'nope.json')]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = readRecordInput(p.parsed);
    expect(r.ok).toBe(false);
  });

  it('errors on no input at all (no positional, no --file, no flags)', () => {
    const p = parseArgs(['create-backlog']);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = readRecordInput(p.parsed);
    expect(r.ok).toBe(false);
  });
});

describe('nextId — max+1 with correct primitive type (ID-35.15)', () => {
  function detected(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
    const text = readFileSync(
      join(REPO, `docs/reference/${name}.json`),
      'utf8',
    );
    const d = detectSchema(JSON.parse(text));
    if (d.kind === 'unknown') throw new Error('unexpected unknown');
    return d;
  }

  it('returns a string for backlog items (max+1)', () => {
    const d = detected('product-backlog');
    const id = nextId(d, 'items');
    expect(typeof id).toBe('string');
    // live max id is 185 → next is "186"
    expect(id).toBe('186');
  });

  it('returns a string for roadmap themes (max+1)', () => {
    const d = detected('product-roadmap');
    const id = nextId(d, 'themes');
    expect(typeof id).toBe('string');
  });

  it('returns a number for subtasks (max+1) scoped to a given task', () => {
    const d = detected('task-list');
    // task "35" has 25 subtasks ids 1..25 after this wave; assert numeric type
    // and that it is one greater than the current max of the addressed task.
    if (d.kind !== 'task-list') throw new Error('expected task-list');
    const task = d.data.tasks.find((t) => t.id === '35');
    if (!task) throw new Error('task 35 missing');
    const maxSub = Math.max(...task.subtasks.map((s) => s.id));
    const id = nextId(d, 'subtasks', '35');
    expect(typeof id).toBe('number');
    expect(id).toBe(maxSub + 1);
  });
});
