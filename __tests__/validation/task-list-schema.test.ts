/**
 * task-list-schema.test.ts
 *
 * Unit tests for `lib/validation/task-list-schema.ts`.
 * Verifies PRODUCT.md invariants 4–16 + 19–22 + 25 against the schema.
 *
 * Tests are written against SPEC INVARIANTS, not implementation details.
 * ~12+ test cases covering: root shape, Task shape, Subtask shape,
 * sibling-only dep enforcement, status enum membership, priority enum,
 * optional-field nullability, KH-extension arrays.
 */

import { describe, it, expect } from 'vitest';
import {
  SubtaskSchema,
  TaskSchema,
  TaskListSchema,
  TaskListStatus,
  TaskPriority,
  parseTaskListWithWarnings,
} from '@/lib/validation/task-list-schema';

// ──────────────────────────────────────────────────────────────────────────────
// Minimal valid fixtures — build up from the spec
// ──────────────────────────────────────────────────────────────────────────────

const VALID_SUBTASK = {
  id: 1,
  title: 'Write the failing test',
  description: 'Create a test file that imports the new schema and fails.',
  details:
    'File: __tests__/validation/task-list-schema.test.ts\nVerify import works.',
  status: 'pending',
  dependencies: [],
  testStrategy: 'Run bun run test to see it fail.',
} as const;

const VALID_TASK = {
  id: '1',
  title: 'Task list schema + initial file',
  description: 'Create the Zod schema module for the new Task list surface.',
  status: 'pending',
  priority: 'must',
  dependencies: [],
  subtasks: [VALID_SUBTASK],
  updatedAt: '2026-05-18T00:00:00.000Z',
  effort_estimate: '~2-3h',
  owner: 'Engineering',
  priority_note: null,
  status_note: null,
  cross_doc_links: [],
  session_refs: ['kh-prod-readiness-S50'],
  commit_refs: [],
} as const;

const VALID_TASK_LIST = {
  document_name: 'Knowledge Hub Task List',
  document_purpose: 'Active structured work following TM JSON shape.',
  last_updated:
    'kh-prod-readiness-S50 W1 close-out — surface migration creation',
  related_documents: ['docs/reference/product-roadmap.json'],
  tasks: [],
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// TaskListSchema root shape (inv 4)
// ──────────────────────────────────────────────────────────────────────────────

describe('TaskListSchema root shape', () => {
  it('accepts a valid document with empty tasks array (inv 4, 19)', () => {
    const result = TaskListSchema.safeParse(VALID_TASK_LIST);
    expect(result.success).toBe(true);
  });

  it('rejects documents missing document_name (inv 4)', () => {
    const { document_name: _, ...withoutName } = VALID_TASK_LIST;
    const result = TaskListSchema.safeParse(withoutName);
    expect(result.success).toBe(false);
  });

  it('rejects documents with wrong document_name literal (inv 4)', () => {
    const result = TaskListSchema.safeParse({
      ...VALID_TASK_LIST,
      document_name: 'Wrong Name',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields at root level (strict mode)', () => {
    const result = TaskListSchema.safeParse({
      ...VALID_TASK_LIST,
      unexpectedField: 'should be rejected',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a document with populated tasks array', () => {
    const result = TaskListSchema.safeParse({
      ...VALID_TASK_LIST,
      tasks: [VALID_TASK],
    });
    expect(result.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// last_updated freshness-marker discipline (S64 W0a — anti-bloat enforcement)
// ──────────────────────────────────────────────────────────────────────────────

describe('TaskListSchema last_updated discipline', () => {
  it('accepts the canonical one-line marker shape', () => {
    const result = TaskListSchema.safeParse({
      ...VALID_TASK_LIST,
      last_updated:
        'kh-prod-readiness-S64 W0a close-out — schema cap + Zod regex added',
    });
    expect(result.success).toBe(true);
  });

  it('rejects values exceeding 200 chars (anti-bloat cap)', () => {
    const result = TaskListSchema.safeParse({
      ...VALID_TASK_LIST,
      last_updated:
        'kh-prod-readiness-S64 W0a close-out — ' + 'x'.repeat(200),
    });
    expect(result.success).toBe(false);
  });

  it('rejects multi-session-id append (diary-style concat)', () => {
    const result = TaskListSchema.safeParse({
      ...VALID_TASK_LIST,
      last_updated:
        'kh-prod-readiness-S64 W0a close-out — fix. Earlier: kh-prod-readiness-S63 WP6 — PRODUCT.md authored',
    });
    expect(result.success).toBe(false);
  });

  it('rejects multi-line values (newline embedded)', () => {
    const result = TaskListSchema.safeParse({
      ...VALID_TASK_LIST,
      last_updated:
        'kh-prod-readiness-S64 W0a close-out\nadditional narrative on second line',
    });
    expect(result.success).toBe(false);
  });

  it('rejects values without canonical kh-{track}-S{N} prefix', () => {
    const result = TaskListSchema.safeParse({
      ...VALID_TASK_LIST,
      last_updated: 'session 64 wave 0a close-out — added schema cap',
    });
    expect(result.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// TaskSchema shape (inv 5, 6, 7, 8)
// ──────────────────────────────────────────────────────────────────────────────

describe('TaskSchema shape', () => {
  it('accepts a valid Task with all required fields (inv 5)', () => {
    const result = TaskSchema.safeParse(VALID_TASK);
    expect(result.success).toBe(true);
  });

  it('accepts a Task with empty subtasks array (inv 5 — empty allowed)', () => {
    const result = TaskSchema.safeParse({ ...VALID_TASK, subtasks: [] });
    expect(result.success).toBe(true);
  });

  it('rejects a Task missing required id field (inv 5)', () => {
    const { id: _, ...withoutId } = VALID_TASK;
    expect(TaskSchema.safeParse(withoutId).success).toBe(false);
  });

  it('rejects parentId field — not a valid Task field (inv 8)', () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK,
      parentId: 'undefined',
    });
    expect(result.success).toBe(false);
  });

  it('rejects details at Task level — only on Subtasks (inv 7)', () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK,
      details: 'some details',
    });
    expect(result.success).toBe(false);
  });

  it('rejects testStrategy at Task level — only on Subtasks (inv 7)', () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK,
      testStrategy: 'some strategy',
    });
    expect(result.success).toBe(false);
  });

  it('accepts nullable KH-extension fields (inv 6)', () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK,
      effort_estimate: null,
      owner: null,
      priority_note: null,
      status_note: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a Task where KH-extension nullable field is absent — field must be present (N2)', () => {
    // The four KH-extension nullable fields are REQUIRED (not .optional()).
    // Explicit null is fine; absent is rejected. This verifies N2 fix.
    const { effort_estimate: _e, ...withoutEffort } = VALID_TASK;
    expect(
      TaskSchema.safeParse(withoutEffort).success,
      'effort_estimate absent should fail',
    ).toBe(false);

    const { owner: _o, ...withoutOwner } = VALID_TASK;
    expect(
      TaskSchema.safeParse(withoutOwner).success,
      'owner absent should fail',
    ).toBe(false);

    const { priority_note: _p, ...withoutPriorityNote } = VALID_TASK;
    expect(
      TaskSchema.safeParse(withoutPriorityNote).success,
      'priority_note absent should fail',
    ).toBe(false);

    const { status_note: _s, ...withoutStatusNote } = VALID_TASK;
    expect(
      TaskSchema.safeParse(withoutStatusNote).success,
      'status_note absent should fail',
    ).toBe(false);
  });

  it('accepts KH-extension array fields as empty arrays (inv 6)', () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK,
      cross_doc_links: [],
      session_refs: [],
      commit_refs: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts cross_doc_links with valid DocLink objects (inv 6)', () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK,
      cross_doc_links: [
        {
          path: 'specs/surface-migration/PLAN.md',
          anchor: '#task-1',
          raw: 'PLAN.md Task 1',
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SubtaskSchema shape (inv 9, 10, 11, 12)
// ──────────────────────────────────────────────────────────────────────────────

describe('SubtaskSchema shape', () => {
  it('accepts a valid Subtask (inv 9)', () => {
    expect(SubtaskSchema.safeParse(VALID_SUBTASK).success).toBe(true);
  });

  it('accepts a Subtask with null testStrategy (inv 9 — nullable)', () => {
    const result = SubtaskSchema.safeParse({
      ...VALID_SUBTASK,
      testStrategy: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a Subtask with optional updatedAt (inv 10)', () => {
    const result = SubtaskSchema.safeParse({
      ...VALID_SUBTASK,
      updatedAt: '2026-05-18T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a Subtask with nested subtasks field (inv 11 — no nesting)', () => {
    const result = SubtaskSchema.safeParse({
      ...VALID_SUBTASK,
      subtasks: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a Subtask with priority field (inv 12 — Task-level only)', () => {
    const result = SubtaskSchema.safeParse({
      ...VALID_SUBTASK,
      priority: 'must',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a Subtask with non-integer id (inv 9 — must be integer >= 1)', () => {
    expect(SubtaskSchema.safeParse({ ...VALID_SUBTASK, id: 0 }).success).toBe(
      false,
    );
    expect(SubtaskSchema.safeParse({ ...VALID_SUBTASK, id: 1.5 }).success).toBe(
      false,
    );
    expect(SubtaskSchema.safeParse({ ...VALID_SUBTASK, id: '1' }).success).toBe(
      false,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// TaskSchema — capability_theme field (Subtask 30.6 / TECH §3.1)
//
// Optional back-link to a Roadmap theme (OQ-6 ratification). Authoritative
// direction is theme.linked_tasks[]; capability_theme is convenience back-link.
// Absent = unaffiliated.
// ──────────────────────────────────────────────────────────────────────────────

describe('TaskSchema — capability_theme field (Subtask 30.6 / TECH §3.1)', () => {
  it('accepts capability_theme: null (default)', () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK,
      capability_theme: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capability_theme).toBeNull();
    }
  });

  it('accepts capability_theme as a string', () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK,
      capability_theme: 'roadmap-rethink',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capability_theme).toBe('roadmap-rethink');
    }
  });

  it('accepts capability_theme omitted entirely (optional field)', () => {
    const result = TaskSchema.safeParse(VALID_TASK);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capability_theme).toBeUndefined();
    }
  });

  it('rejects capability_theme as a non-string (e.g. number)', () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK,
      capability_theme: 42,
    });
    expect(result.success).toBe(false);
  });

  it('capability_theme round-trips for both null and string values', () => {
    const withNull = TaskSchema.safeParse({
      ...VALID_TASK,
      capability_theme: null,
    });
    expect(withNull.success).toBe(true);
    if (withNull.success) {
      const reparsed = TaskSchema.safeParse(withNull.data);
      expect(reparsed.success).toBe(true);
      if (reparsed.success) {
        expect(reparsed.data.capability_theme).toBeNull();
      }
    }

    const withTheme = TaskSchema.safeParse({
      ...VALID_TASK,
      capability_theme: 'developer-velocity',
    });
    expect(withTheme.success).toBe(true);
    if (withTheme.success) {
      const reparsed = TaskSchema.safeParse(withTheme.data);
      expect(reparsed.success).toBe(true);
      if (reparsed.success) {
        expect(reparsed.data.capability_theme).toBe('developer-velocity');
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Status enum membership (inv 21, 22)
// ──────────────────────────────────────────────────────────────────────────────

describe('TaskListStatus enum membership (inv 21, 22)', () => {
  const taskLevelValues = [
    'done',
    'pending',
    'in_progress',
    'blocked',
    'deferred',
    'cancelled',
    'spec_needed',
    'imp_deferred',
  ] as const;

  it('accepts all 8 Task-level status values', () => {
    for (const status of taskLevelValues) {
      const result = TaskSchema.safeParse({ ...VALID_TASK, status });
      expect(
        result.success,
        `expected status "${status}" to be valid at Task level`,
      ).toBe(true);
    }
  });

  it('rejects review status at Task level (TM value not adopted in KH — inv 22)', () => {
    const result = TaskSchema.safeParse({ ...VALID_TASK, status: 'review' });
    expect(result.success).toBe(false);
  });

  it('rejects hyphenated in-progress at Task level (canonical is underscore — inv 22)', () => {
    const result = TaskSchema.safeParse({
      ...VALID_TASK,
      status: 'in-progress',
    });
    expect(result.success).toBe(false);
  });

  it('rejects cancelled at Subtask level (Subtask subset excludes cancelled — inv 21)', () => {
    const result = SubtaskSchema.safeParse({
      ...VALID_SUBTASK,
      status: 'cancelled',
    });
    expect(result.success).toBe(false);
  });

  it('rejects spec_needed at Subtask level (Subtask subset excludes spec_needed — inv 21)', () => {
    const result = SubtaskSchema.safeParse({
      ...VALID_SUBTASK,
      status: 'spec_needed',
    });
    expect(result.success).toBe(false);
  });

  it('rejects imp_deferred at Subtask level (Subtask subset excludes imp_deferred — inv 21)', () => {
    const result = SubtaskSchema.safeParse({
      ...VALID_SUBTASK,
      status: 'imp_deferred',
    });
    expect(result.success).toBe(false);
  });

  it('accepts done, pending, in_progress, blocked, deferred at Subtask level', () => {
    const subtaskValues = [
      'done',
      'pending',
      'in_progress',
      'blocked',
      'deferred',
    ] as const;
    for (const status of subtaskValues) {
      const result = SubtaskSchema.safeParse({ ...VALID_SUBTASK, status });
      expect(
        result.success,
        `expected status "${status}" to be valid at Subtask level`,
      ).toBe(true);
    }
  });

  it('exports TaskListStatus with correct 8 values', () => {
    expect(TaskListStatus.options).toHaveLength(8);
    expect(TaskListStatus.options).toContain('cancelled');
    expect(TaskListStatus.options).not.toContain('review');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Priority enum membership (inv 25)
// ──────────────────────────────────────────────────────────────────────────────

describe('TaskPriority enum membership (inv 25)', () => {
  it('accepts must, should, could, future (MoSCoW values)', () => {
    for (const priority of ['must', 'should', 'could', 'future'] as const) {
      const result = TaskSchema.safeParse({ ...VALID_TASK, priority });
      expect(
        result.success,
        `expected priority "${priority}" to be valid`,
      ).toBe(true);
    }
  });

  it('accepts high, medium, low (ranked values)', () => {
    for (const priority of ['high', 'medium', 'low'] as const) {
      const result = TaskSchema.safeParse({ ...VALID_TASK, priority });
      expect(
        result.success,
        `expected priority "${priority}" to be valid`,
      ).toBe(true);
    }
  });

  it('accepts trigger priority value', () => {
    const result = TaskSchema.safeParse({ ...VALID_TASK, priority: 'trigger' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown priority values', () => {
    expect(
      TaskSchema.safeParse({ ...VALID_TASK, priority: 'critical' }).success,
    ).toBe(false);
    expect(
      TaskSchema.safeParse({ ...VALID_TASK, priority: 'normal' }).success,
    ).toBe(false);
  });

  it('exports TaskPriority with all 8 canonical priority values', () => {
    expect(TaskPriority.options).toHaveLength(8);
    expect(TaskPriority.options).toContain('must');
    expect(TaskPriority.options).toContain('trigger');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Sibling-only dependency enforcement (inv 14–16)
// ──────────────────────────────────────────────────────────────────────────────

describe('Sibling-only Subtask dependency enforcement (inv 14–16)', () => {
  it('accepts a Task where subtask deps reference valid sibling ids (positive case)', () => {
    const task = {
      ...VALID_TASK,
      subtasks: [
        { ...VALID_SUBTASK, id: 1, dependencies: [] },
        { ...VALID_SUBTASK, id: 2, dependencies: [1] },
        { ...VALID_SUBTASK, id: 3, dependencies: [1, 2] },
      ],
    };
    expect(TaskSchema.safeParse(task).success).toBe(true);
  });

  it('rejects a Task where a subtask references a non-existent sibling id (negative case — inv 14)', () => {
    const task = {
      ...VALID_TASK,
      subtasks: [
        { ...VALID_SUBTASK, id: 1, dependencies: [] },
        { ...VALID_SUBTASK, id: 2, dependencies: [99] }, // id 99 does not exist
      ],
    };
    const result = TaskSchema.safeParse(task);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Error message should name the offending subtask
      const messages = result.error.issues.map((i) => i.message).join('\n');
      expect(messages).toMatch(/2/); // offending subtask id
    }
  });

  it('rejects a Task where a subtask references an id from a different Task (cross-Task dep — inv 16)', () => {
    // Simulated cross-Task: Subtask dep points to an id that would belong to another Task
    // (Since sibling ids restart at 1, a cross-Task dep of e.g. 100 won't exist as a sibling)
    const task = {
      ...VALID_TASK,
      subtasks: [
        { ...VALID_SUBTASK, id: 1, dependencies: [] },
        { ...VALID_SUBTASK, id: 2, dependencies: [100] }, // 100 is not a sibling
      ],
    };
    expect(TaskSchema.safeParse(task).success).toBe(false);
  });

  it('accepts a Subtask with empty dependencies array (no deps case)', () => {
    const task = {
      ...VALID_TASK,
      subtasks: [{ ...VALID_SUBTASK, id: 1, dependencies: [] }],
    };
    expect(TaskSchema.safeParse(task).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// parseTaskListWithWarnings — PRODUCT inv 20 (25-Subtask soft ceiling)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a VALID_TASK_LIST fixture populated with `n` subtasks on Task id "1".
 * Each subtask gets a unique integer id and empty dependencies[].
 */
function buildTaskListWithSubtaskCount(n: number) {
  const subtasks = Array.from({ length: n }, (_, i) => ({
    ...VALID_SUBTASK,
    id: i + 1,
    dependencies: [],
  }));
  return {
    ...VALID_TASK_LIST,
    tasks: [{ ...VALID_TASK, subtasks }],
  };
}

describe('parseTaskListWithWarnings — PRODUCT inv 20', () => {
  it('returns no warnings when a Task has exactly 25 subtasks (at ceiling)', () => {
    const input = buildTaskListWithSubtaskCount(25);
    const { value, warnings } = parseTaskListWithWarnings(input);
    expect(warnings).toHaveLength(0);
    expect(value.tasks[0].subtasks).toHaveLength(25);
  });

  it('returns one warning per offending Task when a Task has 26 subtasks (over ceiling)', () => {
    const input = buildTaskListWithSubtaskCount(26);
    const { warnings } = parseTaskListWithWarnings(input);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].taskId).toBe('1');
    expect(warnings[0].message).toMatch(/26 subtasks/);
    expect(warnings[0].message).toMatch(/PRODUCT inv 20/);
  });

  it('returns one warning entry (not per excess subtask) when a Task has 30 subtasks', () => {
    const input = buildTaskListWithSubtaskCount(30);
    const { warnings } = parseTaskListWithWarnings(input);
    // One warning per Task, not one per subtask over the limit
    expect(warnings).toHaveLength(1);
    expect(warnings[0].taskId).toBe('1');
    expect(warnings[0].message).toMatch(/30 subtasks/);
  });

  it('throws ZodError on hard validation failure (not warnings)', () => {
    const invalid = { ...VALID_TASK_LIST, document_name: 'Wrong Name' };
    expect(() => parseTaskListWithWarnings(invalid)).toThrow();
  });

  it('parses the value correctly and returns it alongside warnings', () => {
    const input = buildTaskListWithSubtaskCount(26);
    const { value } = parseTaskListWithWarnings(input);
    expect(value.document_name).toBe('Knowledge Hub Task List');
    expect(value.tasks[0].subtasks).toHaveLength(26);
  });
});
