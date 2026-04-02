import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { generateBidXlsx } from '@/lib/bid/bid-export-xlsx';
import type {
  ExportBidMetadata,
  ExportQuestion,
} from '@/lib/bid/bid-export-types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeMetadata(
  overrides: Partial<ExportBidMetadata> = {},
): ExportBidMetadata {
  return {
    bid_name: 'IT Support Services',
    buyer: 'NHS Greater Manchester',
    reference_number: 'NHS-GM-2026-001',
    deadline: '2026-04-15T17:00:00Z',
    status: 'in_review',
    estimated_value: '£250,000',
    notes: null,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<ExportQuestion> = {}): ExportQuestion {
  return {
    question_id: 'q-001',
    section_name: 'Technical Capability',
    section_sequence: 1,
    question_sequence: 1,
    question_text: 'Describe your approach to data encryption.',
    word_limit: 500,
    evaluation_weight: 15,
    confidence_posture: 'strong_match',
    status: 'complete',
    response_text:
      '<p>Our approach to data encryption involves AES-256 for data at rest.</p>',
    response_text_advanced: null,
    review_status: 'approved',
    citations: [
      {
        source_index: 1,
        source_title: 'Information Security Policy',
        source_id: 'ci-001',
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: load workbook from buffer
// ---------------------------------------------------------------------------

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateBidXlsx', () => {
  it('should generate a non-zero Buffer with full data', async () => {
    const buffer = await generateBidXlsx(makeMetadata(), [makeQuestion()]);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('should produce a valid ZIP file (PK magic bytes)', async () => {
    const buffer = await generateBidXlsx(makeMetadata(), [makeQuestion()]);

    // XLSX is a ZIP container — first two bytes are 0x50 0x4B ("PK")
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it('should produce two worksheets by default (Bid Responses + Summary)', async () => {
    const buffer = await generateBidXlsx(makeMetadata(), [makeQuestion()]);
    const workbook = await loadWorkbook(buffer);

    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toEqual(['Bid Responses', 'Summary']);
  });

  it('should produce one worksheet when includeSummary is false', async () => {
    const buffer = await generateBidXlsx(makeMetadata(), [makeQuestion()], {
      includeSummary: false,
    });
    const workbook = await loadWorkbook(buffer);

    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toEqual(['Bid Responses']);
  });

  it('should exclude unanswered questions when includeUnanswered is false', async () => {
    const questions = [
      makeQuestion({ question_sequence: 1, response_text: '<p>Answer</p>' }),
      makeQuestion({
        question_sequence: 2,
        response_text: null,
        review_status: null,
        status: 'not_started',
      }),
      makeQuestion({ question_sequence: 3, response_text: '<p>Another</p>' }),
    ];

    const buffer = await generateBidXlsx(makeMetadata(), questions, {
      includeUnanswered: false,
    });
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Bid Responses')!;

    // 1 header row + 2 data rows (the unanswered question is excluded)
    expect(sheet.rowCount).toBe(3);
  });

  it('should have 10 columns in the header row', async () => {
    const buffer = await generateBidXlsx(makeMetadata(), [makeQuestion()]);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Bid Responses')!;
    const headerRow = sheet.getRow(1);

    // Count non-empty cells in header row
    let columnCount = 0;
    headerRow.eachCell(() => {
      columnCount++;
    });

    expect(columnCount).toBe(10);
  });

  it('should have data row count matching question count', async () => {
    const questions = [
      makeQuestion({ question_sequence: 1 }),
      makeQuestion({ question_sequence: 2 }),
      makeQuestion({ question_sequence: 3 }),
    ];

    const buffer = await generateBidXlsx(makeMetadata(), questions);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Bid Responses')!;

    // 1 header + 3 data rows
    expect(sheet.rowCount).toBe(4);
  });

  it('should calculate compliance percentage under word limit', async () => {
    // "AES-256 for data at rest" — roughly 13 words from HTML strip
    // word_limit is 500, so compliance should be well under 100%
    const question = makeQuestion({
      response_text:
        '<p>Our approach to data encryption involves AES-256 for data at rest.</p>',
      word_limit: 500,
    });

    const buffer = await generateBidXlsx(makeMetadata(), [question]);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Bid Responses')!;
    const complianceCell = sheet.getRow(2).getCell(7); // Column G, row 2

    const value = String(complianceCell.value);
    // Should end with % and be a number less than 100
    expect(value).toMatch(/^\d+%$/);
    const pct = parseInt(value.replace('%', ''), 10);
    expect(pct).toBeLessThan(100);
  });

  it('should show compliance over 100% when response exceeds word limit', async () => {
    // Create a response that exceeds a low word limit
    const longResponse = '<p>' + 'word '.repeat(60) + '</p>';
    const question = makeQuestion({
      response_text: longResponse,
      word_limit: 10,
    });

    const buffer = await generateBidXlsx(makeMetadata(), [question]);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Bid Responses')!;
    const complianceCell = sheet.getRow(2).getCell(7);

    const value = String(complianceCell.value);
    expect(value).toMatch(/^\d+%$/);
    const pct = parseInt(value.replace('%', ''), 10);
    expect(pct).toBeGreaterThan(100);
  });

  it('should show "N/A" for compliance when there is no word limit', async () => {
    const question = makeQuestion({ word_limit: null });

    const buffer = await generateBidXlsx(makeMetadata(), [question]);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Bid Responses')!;
    const complianceCell = sheet.getRow(2).getCell(7);

    expect(String(complianceCell.value)).toBe('N/A');
  });

  it('should format status "ai_drafted" as "AI Drafted"', async () => {
    const question = makeQuestion({
      review_status: 'ai_drafted',
      status: 'in_progress',
    });

    const buffer = await generateBidXlsx(makeMetadata(), [question]);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Bid Responses')!;
    const statusCell = sheet.getRow(2).getCell(8); // Column H

    expect(String(statusCell.value)).toBe('AI Drafted');
  });

  it('should format confidence "strong_match" as "Strong Match"', async () => {
    const question = makeQuestion({ confidence_posture: 'strong_match' });

    const buffer = await generateBidXlsx(makeMetadata(), [question]);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Bid Responses')!;
    const confidenceCell = sheet.getRow(2).getCell(9); // Column I

    expect(String(confidenceCell.value)).toBe('Strong Match');
  });

  it('should fall back to "General Questions" for null section_name', async () => {
    const question = makeQuestion({
      section_name: null as unknown as string,
    });

    const buffer = await generateBidXlsx(makeMetadata(), [question]);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Bid Responses')!;
    const sectionCell = sheet.getRow(2).getCell(1); // Column A

    expect(String(sectionCell.value)).toBe('General Questions');
  });

  it('should produce correct summary statistics', async () => {
    const questions = [
      makeQuestion({
        question_sequence: 1,
        review_status: 'approved',
        response_text: '<p>Done</p>',
        confidence_posture: 'strong_match',
      }),
      makeQuestion({
        question_sequence: 2,
        review_status: 'ai_drafted',
        response_text: '<p>AI drafted</p>',
        confidence_posture: 'partial_match',
      }),
      makeQuestion({
        question_sequence: 3,
        review_status: null,
        response_text: null,
        status: 'not_started',
        confidence_posture: 'no_content',
      }),
      makeQuestion({
        question_sequence: 4,
        review_status: 'needs_review',
        response_text: '<p>Needs review</p>',
        confidence_posture: 'needs_sme',
      }),
    ];

    const buffer = await generateBidXlsx(makeMetadata(), questions);
    const workbook = await loadWorkbook(buffer);
    const summarySheet = workbook.getWorksheet('Summary')!;

    // Helper to find a row by its label in column A
    const findRow = (label: string): ExcelJS.Row | undefined => {
      let found: ExcelJS.Row | undefined;
      summarySheet.eachRow((row) => {
        if (String(row.getCell(1).value) === label) {
          found = row;
        }
      });
      return found;
    };

    // Response statistics
    expect(findRow('Total Questions')?.getCell(2).value).toBe(4);
    expect(findRow('Responses Completed')?.getCell(2).value).toBe(1); // only approved
    expect(findRow('AI Drafted')?.getCell(2).value).toBe(1);
    expect(findRow('Not Started')?.getCell(2).value).toBe(1);
    expect(findRow('Needs Review')?.getCell(2).value).toBe(1);

    // Confidence breakdown
    expect(findRow('Strong Match')?.getCell(2).value).toBe(1);
    expect(findRow('Partial Match')?.getCell(2).value).toBe(1);
    expect(findRow('Needs SME')?.getCell(2).value).toBe(1);
    expect(findRow('No Content')?.getCell(2).value).toBe(1);
  });

  it('should produce a valid XLSX with header row only when given empty questions', async () => {
    const buffer = await generateBidXlsx(makeMetadata(), []);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Bid Responses')!;

    // Only the header row should be present
    expect(sheet.rowCount).toBe(1);

    // Verify it is still a valid buffer
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it('should use advanced response text when useAdvancedVariant is true', async () => {
    const question = makeQuestion({
      response_text: '<p>Standard version</p>',
      response_text_advanced: '<p>Advanced version with more detail</p>',
    });

    const bufferStandard = await generateBidXlsx(makeMetadata(), [question], {
      useAdvancedVariant: false,
    });
    const bufferAdvanced = await generateBidXlsx(makeMetadata(), [question], {
      useAdvancedVariant: true,
    });

    const wbStandard = await loadWorkbook(bufferStandard);
    const wbAdvanced = await loadWorkbook(bufferAdvanced);

    const standardResponse = String(
      wbStandard.getWorksheet('Bid Responses')!.getRow(2).getCell(4).value,
    );
    const advancedResponse = String(
      wbAdvanced.getWorksheet('Bid Responses')!.getRow(2).getCell(4).value,
    );

    expect(standardResponse).toContain('Standard version');
    expect(advancedResponse).toContain('Advanced version with more detail');
  });

  it('should format deadline as DD/MM/YYYY in summary sheet', async () => {
    const buffer = await generateBidXlsx(
      makeMetadata({ deadline: '2026-04-15T17:00:00Z' }),
      [makeQuestion()],
    );
    const workbook = await loadWorkbook(buffer);
    const summarySheet = workbook.getWorksheet('Summary')!;

    // Find the Deadline row
    let deadlineValue: string | undefined;
    summarySheet.eachRow((row) => {
      if (String(row.getCell(1).value) === 'Deadline') {
        deadlineValue = String(row.getCell(2).value);
      }
    });

    expect(deadlineValue).toBe('15/04/2026');
  });
});
