/**
 * roadmap-schema-shape-a.test.ts — verifies the Phase-A → Phase-B union root
 * (PRODUCT inv 6, 7) and the RoadmapThemeSchema fields (Subtask 30.7 brief).
 *
 * Per TECH §3.1 (Subtask 30.6) + Subtask 30.7. Two suites:
 *
 *   (1) Union root — exactly one of sections[] OR themes[] must be present
 *       (4 cases per brief):
 *         (a) themes[]-only parses (Phase-B shape)
 *         (b) sections[]-only parses (transitional Phase-A back-compat)
 *         (c) BOTH present fails
 *         (d) NEITHER present fails
 *
 *   (2) RoadmapThemeSchema field validation (5 cases per brief):
 *         (a) required-fields present parses
 *         (b) `time_horizon` non-enum fails (e.g. "someday")
 *         (c) `status` non-enum fails (e.g. "blocked")
 *         (d) `id` non-bare-digit fails (e.g. "T-1", "theme-1", "1.1")
 *         (e) stale `linked_tasks` ref parses (no referential integrity at
 *             schema level — discipline lives in the curator skill)
 *
 * T-OQ-4 ratification — stay with .superRefine() for the union root (not
 * z.discriminatedUnion) to avoid discriminator-field content churn during
 * the Phase-A → Phase-B migration.
 */

import { describe, it, expect } from 'vitest';
import {
  RoadmapSchema,
  RoadmapThemeSchema,
} from '@/lib/validation/roadmap-schema';

// ──────────────────────────────────────────────────────────────────────────────
// Shared fixtures
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

const VALID_ROADMAP_ROOT_BASE = {
  document_name: 'Knowledge Hub Roadmap' as const,
  document_purpose: 'Active forward-looking roadmap.',
  date: '2026-05-22',
  status: 'Active' as const,
  forward_looking_only: true as const,
  related_documents: ['docs/reference/product-backlog.json'],
  last_updated: 'kh-prod-readiness-S66 close-out — roadmap rethink',
};

// ──────────────────────────────────────────────────────────────────────────────
// Suite 1 — Union root (PRODUCT inv 6, 7) — exactly one of sections / themes
// ──────────────────────────────────────────────────────────────────────────────

describe('RoadmapSchema union root — PRODUCT inv 6, 7 (Subtask 30.6 / TECH §3.1)', () => {
  // (a)
  it('PR-A — themes[]-only document parses (Phase-B shape)', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
      themes: [VALID_THEME],
    });
    expect(result.success).toBe(true);
  });

  // (b)
  it('PR-A — sections[]-only document parses (transitional Phase-A back-compat)', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
      sections: [],
    });
    expect(result.success).toBe(true);
  });

  // (c)
  it('PR-A — document with BOTH sections[] and themes[] fails', () => {
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

  // (d)
  it('PR-A — document with NEITHER sections[] nor themes[] fails', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/exactly one of sections or themes/i);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Suite 2 — RoadmapThemeSchema field validation (Subtask 30.7)
// ──────────────────────────────────────────────────────────────────────────────

describe('RoadmapThemeSchema field validation — Subtask 30.7', () => {
  // (a)
  it('accepts a theme with all required fields present and well-typed', () => {
    const result = RoadmapThemeSchema.safeParse(VALID_THEME);
    expect(result.success).toBe(true);
  });

  // (b)
  it('rejects time_horizon outside the enum (e.g. "someday")', () => {
    const result = RoadmapThemeSchema.safeParse({
      ...VALID_THEME,
      time_horizon: 'someday',
    });
    expect(result.success).toBe(false);
  });

  // (c)
  it('rejects status outside the enum (e.g. "blocked" — not in theme status vocab)', () => {
    const result = RoadmapThemeSchema.safeParse({
      ...VALID_THEME,
      status: 'blocked',
    });
    expect(result.success).toBe(false);
  });

  // (d)
  it('rejects id that is not a bare-digit string (e.g. "T-1", "theme-1", "1.1")', () => {
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

  // (e)
  it('accepts a theme with stale linked_tasks ids (no referential integrity at schema level)', () => {
    const result = RoadmapThemeSchema.safeParse({
      ...VALID_THEME,
      linked_tasks: ['9999', 'this-ref-points-nowhere'],
    });
    expect(result.success).toBe(true);
  });
});
