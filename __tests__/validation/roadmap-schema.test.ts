/**
 * roadmap-schema.test.ts
 *
 * Unit tests for `lib/validation/roadmap-schema.ts`.
 *
 * ID-15.7 (S59): RoadmapPriority is now a re-export of the shared Priority
 * master enum from work-status.ts (TECH §B.3). Tests verify B-INV-4:
 *   - RoadmapPriority is the same Zod enum instance as Priority.
 *   - Accepted values are identical.
 *   - The inline z.enum([...]) is gone — no independent copy.
 *
 * Subtask 30.6 (TECH §3.1): RoadmapThemeSchema added, RoadmapSchema root
 * reshaped to union root via .superRefine() (exactly one of sections[] OR
 * themes[]). T-OQ-4 ratification: stay with superRefine over
 * discriminatedUnion to avoid discriminator-field content churn.
 *
 * Test coverage:
 *   - B-INV-4: RoadmapPriority === Priority (same Zod instance, not a copy)
 *   - All 8 priority values accepted by RoadmapPriority
 *   - Unknown priority value rejected by RoadmapPriority
 *   - RoadmapPriority and Priority produce identical parse results for all values
 *   - RoadmapThemeSchema 10-field shape with strict()
 *   - RoadmapSchema root accepts sections-only document
 *   - RoadmapSchema root accepts themes-only document
 *   - RoadmapSchema root rejects when BOTH sections[] and themes[] present
 *   - RoadmapSchema root rejects when NEITHER sections[] nor themes[] present
 */

import { describe, it, expect } from 'vitest';
import {
  RoadmapPriority,
  RoadmapSchema,
  RoadmapThemeSchema,
} from '@/lib/validation/roadmap-schema';
import { Priority } from '@/lib/validation/work-status';

// ──────────────────────────────────────────────────────────────────────────────
// B-INV-4 — RoadmapPriority is the shared Priority master enum (not a copy)
// ──────────────────────────────────────────────────────────────────────────────

describe('RoadmapPriority — B-INV-4 (TECH §B.3): same Zod enum instance as Priority', () => {
  it('RoadmapPriority === Priority (strict reference equality — not a copy)', () => {
    // Per TECH §B.3: `export const RoadmapPriority = Priority;`
    // This is a strict reference assignment, not a duplicate z.enum([...]).
    // If this test fails, the standalone z.enum([...]) was re-introduced.
    expect(RoadmapPriority).toBe(Priority);
  });

  it('RoadmapPriority.options matches Priority.options exactly', () => {
    expect(RoadmapPriority.options).toEqual(Priority.options);
  });

  it('RoadmapPriority.options has exactly 8 values (MoSCoW + Ranked + Trigger)', () => {
    expect(RoadmapPriority.options).toHaveLength(8);
  });

  it('accepts all 8 canonical priority values', () => {
    const values = [
      'must',
      'should',
      'could',
      'future',
      'high',
      'medium',
      'low',
      'trigger',
    ] as const;
    for (const value of values) {
      expect(
        RoadmapPriority.safeParse(value).success,
        `expected "${value}" to be accepted by RoadmapPriority`,
      ).toBe(true);
    }
  });

  it('rejects unknown priority value', () => {
    expect(RoadmapPriority.safeParse('critical').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(RoadmapPriority.safeParse('').success).toBe(false);
  });

  it('parse results are identical between RoadmapPriority and Priority for each value', () => {
    for (const value of Priority.options) {
      const roadmapResult = RoadmapPriority.safeParse(value);
      const priorityResult = Priority.safeParse(value);
      expect(roadmapResult.success).toBe(true);
      expect(priorityResult.success).toBe(true);
      if (roadmapResult.success && priorityResult.success) {
        expect(roadmapResult.data).toBe(priorityResult.data);
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// RoadmapThemeSchema (Subtask 30.6 / TECH §3.1) — 10-field Phase-B theme shape
// ──────────────────────────────────────────────────────────────────────────────

const VALID_THEME = {
  id: '1',
  title: 'Roadmap Rethink',
  description: 'Consolidate planning surface around Linear-style themes.',
  time_horizon: 'now' as const,
  status: 'in_progress' as const,
  linked_tasks: ['30', '31'],
  linked_backlog: [],
  session_refs: ['kh-prod-readiness-S66'],
  commit_refs: [],
  cross_doc_links: [],
  notes: null,
};

describe('RoadmapThemeSchema — 10-field Phase-B theme shape', () => {
  it('accepts a valid theme with all fields populated', () => {
    const result = RoadmapThemeSchema.safeParse(VALID_THEME);
    expect(result.success).toBe(true);
  });

  it('accepts a theme with empty arrays for linked_tasks/linked_backlog/session_refs/commit_refs/cross_doc_links', () => {
    const result = RoadmapThemeSchema.safeParse({
      ...VALID_THEME,
      linked_tasks: [],
      linked_backlog: [],
      session_refs: [],
      commit_refs: [],
      cross_doc_links: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts notes: null and notes: string', () => {
    expect(
      RoadmapThemeSchema.safeParse({ ...VALID_THEME, notes: null }).success,
    ).toBe(true);
    expect(
      RoadmapThemeSchema.safeParse({
        ...VALID_THEME,
        notes: 'OQ-6 ratification context.',
      }).success,
    ).toBe(true);
  });

  it('accepts each of the 3 time_horizon enum values: now | next | later', () => {
    for (const horizon of ['now', 'next', 'later'] as const) {
      const result = RoadmapThemeSchema.safeParse({
        ...VALID_THEME,
        time_horizon: horizon,
      });
      expect(
        result.success,
        `expected time_horizon "${horizon}" to be accepted`,
      ).toBe(true);
    }
  });

  it('rejects unknown time_horizon values', () => {
    const result = RoadmapThemeSchema.safeParse({
      ...VALID_THEME,
      time_horizon: 'someday',
    });
    expect(result.success).toBe(false);
  });

  it('accepts each of the 3 status enum values: pending | in_progress | done', () => {
    for (const status of ['pending', 'in_progress', 'done'] as const) {
      const result = RoadmapThemeSchema.safeParse({
        ...VALID_THEME,
        status,
      });
      expect(result.success, `expected status "${status}" to be accepted`).toBe(
        true,
      );
    }
  });

  it('rejects unknown status values (e.g. blocked or deferred)', () => {
    expect(
      RoadmapThemeSchema.safeParse({ ...VALID_THEME, status: 'blocked' })
        .success,
    ).toBe(false);
    expect(
      RoadmapThemeSchema.safeParse({ ...VALID_THEME, status: 'deferred' })
        .success,
    ).toBe(false);
  });

  it('rejects theme id that is not a bare-digit string (BARE_ID_REGEX)', () => {
    expect(
      RoadmapThemeSchema.safeParse({ ...VALID_THEME, id: 'T-1' }).success,
    ).toBe(false);
    expect(
      RoadmapThemeSchema.safeParse({ ...VALID_THEME, id: 'theme-1' }).success,
    ).toBe(false);
    expect(
      RoadmapThemeSchema.safeParse({ ...VALID_THEME, id: '1.1' }).success,
    ).toBe(false);
  });

  it('accepts theme id as multi-digit bare-digit string', () => {
    expect(
      RoadmapThemeSchema.safeParse({ ...VALID_THEME, id: '42' }).success,
    ).toBe(true);
  });

  it('rejects unknown fields (.strict() shape)', () => {
    const result = RoadmapThemeSchema.safeParse({
      ...VALID_THEME,
      unexpectedField: 'should be rejected',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when required field is missing (title)', () => {
    const { title: _t, ...withoutTitle } = VALID_THEME;
    expect(RoadmapThemeSchema.safeParse(withoutTitle).success).toBe(false);
  });

  it('rejects when required field is missing (linked_tasks array)', () => {
    const { linked_tasks: _lt, ...withoutLinked } = VALID_THEME;
    expect(RoadmapThemeSchema.safeParse(withoutLinked).success).toBe(false);
  });

  it('rejects cross_doc_links entry with missing required path field', () => {
    const result = RoadmapThemeSchema.safeParse({
      ...VALID_THEME,
      cross_doc_links: [{ anchor: '§3.1', raw: 'TECH §3.1' }],
    });
    expect(result.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// RoadmapSchema — union root via .superRefine() (Subtask 30.6 / TECH §3.1)
//
// Exactly one of sections[] OR themes[] must be present at the root. Both
// fields are optional at the schema level; superRefine enforces the exactly-
// one-of constraint. Per T-OQ-4 ratification, we use superRefine (not
// discriminatedUnion) to avoid discriminator-field content churn.
// ──────────────────────────────────────────────────────────────────────────────

const VALID_ROADMAP_ROOT_BASE = {
  document_name: 'Knowledge Hub Roadmap' as const,
  document_purpose: 'Active forward-looking roadmap.',
  date: '2026-05-22',
  status: 'Active' as const,
  forward_looking_only: true as const,
  related_documents: ['docs/reference/product-backlog.json'],
  last_updated: 'kh-prod-readiness-S66 close-out — roadmap rethink',
};

describe('RoadmapSchema root — union of sections[] OR themes[] (Subtask 30.6)', () => {
  it('accepts a sections-only document (back-compat with existing JSON)', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
      sections: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a themes-only document (new Phase-B shape)', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
      themes: [VALID_THEME],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a themes-only document with empty themes[] array', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
      themes: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a document with BOTH sections[] and themes[] present', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
      sections: [],
      themes: [VALID_THEME],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/exactly one of sections or themes/i);
    }
  });

  it('rejects a document with NEITHER sections[] nor themes[] present', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/exactly one of sections or themes/i);
    }
  });

  it('accepts a populated sections-only document with a non-empty section', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
      sections: [
        {
          id: '1',
          parent_id: null,
          number: '1',
          title: 'Top-level',
          narrative: null,
          spec_links: [],
          owner: null,
          table_columns: 'item_desc_owner_effort_status',
          items: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a populated themes-only document with multiple themes', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
      themes: [
        VALID_THEME,
        {
          ...VALID_THEME,
          id: '2',
          title: 'Developer Velocity',
          time_horizon: 'next',
          status: 'pending',
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
