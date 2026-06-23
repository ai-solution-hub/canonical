/**
 * Excel workbook generation for bid response export.
 *
 * Generates a styled .xlsx with a responses sheet and a summary sheet.
 * Uses the `exceljs` package (v4.4.0) with server-side writeBuffer().
 *
 * @module bid-export-xlsx
 */

import ExcelJS from 'exceljs';
import { format } from 'date-fns';
import { enGB } from 'date-fns/locale';
import { countWords, wordCountPercentage } from '@/lib/editor-utils';
import { stripMarkdown } from '@/lib/content/strip-markdown';
import { BRANDING } from '@/lib/client-config';
import type {
  ExportQuestion,
  ExportProcurementMetadata,
  XlsxExportOptions,
} from '@/lib/domains/procurement/procurement-export-types';

// ---------------------------------------------------------------------------
// Constants — styling
// ---------------------------------------------------------------------------

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern' as const,
  pattern: 'solid',
  fgColor: { argb: 'FF1E408A' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  name: 'Calibri',
  size: 11,
  bold: true,
  color: { argb: 'FFFFFFFF' },
};

const DATA_FONT: Partial<ExcelJS.Font> = {
  name: 'Calibri',
  size: 10,
};

const ALT_ROW_FILL: ExcelJS.Fill = {
  type: 'pattern' as const,
  pattern: 'solid',
  fgColor: { argb: 'FFF9FAFB' },
};

// ---------------------------------------------------------------------------
// Status and confidence label formatters
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not Started',
  ai_drafted: 'AI Drafted',
  in_progress: 'In Progress',
  needs_review: 'Needs Review',
  complete: 'Complete',
  draft: 'Draft',
  edited: 'Edited',
  approved: 'Approved',
  in_review: 'In Review',
  ready_for_export: 'Ready for Export',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  strong_match: 'Strong Match',
  partial_match: 'Partial Match',
  needs_sme: 'Needs SME',
  no_content: 'No Content',
};

function formatStatus(status: string): string {
  return STATUS_LABELS[status] || status;
}

function formatConfidence(posture: string | null): string {
  return posture ? CONFIDENCE_LABELS[posture] || posture : '--';
}

// ---------------------------------------------------------------------------
// Conditional formatting helpers
// ---------------------------------------------------------------------------

function getComplianceFill(percentage: number): ExcelJS.Fill {
  if (percentage > 100) {
    // Light red — over word limit
    return {
      type: 'pattern' as const,
      pattern: 'solid',
      fgColor: { argb: 'FFFEE2E2' },
    };
  }
  if (percentage >= 80) {
    // Light green — within acceptable range
    return {
      type: 'pattern' as const,
      pattern: 'solid',
      fgColor: { argb: 'FFDCFCE7' },
    };
  }
  // Light amber — below 80% of word limit
  return {
    type: 'pattern' as const,
    pattern: 'solid',
    fgColor: { argb: 'FFFEF3C7' },
  };
}

function getStatusFill(status: string | null): ExcelJS.Fill {
  switch (status) {
    case 'approved':
    case 'complete':
      return {
        type: 'pattern' as const,
        pattern: 'solid',
        fgColor: { argb: 'FFDCFCE7' },
      };
    case 'needs_review':
      return {
        type: 'pattern' as const,
        pattern: 'solid',
        fgColor: { argb: 'FFFEF3C7' },
      };
    case 'not_started':
    case null:
      return {
        type: 'pattern' as const,
        pattern: 'solid',
        fgColor: { argb: 'FFFEE2E2' },
      };
    default:
      return {
        type: 'pattern' as const,
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFFF' },
      };
  }
}

function getConfidenceFill(posture: string | null): ExcelJS.Fill {
  switch (posture) {
    case 'strong_match':
      return {
        type: 'pattern' as const,
        pattern: 'solid',
        fgColor: { argb: 'FFDCFCE7' },
      };
    case 'partial_match':
      return {
        type: 'pattern' as const,
        pattern: 'solid',
        fgColor: { argb: 'FFFEF3C7' },
      };
    case 'needs_sme':
      return {
        type: 'pattern' as const,
        pattern: 'solid',
        fgColor: { argb: 'FFDBEAFE' },
      };
    case 'no_content':
      return {
        type: 'pattern' as const,
        pattern: 'solid',
        fgColor: { argb: 'FFF3F4F6' },
      };
    default:
      return {
        type: 'pattern' as const,
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFFF' },
      };
  }
}

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

/**
 * Build the "Procurement Responses" worksheet with all question data.
 *
 * 10 columns: Section, Q#, Question, Response, Word Count, Word Limit,
 * Compliance, Status, Confidence, Weight (%).
 */
function buildResponsesSheet(
  workbook: ExcelJS.Workbook,
  questions: ExportQuestion[],
  useAdvancedVariant: boolean,
): void {
  const sheet = workbook.addWorksheet('Procurement Responses');

  // Column definitions
  sheet.columns = [
    { header: 'Section', key: 'section', width: 25 },
    { header: 'Q#', key: 'questionNumber', width: 8 },
    { header: 'Question', key: 'question', width: 60 },
    { header: 'Response', key: 'response', width: 80 },
    { header: 'Word Count', key: 'wordCount', width: 14 },
    { header: 'Word Limit', key: 'wordLimit', width: 14 },
    { header: 'Compliance', key: 'compliance', width: 14 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Confidence', key: 'confidence', width: 16 },
    { header: 'Weight (%)', key: 'weight', width: 12 },
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // Add data rows
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const responseMarkdown = useAdvancedVariant
      ? q.response_text_advanced || q.response_text
      : q.response_text;
    const plainText = responseMarkdown ? stripMarkdown(responseMarkdown) : '';
    const wordCount = countWords(plainText);
    const compliance = q.word_limit
      ? wordCountPercentage(wordCount, q.word_limit)
      : null;

    const row = sheet.addRow({
      section: q.section_name || 'General Questions',
      questionNumber: q.question_sequence,
      question: q.question_text,
      response: plainText || '[No response]',
      wordCount,
      wordLimit: q.word_limit ?? '--',
      compliance: compliance !== null ? `${compliance}%` : 'N/A',
      status: formatStatus(q.review_status || q.status),
      confidence: formatConfidence(q.confidence_posture),
      weight: q.evaluation_weight ?? '--',
    });

    // Apply data font and vertical-top with text wrap
    row.eachCell((cell) => {
      cell.font = DATA_FONT;
      cell.alignment = { vertical: 'top', wrapText: true };
    });

    // Centre-align numeric and short-text columns (B, E, F, G, H, I, J)
    const centreColumns = [2, 5, 6, 7, 8, 9, 10];
    for (const colNum of centreColumns) {
      row.getCell(colNum).alignment = {
        horizontal: 'center',
        vertical: 'top',
        wrapText: colNum === 8 || colNum === 9, // Wrap status and confidence
      };
    }

    // Alternating row fill
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = ALT_ROW_FILL;
      });
    }

    // Conditional formatting: compliance column (G)
    const complianceCell = row.getCell(7);
    if (compliance !== null) {
      complianceCell.fill = getComplianceFill(compliance);
    }

    // Conditional formatting: status column (H)
    const statusCell = row.getCell(8);
    statusCell.fill = getStatusFill(q.review_status || q.status);

    // Conditional formatting: confidence column (I)
    const confidenceCell = row.getCell(9);
    confidenceCell.fill = getConfidenceFill(q.confidence_posture);
  }

  // Auto-filter across all columns
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: questions.length + 1, column: 10 },
  };

  // Freeze header row and section column
  sheet.views = [
    {
      state: 'frozen',
      xSplit: 1,
      ySplit: 1,
      topLeftCell: 'B2',
      activeCell: 'B2',
    },
  ];
}

/**
 * Build the "Summary" worksheet with bid metadata and response statistics.
 */
function buildSummarySheet(
  workbook: ExcelJS.Workbook,
  metadata: ExportProcurementMetadata,
  questions: ExportQuestion[],
): void {
  const sheet = workbook.addWorksheet('Summary');
  sheet.getColumn(1).width = 25;
  sheet.getColumn(2).width = 40;

  // Title row (row 1)
  const titleRow = sheet.addRow(['Procurement Export Summary']);
  titleRow.getCell(1).font = {
    name: 'Calibri',
    size: 16,
    bold: true,
    color: { argb: 'FF1E408A' },
  };
  sheet.mergeCells('A1:B1');

  // Spacer row (row 2)
  sheet.addRow([]);

  // Procurement metadata (rows 3–8)
  const metaRows: [string, string][] = [
    ['Procurement Title', metadata.bid_name],
    ['Buyer', metadata.buyer],
    ['Reference', metadata.reference_number || '--'],
    [
      'Deadline',
      metadata.deadline
        ? format(new Date(metadata.deadline), 'dd/MM/yyyy', { locale: enGB })
        : '--',
    ],
    ['Status', formatStatus(metadata.status)],
    ['Generated', format(new Date(), 'dd/MM/yyyy HH:mm', { locale: enGB })],
  ];

  for (const [label, value] of metaRows) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { name: 'Calibri', size: 11, bold: true };
    row.getCell(2).font = { name: 'Calibri', size: 11 };
  }

  // Spacer row (row 9)
  sheet.addRow([]);

  // Response statistics heading (row 10)
  const statsTitle = sheet.addRow(['Response Statistics']);
  statsTitle.getCell(1).font = { name: 'Calibri', size: 14, bold: true };
  sheet.mergeCells(`A${statsTitle.number}:B${statsTitle.number}`);

  // Calculate statistics
  const totalQuestions = questions.length;
  const responsesCompleted = questions.filter(
    (q) => q.review_status === 'approved' || q.review_status === 'edited',
  ).length;
  const aiDrafted = questions.filter(
    (q) => q.review_status === 'ai_drafted',
  ).length;
  const notStarted = questions.filter((q) => q.response_text === null).length;
  const needsReview = questions.filter(
    (q) => q.review_status === 'needs_review',
  ).length;

  // Statistics rows (rows 11–15)
  const statsRows: [string, number][] = [
    ['Total Questions', totalQuestions],
    ['Responses Completed', responsesCompleted],
    ['AI Drafted', aiDrafted],
    ['Not Started', notStarted],
    ['Needs Review', needsReview],
  ];

  for (const [label, value] of statsRows) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { name: 'Calibri', size: 11, bold: true };
    row.getCell(2).font = { name: 'Calibri', size: 11 };
    row.getCell(2).alignment = { horizontal: 'left' };
  }

  // Spacer row (row 16)
  sheet.addRow([]);

  // Confidence breakdown heading (row 17)
  const confTitle = sheet.addRow(['Confidence Breakdown']);
  confTitle.getCell(1).font = { name: 'Calibri', size: 14, bold: true };
  sheet.mergeCells(`A${confTitle.number}:B${confTitle.number}`);

  // Count confidence postures
  const confCounts: Record<string, number> = {
    'Strong Match': 0,
    'Partial Match': 0,
    'Needs SME': 0,
    'No Content': 0,
  };

  for (const q of questions) {
    const label = formatConfidence(q.confidence_posture);
    if (label in confCounts) {
      confCounts[label]++;
    }
  }

  // Confidence rows (rows 18–21)
  for (const [label, count] of Object.entries(confCounts)) {
    const row = sheet.addRow([label, count]);
    row.getCell(1).font = { name: 'Calibri', size: 11, bold: true };
    row.getCell(2).font = { name: 'Calibri', size: 11 };
    row.getCell(2).alignment = { horizontal: 'left' };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate an Excel workbook Buffer from bid data.
 *
 * @param metadata - Procurement metadata for summary sheet
 * @param questions - Array of questions with responses
 * @param options - Export configuration
 * @returns Buffer containing the .xlsx file
 */
export async function generateProcurementXlsx(
  metadata: ExportProcurementMetadata,
  questions: ExportQuestion[],
  options: XlsxExportOptions = {},
): Promise<Buffer> {
  const {
    includeSummary = true,
    includeUnanswered = true,
    useAdvancedVariant = false,
  } = options;

  const exportQuestions = includeUnanswered
    ? questions
    : questions.filter((q) => q.response_text !== null);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = BRANDING.productName;
  workbook.created = new Date();

  // Sheet 1: Procurement Responses
  buildResponsesSheet(workbook, exportQuestions, useAdvancedVariant);

  // Sheet 2: Summary (optional)
  if (includeSummary) {
    buildSummarySheet(workbook, metadata, exportQuestions);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
