/**
 * agents-md-shape.test.ts — Inv-51 shape guard for the repo-root
 * AGENTS.md style guide.
 *
 * Implements TECH §6.1 + PRODUCT Inv-51 testStrategy for ID-9.9.
 *
 * What this guards:
 *
 *   1. AGENTS.md exists at the repo root (sibling to CLAUDE.md).
 *   2. Contains the 5 canonical section titles per Inv-51 in canonical
 *      order: voice + tone, terminology, frontmatter contract,
 *      content-type style guides, AI-invisibility.
 *   3. Section opener cross-references CLAUDE.md per OQ-8 Option A
 *      (the two files are complementary, not redundant).
 *   4. Post-S65-W1 amendment compliance — single-sentence
 *      cross-reference pointing at the imported `.gitnexus/CLAUDE.md`
 *      and `.ast-dataflow/CLAUDE.md` rather than restating their
 *      Always-Do / Never-Do lists.
 *   5. Negative assertion — the code-intelligence symbol identifiers
 *      `gitnexus_impact` and `gitnexus_detect_changes` appear at most
 *      once each, in the cross-reference sentence only. Any further
 *      occurrence implies duplication of `.gitnexus/CLAUDE.md` content
 *      and breaks OQ-PLAN-3 Option A non-duplication.
 *
 * Spec slices:
 *   - docs/specs/id-9-astro-starlight-docs-foundation/PRODUCT.md Inv-51
 *   - docs/specs/id-9-astro-starlight-docs-foundation/TECH.md §6.1 + §6.3
 *
 * Per docs/reference/test-philosophy.md — pure file-system read; no
 * Supabase fixtures, no chain-method asserts. Behaviour under test is
 * the presence + ordering of canonical headings, plus the
 * cross-reference invariants.
 *
 * ID-9.9 (kh-prod-readiness-S62F sub-O wave 1).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const AGENTS_MD_PATH = resolve(REPO_ROOT, 'AGENTS.md');

// Canonical section titles per Inv-51 — order matters.
// Each entry is matched against a markdown H2 (e.g. `## 1. Voice ...`)
// so the test asserts both presence and the numbered prefix.
const CANONICAL_SECTION_TITLES = [
  /^##\s+1\.\s+Voice (?:and|&|\+) tone/im,
  /^##\s+2\.\s+Terminology/im,
  /^##\s+3\.\s+Frontmatter contract/im,
  /^##\s+4\.\s+Content-type style guides/im,
  /^##\s+5\.\s+AI[- ]invisibility/im,
];

// OQ-8 Option A — the section opener cross-references CLAUDE.md.
// `\s+` tolerates markdown soft-wrap between words so authors are
// free to wrap the sentence across lines.
const CLAUDE_MD_CROSS_REF_RE =
  /For project-wide conventions,\s+see\s+CLAUDE\.md\.\s+This\s+file\s+adds\s+docs-corpus-specific\s+conventions\s+on\s+top\./;

// POST-S65-W1 amendment — single-sentence cross-reference to the
// imported code-intelligence files. The exact phrasing is fixed
// because the test verifies both presence (one sentence) and absence
// of restatement (zero further mentions of the Always-Do / Never-Do
// helper names from `.gitnexus/CLAUDE.md` + `.ast-dataflow/CLAUDE.md`).
// `\s+` tolerates markdown soft-wrap between words.
const CODE_INTELLIGENCE_CROSS_REF_RE =
  /For code-intelligence workflow \(gitnexus \+ ast-dataflow\),\s+see\s+`\.gitnexus\/CLAUDE\.md`\s+and\s+`\.ast-dataflow\/CLAUDE\.md`\s+—\s+imported by root\s+CLAUDE\.md\./;

describe('AGENTS.md — Inv-51 shape guard', () => {
  it('exists at the repo root (sibling to CLAUDE.md)', () => {
    expect(existsSync(AGENTS_MD_PATH)).toBe(true);
  });

  describe('content sections', () => {
    const body = existsSync(AGENTS_MD_PATH)
      ? readFileSync(AGENTS_MD_PATH, 'utf8')
      : '';

    it('contains all 5 canonical section titles per Inv-51', () => {
      for (const titleRe of CANONICAL_SECTION_TITLES) {
        expect(body).toMatch(titleRe);
      }
    });

    it('orders the 5 canonical sections per Inv-51', () => {
      const positions = CANONICAL_SECTION_TITLES.map((re) => body.search(re));
      // Every section must be present (>= 0) AND in ascending order.
      for (let i = 0; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThanOrEqual(0);
        if (i > 0) {
          expect(positions[i]).toBeGreaterThan(positions[i - 1]);
        }
      }
    });

    it('opens with a cross-reference to CLAUDE.md (OQ-8 Option A)', () => {
      // The CLAUDE.md cross-reference must appear before the first
      // section header so it qualifies as the "section opener" per
      // TECH §6.1.
      const claudeRefPos = body.search(CLAUDE_MD_CROSS_REF_RE);
      const firstSectionPos = body.search(CANONICAL_SECTION_TITLES[0]);
      expect(claudeRefPos).toBeGreaterThanOrEqual(0);
      expect(firstSectionPos).toBeGreaterThan(0);
      expect(claudeRefPos).toBeLessThan(firstSectionPos);
    });

    it('cross-references .gitnexus + .ast-dataflow CLAUDE.md imports (POST-S65-W1 amendment)', () => {
      expect(body).toMatch(CODE_INTELLIGENCE_CROSS_REF_RE);
    });

    it('does not restate `.gitnexus/CLAUDE.md` Always-Do / Never-Do guidance (POST-S65-W1 non-duplication)', () => {
      // The code-intelligence symbol names from `.gitnexus/CLAUDE.md`
      // Always-Do / Never-Do lists may appear at most once each — in
      // the single cross-reference sentence permitted by the
      // amendment. Any second occurrence implies duplication.
      const gitnexusImpactCount = (body.match(/gitnexus_impact/g) ?? []).length;
      const gitnexusDetectChangesCount = (
        body.match(/gitnexus_detect_changes/g) ?? []
      ).length;
      expect(gitnexusImpactCount).toBeLessThanOrEqual(1);
      expect(gitnexusDetectChangesCount).toBeLessThanOrEqual(1);
    });
  });
});
