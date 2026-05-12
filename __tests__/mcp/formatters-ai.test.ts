/**
 * Regression tests for `lib/mcp/formatters/ai.ts`.
 *
 * Added S159 WP3 verification follow-up: after S159 WP4a made
 * `ClassificationResult.primary_subtopic` nullable
 * (`string | null`), `formatClassification` interpolated it
 * directly and would render the literal word "null" in MCP tool
 * responses when the classifier could not confidently choose a
 * subtopic. These tests pin the null-safe rendering.
 *
 * Source:
 *   docs/audits/s159-wp4a-wp4b-adversarial-verification.md §WP4a §1
 *   docs/reference/product-roadmap.md §2.1.11
 */

import { describe, it, expect } from 'vitest';
import { formatClassification } from '@/lib/mcp/formatters/ai';
import type { ClassificationResult } from '@/lib/ai/classify';

const base: ClassificationResult = {
  suggested_title: 'Example Content',
  primary_domain: 'education',
  primary_subtopic: 'school-funding',
  secondary_domain: null,
  secondary_subtopic: null,
  ai_keywords: ['funding', 'schools'],
  summary: 'A brief summary.',
  classification_confidence: 0.87,
  classification_reasoning: 'Because reasons.',
  entities: [],
  relationships: [],
};

describe('formatClassification null-subtopic handling (S159)', () => {
  it('renders a valid subtopic verbatim', () => {
    const markdown = formatClassification(base);
    expect(markdown).toContain('**Subtopic:** school-funding');
    expect(markdown).not.toContain('**Subtopic:** null');
  });

  it('renders em dash when primary_subtopic is null', () => {
    const markdown = formatClassification({ ...base, primary_subtopic: null });
    expect(markdown).toContain('**Subtopic:** —');
    expect(markdown).not.toContain('**Subtopic:** null');
  });

  it('never emits the literal word "null" for a nulled subtopic', () => {
    const markdown = formatClassification({ ...base, primary_subtopic: null });
    // Sanity: not rendered literally
    const nullMatches = markdown.match(/\bnull\b/g) ?? [];
    expect(nullMatches).toHaveLength(0);
  });

  it('omits secondary subtopic line when null', () => {
    const markdown = formatClassification(base);
    expect(markdown).not.toContain('**Secondary subtopic:**');
  });

  it('renders secondary subtopic line when present', () => {
    const markdown = formatClassification({
      ...base,
      secondary_domain: 'market-intelligence',
      secondary_subtopic: 'edtech-vendors',
    });
    expect(markdown).toContain('**Secondary subtopic:** edtech-vendors');
  });
});
