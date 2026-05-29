/**
 * task-list-discipline-warnings.test.ts — verifies the ID-34 field-length
 * discipline soft warnings emitted by `parseTaskListWithWarnings`.
 *
 * Per docs/specs/id-34-task-list-discipline/PRODUCT.md inv 8/10/11:
 *   - over-budget fields produce a non-fatal warning (never a schema reject);
 *   - the warning names the id, the field, and measured-vs-budget chars;
 *   - the existing 25-Subtask ceiling warning is unaffected;
 *   - no `.max()` is added — `TaskListSchema.parse()` still accepts the
 *     over-budget document.
 *
 * The discipline is SOFT: a live, over-budget ledger must keep parsing so the
 * vendored schema shape stays identical to task-view's source (vendor-drift
 * safe). See ID-34 TECH §3.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTaskListWithWarnings,
  TaskListSchema,
  FIELD_BUDGETS,
} from '@/lib/validation/task-list-schema';

const VALID_SUBTASK = {
  id: 1,
  title: 'Smoke subtask',
  description: 'Short one-sentence subtask summary.',
  details: 'Brief.',
  status: 'pending' as const,
  dependencies: [] as number[],
  testStrategy: 'One-line acceptance.',
};

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    title: 'Discipline smoke task',
    description: 'Compact what+why.',
    status: 'pending' as const,
    priority: 'should' as const,
    dependencies: [] as string[],
    subtasks: [{ ...VALID_SUBTASK }],
    updatedAt: '2026-05-26T00:00:00.000Z',
    effort_estimate: null,
    owner: null,
    priority_note: null,
    status_note: null,
    cross_doc_links: [],
    session_refs: [],
    commit_refs: [],
    ...overrides,
  };
}

function makeDoc(tasks: unknown[]) {
  return {
    document_name: 'Knowledge Hub Task List' as const,
    document_purpose: 'Test ledger.',
    related_documents: [],
    tasks,
  };
}

describe('parseTaskListWithWarnings — field-length discipline (ID-34 inv 8)', () => {
  it('emits no discipline warning when all fields are within budget', () => {
    const { warnings } = parseTaskListWithWarnings(makeDoc([makeTask()]));
    expect(warnings).toEqual([]);
  });

  it('warns (does not throw) on an over-budget Task.description', () => {
    const longDesc = 'x'.repeat(FIELD_BUDGETS.taskDescription + 1);
    const input = makeDoc([makeTask({ description: longDesc })]);

    // Hard parse still succeeds — no `.max()` was added.
    expect(() => TaskListSchema.parse(input)).not.toThrow();

    const { warnings } = parseTaskListWithWarnings(input);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].taskId).toBe('1');
    expect(warnings[0].message).toContain('description');
    expect(warnings[0].message).toContain(String(longDesc.length));
    expect(warnings[0].message).toContain('task-list-discipline.md');
  });

  it('warns on an over-budget Task.status_note', () => {
    const longNote = 'n'.repeat(FIELD_BUDGETS.taskStatusNote + 1);
    const { warnings } = parseTaskListWithWarnings(
      makeDoc([makeTask({ status_note: longNote })]),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('status_note');
  });

  it('does NOT warn on a null status_note', () => {
    const { warnings } = parseTaskListWithWarnings(
      makeDoc([makeTask({ status_note: null })]),
    );
    expect(warnings).toEqual([]);
  });

  it('warns on an over-budget Subtask.description with composite id', () => {
    const longSubDesc = 'd'.repeat(FIELD_BUDGETS.subtaskDescription + 1);
    const task = makeTask({
      subtasks: [{ ...VALID_SUBTASK, id: 3, description: longSubDesc }],
    });
    const { warnings } = parseTaskListWithWarnings(makeDoc([task]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('1.3');
    expect(warnings[0].message).toContain('description');
  });

  it('warns on an over-budget Subtask.testStrategy', () => {
    const longStrat = 's'.repeat(FIELD_BUDGETS.subtaskTestStrategy + 1);
    const task = makeTask({
      subtasks: [{ ...VALID_SUBTASK, testStrategy: longStrat }],
    });
    const { warnings } = parseTaskListWithWarnings(makeDoc([task]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('testStrategy');
  });

  it('does NOT warn on a long Subtask.details (journal is uncapped)', () => {
    const hugeDetails = 'j'.repeat(50_000);
    const task = makeTask({
      subtasks: [{ ...VALID_SUBTASK, details: hugeDetails }],
    });
    const { warnings } = parseTaskListWithWarnings(makeDoc([task]));
    expect(warnings).toEqual([]);
  });

  it('emits only field warnings for a >25-Subtask Task (ceiling warning removed S279)', () => {
    const subtasks = Array.from({ length: 26 }, (_, i) => ({
      ...VALID_SUBTASK,
      id: i + 1,
    }));
    const longDesc = 'x'.repeat(FIELD_BUDGETS.taskDescription + 1);
    const { warnings } = parseTaskListWithWarnings(
      makeDoc([makeTask({ subtasks, description: longDesc })]),
    );
    // The >25-Subtask ceiling warning was removed S279 (a Task may grow beyond
    // 25 Subtasks); only the description field-budget warning remains.
    expect(warnings).toHaveLength(1);
    expect(warnings.some((w) => w.message.includes('description'))).toBe(true);
    expect(warnings.some((w) => w.message.includes('subtasks'))).toBe(false);
  });
});
