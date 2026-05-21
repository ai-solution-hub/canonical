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
 * Test coverage:
 *   - B-INV-4: RoadmapPriority === Priority (same Zod instance, not a copy)
 *   - All 8 priority values accepted by RoadmapPriority
 *   - Unknown priority value rejected by RoadmapPriority
 *   - RoadmapPriority and Priority produce identical parse results for all values
 */

import { describe, it, expect } from 'vitest';
import { RoadmapPriority } from '@/lib/validation/roadmap-schema';
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
