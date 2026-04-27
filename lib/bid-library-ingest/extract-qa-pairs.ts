/**
 * TS port of scripts/extract_docx_tables.py — markdown-emitting Q&A pair
 * extractor for DOCX bid library documents.
 *
 * Extracts Q&A pairs from Word tables, converting cell content to GFM markdown
 * via the two-step mammoth HTML -> Turndown pipeline. Supports the same three
 * table formats as the Python extractor:
 *   - Pattern A: 6-col audit format (No, Section, Question, Standard, Advanced, Notes)
 *   - Pattern B: 5-col DRAFT format (No, Section, Question, Standard, Notes)
 *   - Pattern C: 6-col numbered format (No, Question, Standard, Advanced, Section, Notes)
 *   - Positional fallback: 5-col and 6-col with all-empty headers
 *
 * This is consumed by EP8 (Q&A .docx import UI). Parity with the Python
 * extractor is enforced by __tests__/lib/bid-library-ingest/parity.integration.test.ts.
 *
 * Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md ss4.4, ss6.3.
 */

import mammoth from 'mammoth';
import { htmlToMarkdown } from './docx-to-markdown';

// ── Header normalisation ────────────────────────────────────────────────

/**
 * Map of common header text variants to canonical names.
 * Mirrors _HEADER_MAP in scripts/extract_docx_tables.py.
 */
const HEADER_MAP: Record<string, string> = {
  // Question columns
  question: 'question',
  questions: 'question',
  query: 'question',
  requirement: 'question',
  requirements: 'question',
  'suggested questions': 'question',
  // Standard response columns
  'standard response': 'standard',
  'standard answer': 'standard',
  standard: 'standard',
  response: 'standard',
  answer: 'standard',
  'answer for standard audit system': 'standard',
  'answer for standard audits': 'standard',
  'standard configuration answer': 'standard',
  // Advanced response columns
  'advanced response': 'advanced',
  'advanced answer': 'advanced',
  advanced: 'advanced',
  'enhanced response': 'advanced',
  'enhanced answer': 'advanced',
  'answer for advanced audits': 'advanced',
  'advanced audits answer': 'advanced',
  // Section columns
  section: 'section',
  category: 'section',
  topic: 'section',
  area: 'section',
  // Number columns
  no: 'number',
  'no.': 'number',
  '#': 'number',
  number: 'number',
  ref: 'number',
  id: 'number',
  // Notes columns
  notes: 'notes',
  comments: 'notes',
  note: 'notes',
  comment: 'notes',
  // Standard Selection Questionnaire (PPN 03/24) columns
  'supplier information': 'section',
  'supplier name': 'question',
  'contact name': 'question',
  'contact details': 'question',
  'registered address': 'question',
  'company registration number': 'question',
  'trading status': 'question',
  'date of registration': 'question',
  sme: 'question',
  'company size': 'question',
  'exclusion grounds': 'section',
  'grounds for mandatory exclusion': 'section',
  'grounds for discretionary exclusion': 'section',
  'mandatory exclusion': 'section',
  'discretionary exclusion': 'section',
  'self-cleaning': 'question',
  'selection questions': 'section',
  'economic and financial standing': 'section',
  'technical and professional ability': 'section',
  'modern slavery': 'section',
  'health and safety': 'section',
  'environmental management': 'section',
  'quality management': 'section',
  'carbon reduction': 'section',
  steel: 'section',
  'additional conditions of participation': 'section',
  declaration: 'question',
  statement: 'question',
  evidence: 'question',
  details: 'question',
  description: 'question',
  'please provide': 'question',
  'please confirm': 'question',
  'please describe': 'question',
  'please state': 'question',
  'please detail': 'question',
  'please give details': 'question',
  'supplier response': 'standard',
  'your response': 'standard',
  'your answer': 'standard',
  'tenderer response': 'standard',
  "tenderer's response": 'standard',
  'bidder response': 'standard',
  "bidder's response": 'standard',
  'contractor response': 'standard',
  'applicant response': 'standard',
  "applicant's response": 'standard',
  'organisation response': 'standard',
  guidance: 'notes',
  'guidance notes': 'notes',
  instructions: 'notes',
  'max score': 'notes',
  weighting: 'notes',
  scoring: 'notes',
  'max marks': 'notes',
  'pass/fail': 'notes',
};

/**
 * Normalise a table header cell to a canonical name.
 * Mirrors normalize_header() in scripts/extract_docx_tables.py.
 */
export function normaliseHeader(text: string): string {
  let cleaned = text.trim().toLowerCase();
  // Remove trailing punctuation
  cleaned = cleaned.replace(/[:\-_]+$/, '').trim();
  return HEADER_MAP[cleaned] ?? cleaned;
}

// ── Text deduplication ──────────────────────────────────────────────────

/**
 * Remove repeated text runs from a string.
 * Mirrors deduplicate_repeated_text() in scripts/extract_docx_tables.py.
 */
export function deduplicateRepeatedText(text: string): string {
  if (text.length < 6) return text;

  for (let length = Math.floor(text.length / 2); length > 2; length--) {
    const prefix = text.slice(0, length);
    if (
      text.length % length === 0 &&
      text === prefix.repeat(text.length / length)
    ) {
      return prefix.trim();
    }
  }

  return text;
}

// ── Table format detection ──────────────────────────────────────────────

type TableFormat =
  | 'audit_6col'
  | 'draft_5col'
  | 'numbered_6col'
  | 'positional_5col'
  | 'positional_6col';

/**
 * Infer canonical names for empty header columns.
 * Mirrors _infer_empty_headers() in scripts/extract_docx_tables.py.
 */
function inferEmptyHeaders(headers: string[]): string[] {
  const normalised = headers.map((h) => normaliseHeader(h));

  if (!normalised.length || normalised[0] !== 'question') {
    return normalised;
  }

  const emptyIndices = normalised
    .slice(1)
    .map((n, i) => (n === '' ? i + 1 : -1))
    .filter((i) => i !== -1);

  if (!emptyIndices.length) return normalised;

  const result = [...normalised];
  if (emptyIndices.length >= 1) result[emptyIndices[0]] = 'standard';
  if (emptyIndices.length >= 2) result[emptyIndices[1]] = 'advanced';
  return result;
}

/**
 * Detect the table format from header names.
 * Mirrors detect_table_format() in scripts/extract_docx_tables.py.
 */
export function detectTableFormat(headers: string[]): TableFormat | null {
  let normalised = headers.map((h) => normaliseHeader(h));

  const hasQuestion = normalised.includes('question');
  let hasStandard = normalised.includes('standard');
  let hasAdvanced = normalised.includes('advanced');
  const hasSection = normalised.includes('section');
  const hasNumber = normalised.includes('number');

  // Try inferring empty headers if we have question but no standard
  if (hasQuestion && !hasStandard) {
    normalised = inferEmptyHeaders(headers);
    hasStandard = normalised.includes('standard');
    hasAdvanced = normalised.includes('advanced');
  }

  if (!hasQuestion || !hasStandard) {
    // Positional fallback
    const allEmpty = headers.every((h) => h.trim() === '');
    if (allEmpty || (!hasQuestion && !hasStandard)) {
      const colCount = headers.length;
      if (colCount === 5) return 'positional_5col';
      if (colCount >= 6) return 'positional_6col';
    }
    return null;
  }

  const colCount = normalised.length;

  if (colCount >= 6 && hasAdvanced && hasSection && hasNumber) {
    const qIdx = normalised.indexOf('question');
    const sIdx = normalised.indexOf('section');
    if (sIdx < qIdx) {
      return 'audit_6col'; // Pattern A: section before question
    }
    return 'numbered_6col'; // Pattern C: section after question
  }

  if (colCount >= 5 && hasSection && hasNumber && !hasAdvanced) {
    return 'draft_5col'; // Pattern B: no advanced column
  }

  // Fallback: if we have question + standard
  if (hasQuestion && hasStandard) {
    return hasAdvanced ? 'audit_6col' : 'draft_5col';
  }

  return null;
}

// ── Q&A pair type ───────────────────────────────────────────────────────

/** A single Q&A pair extracted from a DOCX table. */
export interface QaPair {
  /** The question text (plain text, not markdown) */
  questionText: string;
  /** The standard answer (GFM markdown) */
  answerStandard: string;
  /** The advanced answer (GFM markdown), empty string if not present */
  answerAdvanced: string;
  /** Section name from heading or table column */
  sectionName: string;
  /** Source filename for provenance */
  sourceFile: string;
  /** Index of the table in the document */
  tableIndex: number;
  /** Index of the row in the table */
  rowIndex: number;
}

// ── HTML table parsing ──────────────────────────────────────────────────

/**
 * Parse an HTML table into rows of cell HTML strings.
 *
 * Uses simple regex-based extraction since mammoth produces clean, predictable
 * HTML output (no nested tables, no complex attributes). Each cell's inner
 * HTML is preserved for per-cell Turndown conversion.
 */
function parseHtmlTable(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trPattern.exec(tableHtml)) !== null) {
    const rowHtml = trMatch[1];
    const cells: string[] = [];
    const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellPattern.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  return rows;
}

/**
 * Extract text content from an HTML cell (strip tags).
 * Used for header detection where we need plain text.
 */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * Extract all HTML tables from a mammoth HTML document.
 * Returns each <table>...</table> as a separate string.
 */
function extractHtmlTables(html: string): string[] {
  const tables: string[] = [];
  const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let match: RegExpExecArray | null;

  while ((match = tablePattern.exec(html)) !== null) {
    tables.push(match[0]);
  }
  return tables;
}

/**
 * Extract section headings from HTML before each table.
 *
 * Returns a map of table index -> preceding heading text, mirroring the
 * Python extractor's heading-walking behaviour.
 */
function extractHeadingsBeforeTables(html: string): Map<number, string> {
  const headingMap = new Map<number, string>();
  let currentHeading = '';
  let tableIndex = 0;

  // Match h1-h6 or table tags
  const pattern = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>|<table[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    if (match[1]) {
      // This is a heading
      let headingText = stripHtmlTags(match[2]);
      if (headingText.includes('\n')) {
        headingText = headingText.split('\n')[0].trim();
      }
      headingText = deduplicateRepeatedText(headingText);
      if (headingText) {
        currentHeading = headingText;
      }
    } else {
      // This is a table
      headingMap.set(tableIndex, currentHeading);
      tableIndex++;
    }
  }

  return headingMap;
}

/**
 * Extract Q&A pairs from a single HTML table.
 */
function extractQaFromHtmlTable(
  tableHtml: string,
  sectionName: string,
  tableIndex: number,
  sourceFile: string,
): QaPair[] {
  const rows = parseHtmlTable(tableHtml);
  if (rows.length < 2) return []; // Need header + at least one data row

  // Extract header row as plain text
  const headerTexts = rows[0].map(stripHtmlTags);

  const fmt = detectTableFormat(headerTexts);
  if (fmt === null) return [];

  // Determine column indices
  let qIdx: number | null = null;
  let stdIdx: number | null = null;
  let advIdx: number | null = null;
  let secIdx: number | null = null;
  let dataStart = 1;

  if (fmt === 'positional_5col') {
    qIdx = 0;
    stdIdx = 1;
    advIdx = null;
    secIdx = null;
    dataStart = 0;
  } else if (fmt === 'positional_6col') {
    qIdx = 0;
    stdIdx = 1;
    advIdx = 2;
    secIdx = null;
    dataStart = 0;
  } else {
    const normalisedHeaders = inferEmptyHeaders(headerTexts);
    const colMap: Record<string, number> = {};
    for (let idx = 0; idx < normalisedHeaders.length; idx++) {
      const name = normalisedHeaders[idx];
      if (!(name in colMap)) {
        colMap[name] = idx;
      }
    }
    qIdx = colMap['question'] ?? null;
    stdIdx = colMap['standard'] ?? null;
    advIdx = colMap['advanced'] ?? null;
    secIdx = colMap['section'] ?? null;
  }

  if (qIdx === null || stdIdx === null) return [];

  const pairs: QaPair[] = [];
  for (let rowNum = dataStart; rowNum < rows.length; rowNum++) {
    const cells = rows[rowNum];

    if (cells.length <= Math.max(qIdx, stdIdx)) continue;

    const questionHtml = cells[qIdx];
    const questionText = stripHtmlTags(questionHtml).trim();

    // Skip empty question rows
    if (!questionText) continue;

    // Convert answer cells to markdown (per-cell Turndown)
    const standardHtml = cells[stdIdx];
    const answerStandard = htmlToMarkdown(standardHtml);

    let answerAdvanced = '';
    if (advIdx !== null && advIdx < cells.length) {
      answerAdvanced = htmlToMarkdown(cells[advIdx]);
    }

    // Use section from column if present, otherwise heading-based section
    let rowSection = sectionName;
    if (secIdx !== null && secIdx < cells.length) {
      const cellSection = stripHtmlTags(cells[secIdx]).trim();
      if (cellSection) {
        rowSection = cellSection;
      }
    }

    pairs.push({
      questionText,
      answerStandard,
      answerAdvanced,
      sectionName: rowSection,
      sourceFile,
      tableIndex,
      rowIndex: rowNum,
    });
  }

  return pairs;
}

// ── Main extraction ─────────────────────────────────────────────────────

/**
 * Extract all Q&A pairs from a DOCX file buffer.
 *
 * Converts the DOCX to HTML via mammoth, then parses table structures and
 * applies per-cell Turndown markdown conversion. This is the TS-side
 * equivalent of Python's `extract_qa_from_docx()`.
 *
 * @param buffer - The DOCX file as a Buffer or ArrayBuffer
 * @param sourceFile - The source filename for provenance metadata
 * @returns Array of Q&A pairs with markdown-formatted answer fields
 */
export async function extractQaPairs(
  buffer: Buffer | ArrayBuffer,
  sourceFile: string = '',
): Promise<QaPair[]> {
  // Step 1: Convert DOCX to HTML via mammoth
  const input = Buffer.isBuffer(buffer) ? { buffer } : { arrayBuffer: buffer };
  const { value: html } = await mammoth.convertToHtml(input);

  // Step 2: Extract heading context for each table
  const headingMap = extractHeadingsBeforeTables(html);

  // Step 3: Extract all tables from the HTML
  const tables = extractHtmlTables(html);

  // Step 4: Extract Q&A pairs from each table
  const allPairs: QaPair[] = [];
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const sectionName = headingMap.get(tableIndex) ?? '';
    const pairs = extractQaFromHtmlTable(
      tables[tableIndex],
      sectionName,
      tableIndex,
      sourceFile,
    );
    allPairs.push(...pairs);
  }

  return allPairs;
}
