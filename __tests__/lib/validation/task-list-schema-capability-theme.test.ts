/**
 * task-list-schema-capability-theme.test.ts — verifies TaskSchema.capability_theme
 * (PRODUCT inv 9 — convenience back-link to Roadmap theme).
 *
 * 4 cases per Subtask 30.7 brief:
 *   (a) `capability_theme: null` parses
 *   (b) `capability_theme: '1'` parses (bare-digit theme id)
 *   (c) field absent parses (optional)
 *   (d) `capability_theme: 123` fails (string-or-null required)
 *
 * Per TECH §3.1 (Subtask 30.6 / OQ-6 ratification). The authoritative direction
 * is `theme.linked_tasks[]`; `capability_theme` is a convenience back-link the
 * curator skill maintains in sync.
 */

import { describe, it, expect } from 'vitest';
import { TaskSchema } from '@/lib/validation/task-list-schema';

const VALID_SUBTASK = {
  id: 1,
  title: 'Smoke subtask',
  description:
    'Smoke subtask used to satisfy TaskSchema for capability_theme cases.',
  details: 'Brief.',
  status: 'pending',
  dependencies: [],
  testStrategy: 'n/a',
} as const;

const VALID_TASK_BASE = {
  id: '1',
  title: 'Capability-theme back-link smoke task',
  description: 'Exercises capability_theme field shape.',
  status: 'pending' as const,
  priority: 'must' as const,
  dependencies: [],
  subtasks: [VALID_SUBTASK],
  updatedAt: '2026-05-22T00:00:00.000Z',
  effort_estimate: null,
  owner: null,
  priority_note: null,
  status_note: null,
  cross_doc_links: [],
  session_refs: [],
  commit_refs: [],
};

describe('TaskSchema.capability_theme — PRODUCT inv 9 (Subtask 30.6 / OQ-6)', () => {
  // (a)
  it('accepts capability_theme: null', () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK_BASE,
      capability_theme: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capability_theme).toBeNull();
    }
  });

  // (b)
  it("accepts capability_theme: '1' (bare-digit theme id back-link)", () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK_BASE,
      capability_theme: '1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capability_theme).toBe('1');
    }
  });

  // (c)
  it('accepts a Task with capability_theme field absent entirely (optional)', () => {
    const result = TaskSchema.safeParse(VALID_TASK_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capability_theme).toBeUndefined();
    }
  });

  // (d)
  it('rejects capability_theme: 123 (string-or-null required, not number)', () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK_BASE,
      capability_theme: 123,
    });
    expect(result.success).toBe(false);
  });
});
