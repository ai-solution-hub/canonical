/**
 * roadmap-schema-soft-cap.test.ts — verifies `parseRoadmapWithWarnings`
 * (PRODUCT inv 8 — 12-theme soft ceiling).
 *
 * 3 cases per Subtask 30.7 brief:
 *   (a) 12 themes — no warning
 *   (b) 13 themes — exactly ONE warning (per-document, not per-excess-theme)
 *   (c) 30 themes — still exactly ONE warning
 *
 * Per TECH §3.3 (Subtask 30.7). The soft ceiling is NOT a hard schema reject —
 * `RoadmapSchema.parse()` continues to accept >12 themes. Consumers that want
 * to surface the planning signal call `parseRoadmapWithWarnings`. Pattern
 * mirrors `parseTaskListWithWarnings` for the 25-Subtask soft cap.
 */

import { describe, it, expect } from 'vitest';
import {
  parseRoadmapWithWarnings,
  RoadmapSchema,
} from '@/lib/validation/roadmap-schema';
import type { RoadmapTheme } from '@/lib/validation/roadmap-schema';

const VALID_ROADMAP_ROOT_BASE = {
  document_name: 'Knowledge Hub Roadmap' as const,
  document_purpose: 'Active forward-looking roadmap.',
  date: '2026-05-22',
  status: 'Active' as const,
  forward_looking_only: true as const,
  related_documents: ['docs/reference/product-backlog.json'],
  last_updated: 'kh-prod-readiness-S66 close-out — roadmap rethink',
};

function makeTheme(id: number): RoadmapTheme {
  return {
    id: String(id),
    title: `Theme ${id}`,
    description: `Theme ${id} description.`,
    time_horizon: 'now',
    status: 'pending',
    linked_tasks: [],
    linked_backlog: [],
    session_refs: [],
    commit_refs: [],
    cross_doc_links: [],
    notes: null,
  };
}

function buildRoadmapWithThemes(n: number) {
  return {
    ...VALID_ROADMAP_ROOT_BASE,
    themes: Array.from({ length: n }, (_, i) => makeTheme(i + 1)),
  };
}

describe('parseRoadmapWithWarnings — PRODUCT inv 8 (Subtask 30.7 / TECH §3.3)', () => {
  // (a)
  it('returns no warnings when a document has 12 themes (at ceiling)', () => {
    const input = buildRoadmapWithThemes(12);
    const { value, warnings } = parseRoadmapWithWarnings(input);
    expect(warnings).toHaveLength(0);
    expect(value.themes).toHaveLength(12);
  });

  // (b)
  it('returns exactly ONE warning when a document has 13 themes (one over ceiling)', () => {
    const input = buildRoadmapWithThemes(13);
    const { warnings } = parseRoadmapWithWarnings(input);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].themeCount).toBe(13);
    expect(warnings[0].message).toMatch(/13 themes/);
    expect(warnings[0].message).toMatch(/PRODUCT inv 8/);
  });

  // (c)
  it('returns exactly ONE warning even when a document has 30 themes (per-document, not per-excess)', () => {
    const input = buildRoadmapWithThemes(30);
    const { warnings } = parseRoadmapWithWarnings(input);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].themeCount).toBe(30);
    expect(warnings[0].message).toMatch(/30 themes/);
  });

  it('throws ZodError on hard validation failure (not warnings)', () => {
    const invalid = { ...VALID_ROADMAP_ROOT_BASE, document_name: 'Wrong Name' };
    expect(() => parseRoadmapWithWarnings(invalid)).toThrow();
  });

  it('does not emit a warning for sections-only documents (themes undefined)', () => {
    const input = { ...VALID_ROADMAP_ROOT_BASE, sections: [] };
    const { warnings } = parseRoadmapWithWarnings(input);
    expect(warnings).toHaveLength(0);
  });

  it('RoadmapSchema.parse() continues to accept >12 themes (soft cap is helper-level only)', () => {
    const input = buildRoadmapWithThemes(13);
    // The base schema does NOT reject — the soft cap lives in the helper only.
    const result = RoadmapSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});
