/**
 * ledger-budgets.test.ts — verifies the unified ledger budget registry
 * ({35.13}) and the budget warnings emitted by the parse-with-warnings
 * helpers (task-list / backlog).
 *
 * ID-148.12: the `theme` entry + all roadmap-specific coverage RETIRED
 * (TECH §3.2/§3.4, INV-12(d)) — the roadmap server arm is repurposed to
 * initiatives, which is not part of this KH-native `LEDGER_BUDGETS` registry
 * (`lib/validation/initiatives-schema.ts`'s own `INITIATIVES_BUDGETS` covers
 * that soft-warning surface; see its header for the two-registry split).
 *
 * Per ledger-cli-v2 RESEARCH §4.1 + §2.3 / §7:
 *   - a SINGLE registry maps (recordKind → field → char budget) covering the
 *     task-list and backlog ledgers;
 *   - the registry seeds the existing task-list numbers (taskDescription 1500,
 *     taskStatusNote 300, subtaskDescription 250, subtaskTestStrategy 300);
 *   - it adds a backlog (description) entry;
 *   - `subtask.details` is NOT budgeted (append-only journal);
 *   - the registry is plain DATA, never a Zod `.max()` (so the live ledger
 *     keeps parsing and the vendored schema shape is unchanged — vendor-drift
 *     safe);
 *   - the existing `FIELD_BUDGETS` named import keeps working (re-exported
 *     from / supersetted by the registry);
 *   - each parse-with-warnings helper emits a budget warning for an
 *     over-budget field of its own kind.
 */

import { describe, it, expect } from 'vitest';
import { LEDGER_BUDGETS, FIELD_BUDGETS } from '@/lib/validation/ledger-budgets';
import { parseTaskListWithWarnings } from '@/lib/validation/task-list-schema';
import { parseBacklogWithWarnings } from '@/lib/validation/backlog-schema';

// ──────────────────────────────────────────────────────────────────────────
// Fixtures (mirror the live ledger shapes)
// ──────────────────────────────────────────────────────────────────────────

const VALID_SUBTASK = {
  id: '1',
  title: 'Smoke subtask',
  description: 'Short one-sentence subtask summary.',
  details: 'Brief.',
  status: 'pending' as const,
  dependencies: [] as string[],
  testStrategy: 'One-line acceptance.',
};

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    title: 'Budget smoke task',
    description: 'Compact what+why.',
    status: 'pending' as const,
    priority: 'should' as const,
    dependencies: [] as string[],
    subtasks: [{ ...VALID_SUBTASK }],
    updatedAt: '2026-05-27T00:00:00.000Z',
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

function makeTaskDoc(tasks: unknown[]) {
  return {
    document_name: 'Knowledge Hub Task List' as const,
    document_purpose: 'Test ledger.',
    related_documents: [],
    tasks,
  };
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: '28',
    description: 'A concise one-sentence backlog summary.',
    type: 'feature' as const,
    status: 'spec_needed' as const,
    effort_estimate: null,
    priority: 'medium' as const,
    track: 'budget-test',
    dependencies: [],
    session_refs: [],
    commit_refs: [],
    cross_doc_links: [],
    notes: null,
    ...overrides,
  };
}

function makeBacklogDoc(items: unknown[]) {
  return {
    document_name: 'Knowledge Hub Backlog',
    document_purpose: 'Test backlog.',
    related_documents: [],
    items,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Registry shape — all three ledgers' budgets exposed
// ──────────────────────────────────────────────────────────────────────────

describe('LEDGER_BUDGETS — unified 3-ledger registry (RESEARCH §4.1)', () => {
  it('exposes the task-list (task) budgets seeded from FIELD_BUDGETS', () => {
    expect(LEDGER_BUDGETS.task.description).toBe(1500);
    expect(LEDGER_BUDGETS.task.status_note).toBe(300);
  });

  it('exposes the task-list (subtask) budgets', () => {
    expect(LEDGER_BUDGETS.subtask.description).toBe(250);
    expect(LEDGER_BUDGETS.subtask.testStrategy).toBe(300);
  });

  it('exposes backlog (item) budget for description', () => {
    // Pin the EXACT value ({35.24}): the one-sentence summary soft budget is 500.
    expect(LEDGER_BUDGETS.item.description).toBe(500);
  });

  it('does NOT budget subtask.details (append-only journal)', () => {
    expect(
      (LEDGER_BUDGETS.subtask as Record<string, number>).details,
    ).toBeUndefined();
  });

  it('re-exports a back-compatible FIELD_BUDGETS for existing consumers', () => {
    expect(FIELD_BUDGETS.taskDescription).toBe(1500);
    expect(FIELD_BUDGETS.taskStatusNote).toBe(300);
    expect(FIELD_BUDGETS.subtaskDescription).toBe(250);
    expect(FIELD_BUDGETS.subtaskTestStrategy).toBe(300);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// parse-with-warnings helpers emit budget warnings per ledger kind
// ──────────────────────────────────────────────────────────────────────────

describe('budget warnings sourced from the registry', () => {
  it('task-list helper warns on an over-budget subtask description', () => {
    const long = 'd'.repeat(LEDGER_BUDGETS.subtask.description + 1);
    const task = makeTask({
      subtasks: [{ ...VALID_SUBTASK, description: long }],
    });
    const { warnings } = parseTaskListWithWarnings(makeTaskDoc([task]));
    expect(warnings.some((w) => w.message.includes('description'))).toBe(true);
  });

  it('backlog helper warns on an over-budget item description', () => {
    const long = 'b'.repeat(LEDGER_BUDGETS.item.description + 1);
    const { warnings } = parseBacklogWithWarnings(
      makeBacklogDoc([makeItem({ description: long })]),
    );
    expect(warnings.some((w) => w.message.includes('description'))).toBe(true);
    expect(warnings.some((w) => w.message.includes(String(long.length)))).toBe(
      true,
    );
  });

  it('backlog helper returns no warnings for an in-budget item', () => {
    const { warnings } = parseBacklogWithWarnings(makeBacklogDoc([makeItem()]));
    expect(warnings).toHaveLength(0);
  });
});
