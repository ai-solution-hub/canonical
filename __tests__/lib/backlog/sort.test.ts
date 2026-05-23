/**
 * sort.test.ts — `sortBacklogItems` helper (TECH §3.3 / PRODUCT inv 4).
 *
 * Pure deterministic sort:
 *   1. Priority tier (MoSCoW first, then Ranked, then Trigger — 8 values).
 *   2. Then rank ascending (null sorts last via MAX_SAFE_INTEGER fallback).
 *   3. Then id ascending (parsed as integer so `'9'` < `'10'`).
 *
 * 8 cases per Subtask 30.7 brief.
 *
 * Per TECH §3.3 + PRODUCT inv 4 (deterministic within-priority ordering).
 */

import { describe, it, expect } from 'vitest';
import { sortBacklogItems } from '@/lib/backlog/sort';
import type { BacklogItem } from '@/lib/validation/backlog-schema';

// ──────────────────────────────────────────────────────────────────────────────
// Minimal base — fields we don't care about for sort tests, fixed to satisfy
// the `BacklogItem` type. Only `id`, `priority`, `rank` are varied per case.
// ──────────────────────────────────────────────────────────────────────────────

function makeItem(overrides: {
  id: string;
  priority: BacklogItem['priority'];
  rank?: number | null;
}): BacklogItem {
  return {
    id: overrides.id,
    description: `Item ${overrides.id}`,
    type: 'feature',
    status: 'spec_needed',
    effort_estimate: null,
    priority: overrides.priority,
    track: 'general',
    dependencies: [],
    session_refs: [],
    commit_refs: [],
    cross_doc_links: [],
    notes: null,
    rank: overrides.rank,
  };
}

describe('sortBacklogItems — TECH §3.3 / PRODUCT inv 4', () => {
  // ── Case 1 — priority tier ordering ───────────────────────────────────────
  it('sorts MoSCoW priorities ahead of Ranked priorities', () => {
    const items = [
      makeItem({ id: '10', priority: 'high' }),
      makeItem({ id: '11', priority: 'must' }),
    ];
    const sorted = sortBacklogItems(items);
    expect(sorted.map((i) => i.id)).toEqual(['11', '10']);
  });

  // ── Case 2 — MoSCoW internal ordering: must < should < could < future ─────
  it('sorts within MoSCoW: must, should, could, future', () => {
    const items = [
      makeItem({ id: '4', priority: 'future' }),
      makeItem({ id: '3', priority: 'could' }),
      makeItem({ id: '2', priority: 'should' }),
      makeItem({ id: '1', priority: 'must' }),
    ];
    const sorted = sortBacklogItems(items);
    expect(sorted.map((i) => i.priority)).toEqual([
      'must',
      'should',
      'could',
      'future',
    ]);
  });

  // ── Case 3 — Ranked internal ordering: high < medium < low ────────────────
  it('sorts within Ranked: high, medium, low', () => {
    const items = [
      makeItem({ id: '13', priority: 'low' }),
      makeItem({ id: '12', priority: 'medium' }),
      makeItem({ id: '11', priority: 'high' }),
    ];
    const sorted = sortBacklogItems(items);
    expect(sorted.map((i) => i.priority)).toEqual(['high', 'medium', 'low']);
  });

  // ── Case 4 — Trigger sorts last ───────────────────────────────────────────
  it('sorts trigger priority last (after all MoSCoW and Ranked)', () => {
    const items = [
      makeItem({ id: '99', priority: 'trigger' }),
      makeItem({ id: '5', priority: 'low' }),
      makeItem({ id: '1', priority: 'must' }),
    ];
    const sorted = sortBacklogItems(items);
    expect(sorted.map((i) => i.priority)).toEqual(['must', 'low', 'trigger']);
  });

  // ── Case 5 — rank tiebreaker within same priority (null after set) ────────
  it('uses rank to break ties within the same priority; null ranks sort last', () => {
    const items = [
      makeItem({ id: '3', priority: 'must', rank: null }),
      makeItem({ id: '2', priority: 'must', rank: 20 }),
      makeItem({ id: '1', priority: 'must', rank: 10 }),
    ];
    const sorted = sortBacklogItems(items);
    expect(sorted.map((i) => i.id)).toEqual(['1', '2', '3']);
  });

  // ── Case 6 — id (bare-digit) tiebreaker via parseInt — '9' < '10' ─────────
  it('falls back to numeric id comparison; bare-digit "9" sorts before "10"', () => {
    const items = [
      makeItem({ id: '10', priority: 'must', rank: null }),
      makeItem({ id: '9', priority: 'must', rank: null }),
    ];
    const sorted = sortBacklogItems(items);
    expect(sorted.map((i) => i.id)).toEqual(['9', '10']);
  });

  // ── Case 7 — full chain: priority then rank then id ───────────────────────
  it('chains all three keys: priority then rank then id', () => {
    const items = [
      makeItem({ id: '9', priority: 'high', rank: 1 }),
      makeItem({ id: '8', priority: 'must', rank: null }),
      makeItem({ id: '7', priority: 'must', rank: 1 }),
      makeItem({ id: '10', priority: 'high', rank: 1 }),
      makeItem({ id: '6', priority: 'must', rank: 1 }),
    ];
    const sorted = sortBacklogItems(items);
    // must rank=1 (id 6,7 — 6<7), must rank=null (id 8),
    // then high rank=1 (id 9<10)
    expect(sorted.map((i) => i.id)).toEqual(['6', '7', '8', '9', '10']);
  });

  // ── Case 8 — input array is NOT mutated (pure helper) ─────────────────────
  it('does not mutate the input array (returns a new sorted copy)', () => {
    const items = [
      makeItem({ id: '2', priority: 'low' }),
      makeItem({ id: '1', priority: 'must' }),
    ];
    const originalOrder = items.map((i) => i.id);
    sortBacklogItems(items);
    expect(items.map((i) => i.id)).toEqual(originalOrder);
  });
});
