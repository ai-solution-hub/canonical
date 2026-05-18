/**
 * work-status.test.ts
 *
 * Unit tests for the shared work-status module (`lib/validation/work-status.ts`).
 * Tests verify spec invariants from PRODUCT.md §G (inv 21–22) and §H (inv 25).
 *
 * Each test verifies real behaviour against the spec — not implementation details.
 */

import { describe, it, expect } from 'vitest';
import {
  WorkStatus,
  RoadmapStatus,
  BacklogStatus,
  TaskListStatus,
  Priority,
} from '@/lib/validation/work-status';

describe('WorkStatus master enum', () => {
  it('contains all eleven canonical values', () => {
    const expected = [
      'done',
      'pending',
      'in_progress',
      'blocked',
      'deferred',
      'cancelled',
      'spec_needed',
      'imp_deferred',
      'needs_research',
      'parked',
      'ready',
    ];
    expect(WorkStatus.options).toEqual(expect.arrayContaining(expected));
    expect(WorkStatus.options).toHaveLength(11);
  });

  it('accepts every canonical value', () => {
    const values = [
      'done',
      'pending',
      'in_progress',
      'blocked',
      'deferred',
      'cancelled',
      'spec_needed',
      'imp_deferred',
      'needs_research',
      'parked',
      'ready',
    ] as const;
    for (const v of values) {
      expect(WorkStatus.safeParse(v).success).toBe(true);
    }
  });

  it('rejects hyphenated form (canonical is underscore only per inv 22)', () => {
    expect(WorkStatus.safeParse('in-progress').success).toBe(false);
  });

  it('rejects values not in the master enum', () => {
    expect(WorkStatus.safeParse('review').success).toBe(false);
    expect(WorkStatus.safeParse('unknown').success).toBe(false);
  });
});

describe('RoadmapStatus subset', () => {
  const expectedValues = [
    'pending',
    'blocked',
    'spec_needed',
    'deferred',
    'imp_deferred',
    'needs_research',
  ];
  const excludedValues = [
    'done',
    'in_progress',
    'cancelled',
    'parked',
    'ready',
  ];

  it('contains exactly the forward-looking thematic values', () => {
    expect(RoadmapStatus.options).toEqual(
      expect.arrayContaining(expectedValues),
    );
    expect(RoadmapStatus.options).toHaveLength(expectedValues.length);
  });

  it('accepts each Roadmap-valid value', () => {
    for (const v of expectedValues) {
      expect(
        RoadmapStatus.safeParse(v).success,
        `expected ${v} to be valid`,
      ).toBe(true);
    }
  });

  it('rejects values excluded from the Roadmap subset', () => {
    for (const v of excludedValues) {
      expect(
        RoadmapStatus.safeParse(v).success,
        `expected ${v} to be rejected`,
      ).toBe(false);
    }
  });
});

describe('BacklogStatus subset', () => {
  // Pre-work subset: spec_needed | needs_research | parked | ready | blocked
  const expectedValues = [
    'spec_needed',
    'needs_research',
    'parked',
    'ready',
    'blocked',
  ];
  const excludedValues = [
    'pending',
    'done',
    'in_progress',
    'cancelled',
    'deferred',
    'imp_deferred',
  ];

  it('contains exactly the pre-work values (5 values)', () => {
    expect(BacklogStatus.options).toEqual(
      expect.arrayContaining(expectedValues),
    );
    expect(BacklogStatus.options).toHaveLength(5);
  });

  it('accepts each Backlog-valid value', () => {
    for (const v of expectedValues) {
      expect(
        BacklogStatus.safeParse(v).success,
        `expected ${v} to be valid`,
      ).toBe(true);
    }
  });

  it('rejects values excluded from the Backlog subset', () => {
    for (const v of excludedValues) {
      expect(
        BacklogStatus.safeParse(v).success,
        `expected ${v} to be rejected`,
      ).toBe(false);
    }
  });

  it('rejects legacy needs_spec form (canonical is spec_needed per inv 22)', () => {
    expect(BacklogStatus.safeParse('needs_spec').success).toBe(false);
  });
});

describe('TaskListStatus subset', () => {
  // In-work (Task level): done | pending | in_progress | blocked | deferred |
  // cancelled | spec_needed | imp_deferred
  const expectedValues = [
    'done',
    'pending',
    'in_progress',
    'blocked',
    'deferred',
    'cancelled',
    'spec_needed',
    'imp_deferred',
  ];
  const excludedValues = ['needs_research', 'parked', 'ready'];

  it('contains exactly the in-work Task-level values (8 values)', () => {
    expect(TaskListStatus.options).toEqual(
      expect.arrayContaining(expectedValues),
    );
    expect(TaskListStatus.options).toHaveLength(8);
  });

  it('accepts each Task-level value', () => {
    for (const v of expectedValues) {
      expect(
        TaskListStatus.safeParse(v).success,
        `expected ${v} to be valid`,
      ).toBe(true);
    }
  });

  it('rejects values excluded from the Task list subset', () => {
    for (const v of excludedValues) {
      expect(
        TaskListStatus.safeParse(v).success,
        `expected ${v} to be rejected`,
      ).toBe(false);
    }
  });

  it('rejects TM review status (not adopted in KH per inv 22)', () => {
    expect(TaskListStatus.safeParse('review').success).toBe(false);
  });
});

describe('Priority master enum', () => {
  const allValues = [
    'must',
    'should',
    'could',
    'future',
    'high',
    'medium',
    'low',
    'trigger',
  ];

  it('contains all eight canonical priority values', () => {
    expect(Priority.options).toEqual(expect.arrayContaining(allValues));
    expect(Priority.options).toHaveLength(8);
  });

  it('accepts each canonical priority value', () => {
    for (const v of allValues) {
      expect(Priority.safeParse(v).success, `expected ${v} to be valid`).toBe(
        true,
      );
    }
  });

  it('rejects unknown priority values', () => {
    expect(Priority.safeParse('critical').success).toBe(false);
    expect(Priority.safeParse('normal').success).toBe(false);
  });
});
