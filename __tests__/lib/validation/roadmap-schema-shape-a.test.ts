/**
 * roadmap-schema-shape-a.test.ts — verifies the Phase-B-only Roadmap root
 * shape after Subtask 30.12 reshape (TECH §3.1 PR-C section + §7 risk row 1).
 *
 * Per Subtask 30.12: the transitional union root from 30.6 (sections[] XOR
 * themes[] via .superRefine()) is REMOVED; `themes` is REQUIRED at the
 * root, and any document retaining a legacy `sections[]` field is rejected
 * by `strict()`.
 *
 * Two suites:
 *
 *   (1) Root shape (3 cases — re-derived from the original 4):
 *         (a) themes[]-only parses (canonical Phase-B shape)
 *         (b) sections[]-only NOW FAILS (negative assertion — strict() rejects
 *             the legacy field). Replaces the prior "transitional back-compat
 *             parses" case.
 *         (c) document missing themes[] entirely fails (themes is required).
 *             (The prior "BOTH present fails" case is dropped — sections[] is
 *             rejected by strict() regardless of themes[] presence; covered by
 *             case (b).)
 *
 *   (2) RoadmapThemeSchema field validation (5 cases per Subtask 30.7 brief —
 *       unchanged by 30.12):
 *         (a) required-fields present parses
 *         (b) `time_horizon` non-enum fails (e.g. "someday")
 *         (c) `status` non-enum fails (e.g. "blocked")
 *         (d) `id` non-bare-digit fails (e.g. "T-1", "theme-1", "1.1")
 *         (e) stale `linked_tasks` ref parses (no referential integrity at
 *             schema level — discipline lives in the curator skill)
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
// Suite 1 — Root shape after Subtask 30.12 (themes-only; sections[] rejected)
// ──────────────────────────────────────────────────────────────────────────────

describe('RoadmapSchema root — themes-only shape (Subtask 30.12 / TECH §3.1 PR-C)', () => {
  // (a) — preserved from the original 30.7 brief (was PR-A case (a)).
  it('PR-C — themes[]-only document parses (canonical Phase-B shape)', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
      themes: [VALID_THEME],
    });
    expect(result.success).toBe(true);
  });

  // (b) — flipped from the original 30.7 brief (was PR-A case (b) — PASS).
  // After 30.12 reshape, strict() on the Roadmap root rejects the legacy
  // sections[] field. Any document still carrying sections[] must fail.
  it('PR-C — sections[]-only document NOW FAILS (legacy shape rejected by strict())', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
      sections: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // strict() emits an `unrecognized_keys` issue for `sections`.
      const issueCodes = result.error.issues.map((i) => i.code);
      const issueMessages = result.error.issues.map((i) => i.message).join(' ');
      expect(
        issueCodes.includes('unrecognized_keys') ||
          /sections/i.test(issueMessages),
      ).toBe(true);
    }
  });

  // (d in original brief, now (c)) — reframed: themes[] is required at the root.
  // A document missing themes[] altogether must fail with the canonical Zod
  // `invalid_type` issue (themes was promoted from optional to required in 30.12).
  it('PR-C — document missing themes[] fails (themes is required after 30.12)', () => {
    const result = RoadmapSchema.safeParse({
      ...VALID_ROADMAP_ROOT_BASE,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const themeIssue = result.error.issues.find((i) =>
        i.path.includes('themes'),
      );
      expect(themeIssue).toBeDefined();
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
