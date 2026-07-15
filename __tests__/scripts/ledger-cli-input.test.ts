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
import { TaskListSchema } from '@/lib/validation/task-list-schema';
import { BacklogSchema } from '@/lib/validation/backlog-schema';
import { readFileSync } from 'node:fs';

// ID-90.22 R1a: `detectSchema` (@/lib/ledger/detect-schema) is dropped here —
// R2 deletes that module and this suite tests parseArgs / readRecordInput /
// nextId, not the document-kind detector. `nextId` only needs a
// `{ kind, data }` KnownDetected value, so we build it directly from the
// canonical Zod schemas in `@/lib/validation/*` (the permanent source of truth,
// never vendored/deleted). Parsing through the real schema keeps full type
// fidelity and asserts the live ledger conforms — a structural assertion that
// no longer depends on the to-be-deleted lib/ledger detector.
// ID-148.12: `product-roadmap`/`RoadmapSchema` entry DROPPED — `nextId`'s
// `themes` collectionKey retired (TECH §3.2, INV-12(d); no initiatives
// analog, see `nextId`'s ledger-cli.ts doc comment).
const SCHEMA_BY_NAME = {
  'task-list': (raw: unknown) =>
    ({ kind: 'task-list', data: TaskListSchema.parse(raw) }) as const,
  'product-backlog': (raw: unknown) =>
    ({ kind: 'backlog', data: BacklogSchema.parse(raw) }) as const,
} satisfies Record<string, (raw: unknown) => { kind: string; data: unknown }>;

// ID-68.35: repointed from docs/reference/ live ledgers to synthetic fixtures.
const FIXTURE_DIR = resolve(__dirname, '../fixtures/ledger');

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
    // {35.29} changed the parser contract: --depends emits string[] always.
    // Post ID-102 (string-id flip) subtask.dependencies is itself string[], so
    // NO call site coerces to number[] any more — add-subtask, open-task and
    // create-backlog all keep the string[] verbatim (subtask.dependencies /
    // task.dependencies / item.dependencies are all string[]). This keeps
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
  function detected(name: 'task-list' | 'product-backlog') {
    // ID-68.35: reads from synthetic fixture dir instead of live docs/reference/.
    const text = readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8');
    return SCHEMA_BY_NAME[name](JSON.parse(text));
  }

  it('returns a string for backlog items (max+1)', () => {
    const d = detected('product-backlog');
    const id = nextId(d, 'items');
    expect(typeof id).toBe('string');
    // Derive expected from the fixture max (fixture ids: 1, 2, 100 → max+1 = 101).
    const raw = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'product-backlog.json'), 'utf8'),
    ) as { items: Array<{ id: string | number }> };
    const maxNum = Math.max(
      ...raw.items.map((i) => Number(String(i.id).replace(/[^0-9]/g, ''))),
    );
    expect(id).toBe(String(maxNum + 1));
  });

  // ID-148.12: "returns a string for roadmap themes (max+1)" REMOVED —
  // `nextId`'s `themes` collectionKey is retired (TECH §3.2, INV-12(d)).

  it('returns a digit-STRING for subtasks (max+1) scoped to a given task (ID-102)', () => {
    // ID-102: subtask ids are digit-strings, so nextId returns String(max+1).
    // Build a SYNTHETIC string-id fixture (not the live ledger) so this is a
    // clean post-flip contract canary: under the scratch-P1 string schema the
    // live (un-migrated, number-id) ledger would fail-loud at parse — the
    // contract under test is nextId's string return, not ledger conformance.
    const doc = {
      document_name: 'Knowledge Hub Task List',
      document_purpose:
        'Synthetic fixture for the ID-102 nextId string contract.',
      related_documents: [],
      tasks: [
        {
          id: '35',
          title: 'Task 35',
          description: 'Compact what+why.',
          status: 'pending',
          priority: 'should',
          dependencies: [],
          subtasks: [
            {
              id: '5',
              title: 'Subtask 5',
              description: 'Short.',
              details: '',
              status: 'pending',
              dependencies: [],
              testStrategy: null,
            },
          ],
          updatedAt: '2026-06-11T00:00:00.000Z',
          effort_estimate: null,
          owner: null,
          priority_note: null,
          status_note: null,
          cross_doc_links: [],
          session_refs: [],
          commit_refs: [],
        },
      ],
    };
    const d = SCHEMA_BY_NAME['task-list'](doc);
    const id = nextId(d, 'subtasks', '35');
    expect(typeof id).toBe('string');
    expect(id).toBe('6');
  });
});
