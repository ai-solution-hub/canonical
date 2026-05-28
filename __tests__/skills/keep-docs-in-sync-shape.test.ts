/**
 * keep-docs-in-sync-shape.test.ts — Inv-52 shape guard for the
 * `.claude/skills/keep-docs-in-sync/SKILL.md` body.
 *
 * Implements TECH §6.2 + PRODUCT Inv-52 testStrategy for ID-9.10.
 *
 * What this guards:
 *
 *   1. SKILL.md exists at `.claude/skills/keep-docs-in-sync/SKILL.md`.
 *   2. Frontmatter parses (gray-matter) and has `name:
 *      "keep-docs-in-sync"` plus a non-empty `description:`.
 *   3. The body contains the 7 canonical section titles per Inv-52 in
 *      canonical order:
 *        1. KH `docs/` IA conventions.
 *        2. Warm Meridian palette + typography references.
 *        3. AI-invisibility policy reference.
 *        4. UK English requirements.
 *        5. `docs/reference/documentation-inventory.md` index.
 *        6. Commit + PR conventions.
 *        7. Single-comment guardrail.
 *   4. §3 cross-references AGENTS.md §5 (AI-invisibility) per
 *      OQ-PLAN-3 Option A — one-sentence pointer, no duplication of
 *      the rule body.
 *   5. §4 cross-references AGENTS.md §1 (UK English) per OQ-PLAN-3
 *      Option A — one-sentence pointer, no duplication.
 *   6. Body LOC <= 250 per TECH §6.2 LOC budget.
 *
 * Spec slices:
 *   - docs/specs/id-9-astro-starlight-docs-foundation/PRODUCT.md Inv-52
 *   - docs/specs/id-9-astro-starlight-docs-foundation/TECH.md §6.2 + §6.3
 *
 * Per docs/reference/test-philosophy.md — pure file-system read; no
 * Supabase fixtures, no chain-method asserts. Behaviour under test is
 * the presence + ordering of canonical headings, plus the
 * cross-reference invariants and the LOC budget.
 *
 * ID-9.10 (kh-prod-readiness-S62F sub-O wave 1).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import matter from 'gray-matter';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SKILL_MD_PATH = resolve(
  REPO_ROOT,
  '.claude/skills/keep-docs-in-sync/SKILL.md',
);

// Canonical section titles per Inv-52 — order matters. Each entry is
// matched against a markdown H2 (e.g. `## 1. KH ...`) so the test
// asserts both presence and the numbered prefix.
const CANONICAL_SECTION_TITLES = [
  /^##\s+1\.\s+KH\s+`docs\/`\s+IA conventions/im,
  /^##\s+2\.\s+Warm Meridian (?:palette|tokens)/im,
  /^##\s+3\.\s+AI[- ]invisibility/im,
  /^##\s+4\.\s+UK English/im,
  /^##\s+5\.\s+Documentation inventory/im,
  /^##\s+6\.\s+Commit (?:and|\+|&) PR conventions/im,
  /^##\s+7\.\s+Single-comment guardrail/im,
];

// §3 cross-reference to AGENTS.md §5 (AI-invisibility) per OQ-PLAN-3
// Option A. `\s+` tolerates markdown soft-wrap between words.
const AGENTS_MD_AI_INVISIBILITY_REF_RE = /AGENTS\.md\s+§5/;

// §4 cross-reference to AGENTS.md §1 (UK English) per OQ-PLAN-3
// Option A. `\s+` tolerates markdown soft-wrap between words.
const AGENTS_MD_UK_ENGLISH_REF_RE = /AGENTS\.md\s+§1/;

// TECH §6.2 LOC budget — body remains under ~250 LOC.
const BODY_LOC_BUDGET = 250;

describe('keep-docs-in-sync SKILL.md — Inv-52 shape guard', () => {
  it('exists at .claude/skills/keep-docs-in-sync/SKILL.md', () => {
    expect(existsSync(SKILL_MD_PATH)).toBe(true);
  });

  describe('frontmatter', () => {
    const raw = existsSync(SKILL_MD_PATH)
      ? readFileSync(SKILL_MD_PATH, 'utf8')
      : '';
    const parsed = raw
      ? matter(raw)
      : { data: {} as Record<string, unknown>, content: '' };

    it('parses (gray-matter) without throwing', () => {
      expect(parsed.data).toBeTypeOf('object');
    });

    it('has `name: "keep-docs-in-sync"`', () => {
      expect(parsed.data.name).toBe('keep-docs-in-sync');
    });

    it('has a non-empty `description:`', () => {
      expect(parsed.data.description).toBeTypeOf('string');
      expect(
        ((parsed.data.description as string) ?? '').trim().length,
      ).toBeGreaterThan(0);
    });
  });

  describe('body content', () => {
    const raw = existsSync(SKILL_MD_PATH)
      ? readFileSync(SKILL_MD_PATH, 'utf8')
      : '';
    const parsed = raw ? matter(raw) : { data: {}, content: '' };
    const body = parsed.content;

    it('contains all 7 canonical section titles per Inv-52', () => {
      for (const titleRe of CANONICAL_SECTION_TITLES) {
        expect(body).toMatch(titleRe);
      }
    });

    it('orders the 7 canonical sections per Inv-52', () => {
      const positions = CANONICAL_SECTION_TITLES.map((re) => body.search(re));
      for (let i = 0; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThanOrEqual(0);
        if (i > 0) {
          expect(positions[i]).toBeGreaterThan(positions[i - 1]);
        }
      }
    });

    it('§3 cross-references AGENTS.md §5 (OQ-PLAN-3 Option A non-duplication)', () => {
      // The AGENTS.md §5 reference must appear inside the §3
      // AI-invisibility section — that is, after the §3 heading and
      // before the §4 heading.
      const section3Start = body.search(CANONICAL_SECTION_TITLES[2]);
      const section4Start = body.search(CANONICAL_SECTION_TITLES[3]);
      const refPos = body.search(AGENTS_MD_AI_INVISIBILITY_REF_RE);
      expect(refPos).toBeGreaterThanOrEqual(0);
      expect(section3Start).toBeGreaterThan(0);
      expect(section4Start).toBeGreaterThan(section3Start);
      expect(refPos).toBeGreaterThan(section3Start);
      expect(refPos).toBeLessThan(section4Start);
    });

    it('§4 cross-references AGENTS.md §1 (OQ-PLAN-3 Option A non-duplication)', () => {
      // The AGENTS.md §1 reference must appear inside the §4 UK
      // English section — that is, after the §4 heading and before
      // the §5 heading.
      const section4Start = body.search(CANONICAL_SECTION_TITLES[3]);
      const section5Start = body.search(CANONICAL_SECTION_TITLES[4]);
      const refPos = body.search(AGENTS_MD_UK_ENGLISH_REF_RE);
      expect(refPos).toBeGreaterThanOrEqual(0);
      expect(section4Start).toBeGreaterThan(0);
      expect(section5Start).toBeGreaterThan(section4Start);
      expect(refPos).toBeGreaterThan(section4Start);
      expect(refPos).toBeLessThan(section5Start);
    });

    it(`body LOC <= ${BODY_LOC_BUDGET} (TECH §6.2 budget)`, () => {
      const loc = body.split('\n').length;
      expect(loc).toBeLessThanOrEqual(BODY_LOC_BUDGET);
    });
  });
});
