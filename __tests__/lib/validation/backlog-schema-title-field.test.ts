/**
 * backlog-schema-title-field.test.ts — verifies the optional `title` field on
 * BacklogItemSchema and its ≤80 char budget ({35.14}).
 *
 * Per ledger-cli-v2 RESEARCH §6.1 + PLAN {35.14}:
 *   - `title: z.string().min(1).optional()` — OPTIONAL, because all 149 live
 *     items lack it; the schema MUST keep parsing the live ledger;
 *   - positioned first after `id` (heading convention);
 *   - `description` stays REQUIRED (`min(1)`);
 *   - the ≤80 budget is registered in the unified registry (backlog item kind)
 *     — plain data, NOT a Zod `.max()` (vendor-drift safe, RESEARCH §7);
 *   - `parseBacklogWithWarnings` emits a soft warning for an over-budget title.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BacklogItemSchema,
  BacklogSchema,
  parseBacklogWithWarnings,
} from '@/lib/validation/backlog-schema';
import { LEDGER_BUDGETS } from '@/lib/validation/ledger-budgets';

const VALID_ITEM_BASE = {
  id: '28',
  description: 'A concise one-sentence backlog summary.',
  type: 'feature' as const,
  status: 'spec_needed' as const,
  effort_estimate: null,
  priority: 'medium' as const,
  track: 'title-test',
  dependencies: [],
  session_refs: [],
  commit_refs: [],
  cross_doc_links: [],
  notes: null,
};

function makeBacklogDoc(items: unknown[]) {
  return {
    document_name: 'Knowledge Hub Backlog',
    document_purpose: 'Test backlog.',
    related_documents: [],
    items,
  };
}

describe('BacklogItemSchema.title — {35.14} (RESEARCH §6.1)', () => {
  it('parses an item with NO title (optional — all 149 live items lack it)', () => {
    const result = BacklogItemSchema.safeParse(VALID_ITEM_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBeUndefined();
    }
  });

  it('parses an item carrying a title', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      title: 'Ship the unified budget registry',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Ship the unified budget registry');
    }
  });

  it('rejects an empty-string title (min(1))', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      title: '',
    });
    expect(result.success).toBe(false);
  });

  it('keeps description required (min(1))', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      title: 'Has a title',
      description: '',
    });
    expect(result.success).toBe(false);
  });

  it('positions title first after id in the schema shape', () => {
    const keys = Object.keys(BacklogItemSchema.shape);
    expect(keys[0]).toBe('id');
    expect(keys[1]).toBe('title');
  });

  it('accepts a >80-char title at parse time (no schema .max() — soft budget only)', () => {
    const longTitle = 't'.repeat(LEDGER_BUDGETS.item.title + 1);
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      title: longTitle,
    });
    expect(result.success).toBe(true);
  });
});

describe('LEDGER_BUDGETS.item.title — {35.14}', () => {
  it('exposes an 80-char budget for backlog title', () => {
    expect(LEDGER_BUDGETS.item.title).toBe(80);
  });
});

describe('parseBacklogWithWarnings — title budget ({35.14})', () => {
  it('warns on an over-budget title without rejecting the parse', () => {
    const longTitle = 't'.repeat(LEDGER_BUDGETS.item.title + 1);
    const { warnings } = parseBacklogWithWarnings(
      makeBacklogDoc([{ ...VALID_ITEM_BASE, title: longTitle }]),
    );
    expect(warnings.some((w) => w.message.includes('title'))).toBe(true);
    expect(
      warnings.some((w) => w.message.includes(String(longTitle.length))),
    ).toBe(true);
  });

  it('does NOT warn on an in-budget title', () => {
    const { warnings } = parseBacklogWithWarnings(
      makeBacklogDoc([{ ...VALID_ITEM_BASE, title: 'Short heading' }]),
    );
    expect(warnings).toHaveLength(0);
  });
});

describe('live product-backlog.json — still parses with the title field added', () => {
  // The "title is OPTIONAL" concern is proven above with a CONSTRUCTED fixture
  // (BacklogItemSchema.title — parses an item with NO title) — decoupled from the
  // live ledger so it cannot re-break as the live data evolves. This block only
  // proves the LIVE ledger still parses. {35.23} backfilled a title onto all 149
  // live items, so we assert the post-backfill reality: every item carries a
  // non-empty title within the ≤80 soft budget. (Pre-{35.24} this asserted
  // `title === undefined`, which {35.23}'s backfill correctly invalidated.)
  it('parses the current live ledger; every backfilled item has a non-empty title ≤80', () => {
    const raw = readFileSync('docs/reference/product-backlog.json', 'utf8');
    const parsed = JSON.parse(raw);
    const result = BacklogSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items.length).toBeGreaterThanOrEqual(149);
      // Post-{35.23} backfill: every live item now carries a title.
      expect(
        result.data.items.every(
          (i) => typeof i.title === 'string' && i.title.length > 0,
        ),
      ).toBe(true);
      // The backfill respected the ≤80 soft budget (none over-budget).
      expect(
        result.data.items.every(
          (i) => (i.title?.length ?? 0) <= LEDGER_BUDGETS.item.title,
        ),
      ).toBe(true);
    }
  });
});
