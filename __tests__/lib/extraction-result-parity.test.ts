/**
 * Cross-language parity fixtures for PipelineExtractionResult.
 *
 * This file defines the 5 canonical markdown fixtures plus the expected
 * derived-field output. The TypeScript factory is asserted against those
 * expectations here; the Python side of the parity check lives in
 * scripts/tests/test_extraction_result_parity.py and uses the same 5
 * fixtures byte-for-byte.
 *
 * When updating a fixture or assertion, update BOTH files in the same commit.
 */

import { describe, it, expect } from 'vitest';
import { createPipelineExtractionResult } from '@/lib/extraction/extraction-result';

const SIMPLE_ARTICLE = `# Main Title

## Background

This article discusses an important topic in depth. It provides context and examples. The first paragraph introduces the reader to the core ideas, sets expectations, and explains why the topic matters right now for the audience.

## Conclusion

The key takeaway is that quality matters more than speed. We should always prioritise careful thinking and thorough review over rushing to a conclusion. Readers who follow the guidance in this article will find their decisions better grounded in evidence.`;

const TABLE_HEAVY_POLICY = `# Procurement Policy

## Thresholds

| Category | Min Value | Max Value | Approver | Review Period |
| --- | --- | --- | --- | --- |
| Goods | 0 | 10000 | Manager | Annual |
| Services | 0 | 25000 | Director | Biennial |
| Works | 0 | 100000 | Board | Annual |

All procurements must follow the thresholds above. Exceptions require written sign-off from the approver named for the relevant category. This policy applies across every department without exception and is reviewed on the cadence shown in the final column. All staff involved in purchasing decisions should familiarise themselves with the thresholds and escalation paths before raising any purchase order.`;

const CODE_DOCUMENTATION = `# API Examples

## Python

\`\`\`python
def greet(name):
    return f"Hello, {name}"
\`\`\`

## TypeScript

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}\`;
}
\`\`\`

Both snippets demonstrate the same pattern across two languages for comparison.`;

const MINIMAL_CONTENT = `Just a brief note with only a handful of words here.`;

const EMPTY_CONTENT = ``;

const LONG_NO_HEADINGS = `The implementation of a comprehensive knowledge base platform requires careful attention to multiple interconnected concerns. First, the data model must accommodate the variety of content types that organisations produce, from short policy statements through to lengthy technical documentation. Second, the extraction pipeline needs to handle diverse source formats without losing structural information during conversion. Third, the classification layer must correctly identify domains, subtopics, entities, and relationships at scale. Fourth, the retrieval experience must be fast enough to feel responsive while still producing high-quality results for both semantic and keyword queries.

Beyond these core concerns, there are many secondary considerations. Access control must respect organisational boundaries. Content freshness must be tracked so stale information can be surfaced for review. Provenance must be preserved so every claim can be traced back to a source document. The user interface must be approachable for non-technical users while still providing power features for administrators. All of this must work reliably in production, with appropriate observability and error handling.

Building a system that meets all of these requirements is not simple. It takes careful sequencing of work, clear architectural decisions, and ongoing refinement based on real usage. The team must resist the urge to build everything at once and instead deliver incremental value while laying the foundations that will support future growth. Only then can the platform reach its full potential as a genuine knowledge asset rather than just another content silo.`;

const PDF_NO_TABLES = `# Annual Report Summary

## Key Findings

The organisation achieved its primary objectives during the reporting period. Growth in core service lines exceeded expectations. Operational costs remained within budgeted levels. Staff engagement scores improved year-on-year. Customer satisfaction metrics held steady despite broader market pressures. Strategic investment in platform capabilities is beginning to yield measurable returns. The board remains confident in the direction and long-term outlook.`;

const LINK_HEAVY = `# Reference Links

Readers who want more detail should consult the primary documentation. See the manual at [the reference manual guide](https://example.com/documentation/reference-manual/chapter-one/part-two/section-three/subsection-four) and the companion [complete API overview documentation](https://example.com/documentation/api-overview/introduction/primer/advanced/details). Additional context is in [the architecture design brief](https://example.com/documentation/architecture/design-brief/summary/version-three-point-zero), [the integration setup guide](https://example.com/documentation/integrations/setup-guide/primer/examples/patterns), [the troubleshooting reference](https://example.com/documentation/troubleshoot/common-issues/reference-guide/patterns/solutions), and [the release notes for the current quarter](https://example.com/documentation/release/notes/latest/current/changes). These resources together cover most use cases.`;

interface Expected {
  source_format: 'html' | 'pdf';
  word_count: number;
  headings: { level: number; text: string }[];
  has_tables: boolean;
  has_code_blocks: boolean;
  quality_warnings: string[];
}

const CASES: Array<{ name: string; markdown: string; expected: Expected }> = [
  {
    name: 'SIMPLE_ARTICLE',
    markdown: SIMPLE_ARTICLE,
    expected: {
      source_format: 'html',
      word_count: 80,
      headings: [
        { level: 1, text: 'Main Title' },
        { level: 2, text: 'Background' },
        { level: 2, text: 'Conclusion' },
      ],
      has_tables: false,
      has_code_blocks: false,
      quality_warnings: [],
    },
  },
  {
    name: 'TABLE_HEAVY_POLICY',
    markdown: TABLE_HEAVY_POLICY,
    expected: {
      source_format: 'pdf',
      word_count: 84,
      headings: [
        { level: 1, text: 'Procurement Policy' },
        { level: 2, text: 'Thresholds' },
      ],
      has_tables: true,
      has_code_blocks: false,
      quality_warnings: [],
    },
  },
  {
    name: 'CODE_DOCUMENTATION',
    markdown: CODE_DOCUMENTATION,
    expected: {
      source_format: 'html',
      word_count: 33,
      headings: [
        { level: 1, text: 'API Examples' },
        { level: 2, text: 'Python' },
        { level: 2, text: 'TypeScript' },
      ],
      has_tables: false,
      has_code_blocks: true,
      quality_warnings: ['very short content'],
    },
  },
  {
    name: 'MINIMAL_CONTENT',
    markdown: MINIMAL_CONTENT,
    expected: {
      source_format: 'html',
      word_count: 11,
      headings: [],
      has_tables: false,
      has_code_blocks: false,
      quality_warnings: ['very short content'],
    },
  },
  {
    name: 'EMPTY_CONTENT',
    markdown: EMPTY_CONTENT,
    expected: {
      source_format: 'html',
      word_count: 0,
      headings: [],
      has_tables: false,
      has_code_blocks: false,
      quality_warnings: ['very short content'],
    },
  },
  {
    name: 'LONG_NO_HEADINGS',
    markdown: LONG_NO_HEADINGS,
    expected: {
      source_format: 'html',
      word_count: 236,
      headings: [],
      has_tables: false,
      has_code_blocks: false,
      quality_warnings: ['no headings detected'],
    },
  },
  {
    name: 'PDF_NO_TABLES',
    markdown: PDF_NO_TABLES,
    expected: {
      source_format: 'pdf',
      word_count: 62,
      headings: [
        { level: 1, text: 'Annual Report Summary' },
        { level: 2, text: 'Key Findings' },
      ],
      has_tables: false,
      has_code_blocks: false,
      quality_warnings: ['no tables detected in PDF'],
    },
  },
  {
    name: 'LINK_HEAVY',
    markdown: LINK_HEAVY,
    expected: {
      source_format: 'html',
      word_count: 57,
      headings: [{ level: 1, text: 'Reference Links' }],
      has_tables: false,
      has_code_blocks: false,
      quality_warnings: ['high markdown-to-plain ratio'],
    },
  },
];

describe('PipelineExtractionResult parity fixtures', () => {
  for (const { name, markdown, expected } of CASES) {
    describe(name, () => {
      const result = createPipelineExtractionResult({
        source_format: expected.source_format,
        title: 'T',
        content_markdown: markdown,
        extraction_method: 'parity-fixture',
        extraction_confidence: 'high',
      });

      it('word_count matches (±1)', () => {
        expect(
          Math.abs(result.word_count - expected.word_count),
        ).toBeLessThanOrEqual(1);
      });

      it('headings length matches', () => {
        expect(result.headings).toHaveLength(expected.headings.length);
      });

      it('heading levels match', () => {
        expect(result.headings.map((h) => h.level)).toEqual(
          expected.headings.map((h) => h.level),
        );
      });

      it('heading text matches', () => {
        expect(result.headings.map((h) => h.text)).toEqual(
          expected.headings.map((h) => h.text),
        );
      });

      it('has_tables matches', () => {
        expect(result.has_tables).toBe(expected.has_tables);
      });

      it('has_code_blocks matches', () => {
        expect(result.has_code_blocks).toBe(expected.has_code_blocks);
      });

      it('quality_warnings set matches exactly', () => {
        expect(new Set(result.quality_warnings)).toEqual(
          new Set(expected.quality_warnings),
        );
      });

      it('content_plain does not contain markdown syntax tokens', () => {
        expect(result.content_plain).not.toContain('#');
        expect(result.content_plain).not.toContain('|');
        expect(result.content_plain).not.toContain('```');
        // Asterisks used for emphasis: none of these fixtures use bold/italic,
        // so any surviving '*' would indicate a stripping regression.
        expect(result.content_plain).not.toContain('*');
      });
    });
  }
});
