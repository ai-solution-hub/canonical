/**
 * backlog-schema-rank-field.test.ts — verifies BacklogItemSchema.rank (PRODUCT inv 3).
 *
 * 6 cases per Subtask 30.7 brief — covers the canonical rank shape:
 *   (a) `rank: null` parses
 *   (b) `rank: 10` parses
 *   (c) `rank: -5` parses (no positive constraint at schema level)
 *   (d) `rank: '10'` fails (non-integer string)
 *   (e) `rank: 1.5` fails (non-integer float)
 *   (f) `rank` omitted parses (optional)
 *
 * Per TECH §3.1 (Subtask 30.6) + Subtask 30.7. The rank field is
 * `z.number().int().nullable().optional()` — no positive constraint, no
 * uniqueness or contiguity enforcement (those discipline lines belong to the
 * curator skill, not the schema).
 */

import { describe, it, expect } from 'vitest';
import { BacklogItemSchema } from '@/lib/validation/backlog-schema';

const VALID_ITEM_BASE = {
  id: '28',
  description: 'Backlog item with rank field exercised',
  type: 'feature' as const,
  status: 'spec_needed' as const,
  effort_estimate: null,
  priority: 'medium' as const,
  track: 'rank-test',
  dependencies: [],
  session_refs: [],
  commit_refs: [],
  cross_doc_links: [],
  notes: null,
};

describe('BacklogItemSchema.rank — PRODUCT inv 3 (Subtask 30.7)', () => {
  // (a)
  it('accepts rank: null', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      rank: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rank).toBeNull();
    }
  });

  // (b)
  it('accepts rank: 10 (positive integer)', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      rank: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rank).toBe(10);
    }
  });

  // (c)
  it('accepts rank: -5 (no positive constraint at schema level)', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      rank: -5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rank).toBe(-5);
    }
  });

  // (d)
  it("rejects rank: '10' (non-integer string)", () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      rank: '10',
    });
    expect(result.success).toBe(false);
  });

  // (e)
  it('rejects rank: 1.5 (non-integer float)', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      rank: 1.5,
    });
    expect(result.success).toBe(false);
  });

  // (f)
  it('accepts an item with rank omitted entirely (optional)', () => {
    const { ...withoutRank } = VALID_ITEM_BASE;
    const result = BacklogItemSchema.safeParse(withoutRank);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rank).toBeUndefined();
    }
  });
});
