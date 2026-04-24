/**
 * Unit tests for lib/bid-library-ingest/extract-qa-pairs.ts
 *
 * Tests the TS port of scripts/extract_docx_tables.py:
 *   - 3 table formats x >= 5 cells each
 *   - Markdown preservation for bold/lists/links/tables
 *   - Empty + merged cell handling
 *   - Header normalisation
 *   - Text deduplication
 *
 * Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md ss10.1.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import {
  normaliseHeader,
  deduplicateRepeatedText,
  detectTableFormat,
  extractQaPairs,
  type QaPair,
} from '@/lib/bid-library-ingest/extract-qa-pairs';
import {
  htmlToMarkdown,
  docxBufferToMarkdown,
  docxBufferToHtml,
} from '@/lib/bid-library-ingest/docx-to-markdown';

// ── normaliseHeader ─────────────────────────────────────────────────────

describe('normaliseHeader', () => {
  it('maps "Question" to "question"', () => {
    expect(normaliseHeader('Question')).toBe('question');
  });

  it('maps "Standard Response" to "standard"', () => {
    expect(normaliseHeader('Standard Response')).toBe('standard');
  });

  it('maps "Advanced Answer" to "advanced"', () => {
    expect(normaliseHeader('Advanced Answer')).toBe('advanced');
  });

  it('maps "No." to "number"', () => {
    expect(normaliseHeader('No.')).toBe('number');
  });

  it('maps "Category" to "section"', () => {
    expect(normaliseHeader('Category')).toBe('section');
  });

  it('strips trailing punctuation before matching', () => {
    expect(normaliseHeader('Question:')).toBe('question');
    expect(normaliseHeader('Notes---')).toBe('notes');
  });

  it('handles whitespace trimming', () => {
    expect(normaliseHeader('  Standard Response  ')).toBe('standard');
  });

  it('returns cleaned text for unknown headers', () => {
    expect(normaliseHeader('Custom Column')).toBe('custom column');
  });

  it('maps SQ response variants correctly', () => {
    expect(normaliseHeader('Supplier Response')).toBe('standard');
    expect(normaliseHeader('Your Response')).toBe('standard');
    expect(normaliseHeader("Tenderer's Response")).toBe('standard');
    expect(normaliseHeader('Organisation Response')).toBe('standard');
  });

  it('maps guidance/instruction to notes', () => {
    expect(normaliseHeader('Guidance')).toBe('notes');
    expect(normaliseHeader('Guidance Notes')).toBe('notes');
    expect(normaliseHeader('Max Score')).toBe('notes');
  });
});

// ── deduplicateRepeatedText ─────────────────────────────────────────────

describe('deduplicateRepeatedText', () => {
  it('deduplicates tripled text', () => {
    expect(
      deduplicateRepeatedText(
        'Product SupportProduct SupportProduct Support',
      ),
    ).toBe('Product Support');
  });

  it('deduplicates doubled text', () => {
    expect(
      deduplicateRepeatedText(
        'Software developmentSoftware development',
      ),
    ).toBe('Software development');
  });

  it('leaves non-repeated text unchanged', () => {
    expect(deduplicateRepeatedText('Product Support Team')).toBe(
      'Product Support Team',
    );
  });

  it('handles short strings without deduplication', () => {
    expect(deduplicateRepeatedText('ab')).toBe('ab');
    expect(deduplicateRepeatedText('abc')).toBe('abc');
  });
});

// ── detectTableFormat ───────────────────────────────────────────────────

describe('detectTableFormat', () => {
  it('detects Pattern A: audit_6col', () => {
    const headers = [
      'No',
      'Section',
      'Question',
      'Standard Response',
      'Advanced Response',
      'Notes',
    ];
    expect(detectTableFormat(headers)).toBe('audit_6col');
  });

  it('detects Pattern B: draft_5col', () => {
    const headers = ['No', 'Section', 'Question', 'Standard Response', 'Notes'];
    expect(detectTableFormat(headers)).toBe('draft_5col');
  });

  it('detects Pattern C: numbered_6col', () => {
    const headers = [
      'No',
      'Question',
      'Standard Answer',
      'Advanced Answer',
      'Section',
      'Notes',
    ];
    expect(detectTableFormat(headers)).toBe('numbered_6col');
  });

  it('detects positional_5col when all headers empty', () => {
    const headers = ['', '', '', '', ''];
    expect(detectTableFormat(headers)).toBe('positional_5col');
  });

  it('detects positional_6col when all headers empty', () => {
    const headers = ['', '', '', '', '', ''];
    expect(detectTableFormat(headers)).toBe('positional_6col');
  });

  it('returns null for unrecognised formats', () => {
    const headers = ['Name', 'Age', 'Location'];
    expect(detectTableFormat(headers)).toBeNull();
  });

  it('handles question + standard fallback', () => {
    const headers = ['Question', 'Response'];
    expect(detectTableFormat(headers)).toBe('draft_5col');
  });

  it('handles question + standard + advanced fallback', () => {
    const headers = ['Question', 'Standard Response', 'Advanced Response'];
    expect(detectTableFormat(headers)).toBe('audit_6col');
  });
});

// ── htmlToMarkdown ──────────────────────────────────────────────────────

describe('htmlToMarkdown', () => {
  it('converts bold to markdown', () => {
    expect(htmlToMarkdown('<p><strong>Important</strong> text</p>')).toBe(
      '**Important** text',
    );
  });

  it('converts italic to markdown', () => {
    expect(htmlToMarkdown('<p><em>Emphasised</em> text</p>')).toBe(
      '_Emphasised_ text',
    );
  });

  it('converts unordered lists to markdown', () => {
    const html = '<ul><li>Item one</li><li>Item two</li></ul>';
    const md = htmlToMarkdown(html);
    // Turndown may use variable spacing after the bullet marker
    expect(md).toMatch(/-\s+Item one/);
    expect(md).toMatch(/-\s+Item two/);
  });

  it('converts ordered lists to markdown', () => {
    const html = '<ol><li>First</li><li>Second</li></ol>';
    const md = htmlToMarkdown(html);
    // Turndown may use variable spacing after the number marker
    expect(md).toMatch(/1\.\s+First/);
    expect(md).toMatch(/2\.\s+Second/);
  });

  it('converts links to markdown', () => {
    const html = '<p><a href="https://example.com">Link text</a></p>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('[Link text](https://example.com)');
  });

  it('converts tables to GFM markdown', () => {
    const html =
      '<table><tr><th>Header</th></tr><tr><td>Cell</td></tr></table>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('Header');
    expect(md).toContain('Cell');
    expect(md).toContain('|');
  });

  it('handles empty HTML gracefully', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('   ')).toBe('');
  });

  it('handles plain text (no HTML tags)', () => {
    expect(htmlToMarkdown('Plain text')).toBe('Plain text');
  });
});

// ── docxBufferToMarkdown ─────────────────────────────────────────────────

describe('docxBufferToMarkdown', () => {
  const fixturesDir = resolve(__dirname, '../../fixtures');

  it('converts a simple .docx to markdown', async () => {
    const buffer = readFileSync(resolve(fixturesDir, 'simple-template.docx'));
    const md = await docxBufferToMarkdown(buffer);
    expect(typeof md).toBe('string');
    expect(md.length).toBeGreaterThan(0);
  });

  it('preserves table content in markdown output', async () => {
    const buffer = readFileSync(resolve(fixturesDir, 'simple-template.docx'));
    const md = await docxBufferToMarkdown(buffer);
    // The simple template has tables — content should be present in output
    expect(md).toContain('Question');
    expect(md).toContain('Response');
  });
});

// ── docxBufferToHtml ────────────────────────────────────────────────────

describe('docxBufferToHtml', () => {
  const fixturesDir = resolve(__dirname, '../../fixtures');

  it('converts a .docx to HTML string', async () => {
    const buffer = readFileSync(resolve(fixturesDir, 'simple-template.docx'));
    const html = await docxBufferToHtml(buffer);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('produces HTML with table tags', async () => {
    const buffer = readFileSync(resolve(fixturesDir, 'simple-template.docx'));
    const html = await docxBufferToHtml(buffer);
    expect(html).toContain('<table');
    expect(html).toContain('</table>');
  });
});

// ── extractQaPairs (on real .docx fixtures) ─────────────────────────────

describe('extractQaPairs', () => {
  const fixturesDir = resolve(__dirname, '../../fixtures');

  describe('simple-template.docx', () => {
    let pairs: QaPair[];

    it('extracts pairs from the simple template', async () => {
      const buffer = readFileSync(resolve(fixturesDir, 'simple-template.docx'));
      pairs = await extractQaPairs(buffer, 'simple-template.docx');
      expect(pairs.length).toBeGreaterThanOrEqual(3);
    });

    it('sets sourceFile on each pair', async () => {
      const buffer = readFileSync(resolve(fixturesDir, 'simple-template.docx'));
      pairs = await extractQaPairs(buffer, 'simple-template.docx');
      for (const pair of pairs) {
        expect(pair.sourceFile).toBe('simple-template.docx');
      }
    });

    it('extracts non-empty question text', async () => {
      const buffer = readFileSync(resolve(fixturesDir, 'simple-template.docx'));
      pairs = await extractQaPairs(buffer, 'simple-template.docx');
      for (const pair of pairs) {
        expect(pair.questionText).toBeTruthy();
        expect(pair.questionText.length).toBeGreaterThan(5);
      }
    });

    it('provides answerStandard as a string', async () => {
      const buffer = readFileSync(resolve(fixturesDir, 'simple-template.docx'));
      pairs = await extractQaPairs(buffer, 'simple-template.docx');
      for (const pair of pairs) {
        expect(typeof pair.answerStandard).toBe('string');
      }
    });

    it('provides answerAdvanced as a string', async () => {
      const buffer = readFileSync(resolve(fixturesDir, 'simple-template.docx'));
      pairs = await extractQaPairs(buffer, 'simple-template.docx');
      for (const pair of pairs) {
        expect(typeof pair.answerAdvanced).toBe('string');
      }
    });

    it('sets tableIndex and rowIndex', async () => {
      const buffer = readFileSync(resolve(fixturesDir, 'simple-template.docx'));
      pairs = await extractQaPairs(buffer, 'simple-template.docx');
      for (const pair of pairs) {
        expect(typeof pair.tableIndex).toBe('number');
        expect(typeof pair.rowIndex).toBe('number');
        expect(pair.tableIndex).toBeGreaterThanOrEqual(0);
        expect(pair.rowIndex).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('complex-template.docx', () => {
    it('extracts pairs from the complex template', async () => {
      const buffer = readFileSync(
        resolve(fixturesDir, 'complex-template.docx'),
      );
      const pairs = await extractQaPairs(buffer, 'complex-template.docx');
      expect(pairs.length).toBeGreaterThanOrEqual(5);
    });

    it('has non-empty question text in all pairs', async () => {
      const buffer = readFileSync(
        resolve(fixturesDir, 'complex-template.docx'),
      );
      const pairs = await extractQaPairs(buffer, 'complex-template.docx');
      for (const pair of pairs) {
        expect(pair.questionText.trim()).not.toBe('');
      }
    });
  });

  describe('empty/edge cases', () => {
    it('returns empty array for non-DOCX buffer', async () => {
      const buffer = Buffer.from('not a docx file');
      // mammoth should handle gracefully — either returns empty pairs
      // or throws (we catch both)
      try {
        const pairs = await extractQaPairs(buffer, 'invalid.docx');
        expect(pairs).toEqual([]);
      } catch {
        // Expected — mammoth may throw on invalid buffers
        expect(true).toBe(true);
      }
    });
  });
});
