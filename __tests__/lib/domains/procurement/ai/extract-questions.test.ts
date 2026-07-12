/**
 * ID-145 {145.12} — Plane-1 XLSX extraction + expected_response_kind
 * metadata parity with q_a_extractions.
 *
 * `xlsxWorkbookToHtml` is exercised against a REAL workbook buffer (built
 * via the same `xlsx` package the source module uses) rather than a mock —
 * it is a pure conversion, so a real fixture is the honest test. Only the
 * Anthropic call inside `extractXLSXQuestions` is mocked, mirroring
 * `no-silent-fallback.test.ts`'s pattern for this module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: vi.fn(() => ({
    messages: { create: mockCreate, stream: vi.fn() },
  })),
  getAIModel: vi.fn(() => 'claude-sonnet-4-6'),
  getModelForTier: vi.fn(() => 'claude-sonnet-4-6'),
  estimateCost: vi.fn(() => 0.001),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  extractXLSXQuestions,
  xlsxWorkbookToHtml,
} from '@/lib/domains/procurement/ai/extract-questions';

function buildWorkbookBuffer(sheets: Record<string, unknown[][]>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function toolUseResponse(input: unknown) {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'extract_questions', input }],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('xlsxWorkbookToHtml', () => {
  it('renders one HTML table per sheet, preceded by an h2 sheet-name heading', () => {
    const buffer = buildWorkbookBuffer({
      Questions: [
        ['Question', 'Word Limit'],
        ['Describe your approach', '500'],
      ],
    });

    const html = xlsxWorkbookToHtml(buffer);

    expect(html).toContain('<h2>Questions</h2>');
    expect(html).toContain('Describe your approach');
    expect(html).toContain('<table');
  });

  it('concatenates multiple sheets in workbook order', () => {
    const buffer = buildWorkbookBuffer({
      Sheet1: [['Question'], ['First sheet question']],
      Sheet2: [['Question'], ['Second sheet question']],
    });

    const html = xlsxWorkbookToHtml(buffer);

    expect(html.indexOf('First sheet question')).toBeLessThan(
      html.indexOf('Second sheet question'),
    );
  });

  it('skips sheets with no populated cell range', () => {
    const workbook = XLSX.utils.book_new();
    // An explicitly empty sheet has no `!ref` — aoa_to_sheet([]) produces one.
    const emptySheet = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(workbook, emptySheet, 'Empty');
    const populatedSheet = XLSX.utils.aoa_to_sheet([
      ['Question'],
      ['Real question'],
    ]);
    XLSX.utils.book_append_sheet(workbook, populatedSheet, 'Populated');
    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;

    const html = xlsxWorkbookToHtml(buffer);

    expect(html).not.toContain('<h2>Empty</h2>');
    expect(html).toContain('<h2>Populated</h2>');
  });
});

describe('extractXLSXQuestions', () => {
  it('converts the workbook to HTML and returns the tool_use extraction result', async () => {
    const buffer = buildWorkbookBuffer({
      Questions: [
        ['Question', 'Word Limit', 'Weighting'],
        ['Describe your approach', '500', '20%'],
      ],
    });

    const extraction = {
      sections: [
        {
          section_name: 'Questions',
          section_sequence: 0,
          questions: [
            {
              question_text: 'Describe your approach',
              question_sequence: 0,
              word_limit: 500,
              evaluation_weight: 20,
              category: 'mandatory',
              expected_response_kind: 'mandatory',
            },
          ],
        },
      ],
    };
    mockCreate.mockResolvedValueOnce(toolUseResponse(extraction));

    const result = await extractXLSXQuestions(buffer);

    expect(result).toEqual(extraction);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.tool_choice).toEqual({
      type: 'tool',
      name: 'extract_questions',
    });
    expect(call.messages[0].content).toContain('Describe your approach');
  });

  it('throws when the workbook has no populated sheets (never silently returns empty)', async () => {
    const workbook = XLSX.utils.book_new();
    const emptySheet = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(workbook, emptySheet, 'Empty');
    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;

    await expect(extractXLSXQuestions(buffer)).rejects.toThrow(
      'XLSX conversion produced no content',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('surfaces refusal rather than swallowing it (B-INV-36 parity with PDF/DOCX)', async () => {
    const buffer = buildWorkbookBuffer({
      Questions: [['Question'], ['Describe your approach']],
    });
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber' },
      content: [],
      usage: { input_tokens: 5, output_tokens: 0 },
    });

    await expect(extractXLSXQuestions(buffer)).rejects.toThrow();
  });
});
