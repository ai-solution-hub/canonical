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
        expect(Math.abs(result.word_count - expected.word_count)).toBeLessThanOrEqual(1);
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

      it('quality_warnings contains expected entries', () => {
        for (const warning of expected.quality_warnings) {
          expect(result.quality_warnings).toContain(warning);
        }
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
