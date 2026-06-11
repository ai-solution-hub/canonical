/**
 * ledger-cli-expected-shape.test.ts — RC-2 better-errors companion (ID-102.5 P9,
 * TECH §P9, PRODUCT inv 16, decision D3).
 *
 * Proves the `describeExpectedShape(zodError)` helper maps zod@4.4.3 issue codes
 * to human-readable expected-shape lines, and that EVERY `schema-error` /
 * `ledger-schema-invalid` emission envelope carries the additive `expected`
 * field alongside the untouched raw `issues` array.
 *
 * Per test-philosophy.md: the integration tests exercise the CLI (`run()`)
 * against a temp dir of real ledgers — not the implementation. The unit test
 * drives the pure helper against a synthetic ZodError so the post-flag-day
 * digit-string surface (string id regex failure → `string of digits`) is proven
 * WITHOUT waiting for ID-102's flag-day to flip ids to strings.
 *
 * This closes the S334 datapoint: `flip-subtask 90.26 in-progress` (hyphen
 * instead of underscore) returned a raw Zod issues array with no hint of the
 * accepted enum values.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z, ZodError } from 'zod';
import {
  run,
  describeExpectedShape,
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
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-es-'));
  copyFileSync(REAL.task, join(dir, 'task-list.json'));
  copyFileSync(REAL.roadmap, join(dir, 'product-roadmap.json'));
  copyFileSync(REAL.backlog, join(dir, 'product-backlog.json'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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

function readTask() {
  return JSON.parse(readFileSync(join(dir, 'task-list.json'), 'utf8'));
}

function firstTaskWithSubtask(): { taskId: string; subId: string | number } {
  const tl = readTask();
  for (const t of tl.tasks) {
    if (Array.isArray(t.subtasks) && t.subtasks.length > 0) {
      return { taskId: t.id, subId: t.subtasks[0].id };
    }
  }
  throw new Error('no task with a subtask in fixture');
}

// ── unit: describeExpectedShape (the pure helper) ─────────────────────────────

describe('describeExpectedShape — zod@4.4.3 issue → expected-shape lines', () => {
  it('maps an enum-mismatch (invalid_value) issue to the accepted options', () => {
    const Status = z.enum([
      'done',
      'pending',
      'in_progress',
      'blocked',
      'deferred',
      'cancelled',
    ]);
    const r = Status.safeParse('in-progress');
    expect(r.success).toBe(false);
    if (r.success) return;
    const lines = describeExpectedShape(r.error);
    // Derived from the ZodError's `values`, NOT hardcoded per-command.
    expect(lines).toContain(
      'done | pending | in_progress | blocked | deferred | cancelled',
    );
  });

  it('maps a wrong-type (invalid_type) issue to the expected type label', () => {
    const schema = z.object({ id: z.number().int() });
    const r = schema.safeParse({ id: 'abc' });
    expect(r.success).toBe(false);
    if (r.success) return;
    const lines = describeExpectedShape(r.error);
    // The path is echoed so a multi-field record points at the offending field.
    expect(lines.some((l) => l.includes('id') && l.includes('number'))).toBe(
      true,
    );
  });

  it('maps a digit-string regex failure to "string of digits" (post-flag-day surface)', () => {
    // This is the ID-102 post-flag-day shape: ids become digit-strings. Proving
    // it here means the helper keeps working unchanged when the flag-day flips.
    const IdStr = z.string().regex(/^\d+$/);
    const r = IdStr.safeParse('90.26');
    expect(r.success).toBe(false);
    if (r.success) return;
    const lines = describeExpectedShape(r.error);
    expect(lines).toContain('string of digits');
  });

  it('returns one line per issue for a multi-issue ZodError', () => {
    const schema = z.object({
      a: z.number(),
      b: z.enum(['x', 'y']),
    });
    const r = schema.safeParse({ a: 'nope', b: 'z' });
    expect(r.success).toBe(false);
    if (r.success) return;
    const lines = describeExpectedShape(r.error);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('does not throw on an empty/synthetic ZodError', () => {
    const empty = new ZodError([]);
    expect(() => describeExpectedShape(empty)).not.toThrow();
    expect(describeExpectedShape(empty)).toEqual([]);
  });
});

// ── integration: schema-error envelope enrichment (via run()) ─────────────────

describe('schema-error envelope carries additive `expected` (CLI integration)', () => {
  it('flip-subtask <id> in-progress (invalid enum value) → expected lists accepted statuses, issues preserved', async () => {
    const { taskId, subId } = firstTaskWithSubtask();
    // 'in-progress' (hyphen) is not a valid SubtaskStatus member — the S334 case.
    const r = await run(
      args('flip-subtask', [`${taskId}.${subId}`, 'in-progress']),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('schema-error');
    // ADDITIVE: the accepted enum values are echoed. The line is path-qualified
    // (e.g. `tasks.0.subtasks.0.status: …`) so a multi-field record points at
    // the offending field — assert the accepted-values segment is present.
    expect(r.expected).toBeDefined();
    expect(
      r.expected!.some((l) =>
        l.includes(
          'done | pending | in_progress | blocked | deferred | cancelled',
        ),
      ),
    ).toBe(true);
    // NON-DESTRUCTIVE: the raw issues array is still present and unaltered.
    expect(Array.isArray(r.issues)).toBe(true);
    expect(r.issues!.length).toBeGreaterThan(0);
  });

  it('a constraint-violating subtask field (empty title via update-subtask) → expected names the constraint, issues preserved', async () => {
    const { taskId, subId } = firstTaskWithSubtask();
    // `title` is `z.string().min(1)`; an empty value trips the schema with a
    // `too_small` issue, exercising the non-enum branch of the helper (the
    // expected-shape line names the min-length constraint, path-qualified).
    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'title', '']),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('schema-error');
    // ADDITIVE: a non-empty expected-shape line accompanies the raw issues.
    expect(r.expected).toBeDefined();
    expect(Array.isArray(r.expected)).toBe(true);
    expect(r.expected!.length).toBeGreaterThan(0);
    // NON-DESTRUCTIVE: the raw issues array is still present.
    expect(Array.isArray(r.issues)).toBe(true);
  });
});
