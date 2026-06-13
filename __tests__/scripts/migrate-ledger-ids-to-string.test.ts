/**
 * migrate-ledger-ids-to-string.test.ts — ID-102.8 P6 one-shot migration.
 *
 * The flag-day migration converts every stored subtask `id` (number → digit
 * string) and every subtask `dependencies[]` entry (number → digit string) in
 * `task-list.json`, in place, preserving value and gaps (PRODUCT inv 2, 10, 11;
 * TECH §P6). These tests verify REAL behaviour (test-philosophy.md): the
 * exported transform over synthetic fixtures, idempotency, gap-preservation,
 * and that the string-only TaskListSchema rejects a pre-migration number-shape
 * fixture (inv 11/15 — no general tolerant read path).
 */

import { describe, it, expect } from 'vitest';
import {
  migrateTaskListIds,
  serialiseLedger,
} from '@/scripts/migrate-ledger-ids-to-string';
import { TaskListSchema } from '@/lib/validation/task-list-schema';

/** A pre-migration (number-id) subtask. */
function numSubtask(id: number, dependencies: number[] = []) {
  return {
    id,
    title: `Subtask ${id}`,
    description: 'A short one-sentence summary.',
    details: '',
    status: 'pending',
    dependencies,
    testStrategy: null,
  };
}

function task(id: string, subtasks: unknown[]) {
  return {
    id,
    title: `Task ${id}`,
    description: 'Compact what+why.',
    status: 'pending',
    priority: 'should',
    dependencies: [],
    subtasks,
    updatedAt: '2026-06-11T00:00:00.000Z',
    effort_estimate: null,
    owner: null,
    priority_note: null,
    status_note: null,
    cross_doc_links: [],
    session_refs: [],
    commit_refs: [],
  };
}

function doc(tasks: unknown[]) {
  return {
    document_name: 'Knowledge Hub Task List',
    document_purpose: 'Synthetic fixture for ID-102.8 P6 migration.',
    related_documents: [],
    tasks,
  };
}

describe('migrateTaskListIds — number → digit-string, gaps preserved (inv 2/10)', () => {
  it('converts a gap fixture [1,2,5] → ["1","2","5"] (gap preserved, not resequenced)', () => {
    const input = doc([
      task('70', [numSubtask(1), numSubtask(2), numSubtask(5)]),
    ]);
    const out = migrateTaskListIds(input) as ReturnType<typeof doc> & {
      tasks: { subtasks: { id: unknown }[] }[];
    };
    const ids = out.tasks[0].subtasks.map((s) => s.id);
    expect(ids).toEqual(['1', '2', '5']);
    ids.forEach((id) => expect(typeof id).toBe('string'));
  });

  it('converts number dependencies[] entries to digit strings', () => {
    const input = doc([
      task('71', [numSubtask(1), numSubtask(2, [1]), numSubtask(3, [1, 2])]),
    ]);
    const out = migrateTaskListIds(input) as {
      tasks: { subtasks: { dependencies: unknown[] }[] }[];
    };
    expect(out.tasks[0].subtasks[1].dependencies).toEqual(['1']);
    expect(out.tasks[0].subtasks[2].dependencies).toEqual(['1', '2']);
  });

  it('is idempotent: a second run over already-string ids is a no-op (inv 10)', () => {
    const input = doc([task('72', [numSubtask(2), numSubtask(10)])]);
    const once = migrateTaskListIds(input);
    const twice = migrateTaskListIds(once);
    expect(serialiseLedger(twice)).toBe(serialiseLedger(once));
  });

  it('migrated output validates against the string-only TaskListSchema', () => {
    const input = doc([task('73', [numSubtask(1, []), numSubtask(2, [1])])]);
    const out = migrateTaskListIds(input);
    expect(TaskListSchema.safeParse(out).success).toBe(true);
  });
});

describe('fail-loud pre-migration contract (inv 11/15)', () => {
  it('the string-only TaskListSchema REJECTS a pre-migration number-id fixture', () => {
    const preMigration = doc([task('74', [numSubtask(1), numSubtask(2)])]);
    // Proves there is no general tolerant read path: the schema does not coerce.
    expect(TaskListSchema.safeParse(preMigration).success).toBe(false);
  });
});

describe('serialiseLedger — canonical byte-shape (inv 12)', () => {
  it('2-space indent, ASCII-escaped non-ASCII, single trailing newline', () => {
    const input = doc([task('75', [])]);
    // Inject a non-ASCII char to assert escaping.
    (input as { document_purpose: string }).document_purpose = 'em—dash';
    const text = serialiseLedger(input);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('em\\u2014dash');
    expect(text).toContain('\n  "document_name"');
  });

  it('a no-op JSON.parse round-trip through serialiseLedger is byte-identical', () => {
    const original = serialiseLedger(doc([task('76', [])]));
    const roundTrip = serialiseLedger(JSON.parse(original));
    expect(roundTrip).toBe(original);
  });
});
