/**
 * Q&A pair detection engine for uploaded documents.
 *
 * Detects Q&A pairs in mammoth HTML output using four strategies:
 *   1. Table extraction — HTML tables with recognisable Q/A column headers
 *   2. Numbered list extraction — "Q1: ... A1: ..." or "1. Question\nAnswer" patterns
 *   3. Heading-paragraph extraction — headings that are questions followed by answer paragraphs
 *   4. Text fallback — "Q: ... A: ..." and "Question: ... Answer: ..." markers
 *      (delegates to extractStructuredPairs from document-diff.ts)
 *
 * This module is deterministic (no AI calls) and operates on HTML strings.
 * It ports header normalisation logic from the Python pipeline
 * (`scripts/extract_docx_tables.py`) to TypeScript.
 *
 * Phase 1 of the Q&A Auto-Split spec.
 */

import { parse as parseHTML, type HTMLElement } from 'node-html-parser';
import {
  stringSimilarity,
  extractStructuredPairs,
} from '@/lib/source-documents/document-diff';

// ---------------------------------------------------------------------------
// Public types — exported for Phase 2/3 consumption
// ---------------------------------------------------------------------------

/** Source strategy that detected the Q&A pair. */
export type DetectionSource = 'table' | 'list' | 'heading' | 'text';

/** Confidence level for a detected pair. */
export type DetectionConfidence = 'high' | 'medium' | 'low';

/**
 * A single detected Q&A pair with metadata about how it was found.
 */
export interface DetectedQAPair {
  /** The question text, cleaned and trimmed. */
  question: string;
  /** The standard/primary answer text. */
  answer: string;
  /** Advanced/enhanced answer text, if present (from DOCX tables with dual answer columns). */
  answerAdvanced: string;
  /** Detection strategy that found this pair. */
  source: DetectionSource;
  /** Confidence level — table extraction is high, list/heading are medium. */
  confidence: DetectionConfidence;
  /** Section heading context from the document, if detected. */
  sectionName: string;
  /** Index of the table this pair came from (table source only). */
  tableIndex: number;
  /** Row index within the table (table source only). */
  rowIndex: number;
}

/**
 * Input format for creating content items from detected pairs.
 * Maps to the q_a_pair content type in the KB.
 *
 * Content shape (canonical per P0-BM Phase 3 spec ss4.1):
 *   "Q: {question}\n\n{answer}"
 * No `A:` prefix on the answer — position after the `Q:` line + `\n\n`
 * separator implies "answer" semantically.
 */
export interface QACreateInput {
  /** Title — the question text (truncated at word boundary to 120 chars). */
  title: string;
  /** Body — formatted as "Q: {question}\n\n{answer}". */
  content: string;
  /** Content type — always 'q_a_pair'. */
  contentType: 'q_a_pair';
  /** Section name from document headings, if detected. */
  sectionName: string;
  /** Advanced answer text, if present. */
  answerAdvanced: string;
  /** How this pair was detected. */
  source: DetectionSource;
  /** Detection confidence. */
  confidence: DetectionConfidence;
}

// ---------------------------------------------------------------------------
// Header normalisation — ported from Python _HEADER_MAP
// ---------------------------------------------------------------------------

/**
 * Canonical column types for Q&A table headers.
 *
 * Maps 60+ common header text variants to canonical names. Ported from
 * `scripts/extract_docx_tables.py` `_HEADER_MAP` dictionary.
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

  // Exclusion grounds
  'exclusion grounds': 'section',
  'grounds for mandatory exclusion': 'section',
  'grounds for discretionary exclusion': 'section',
  'mandatory exclusion': 'section',
  'discretionary exclusion': 'section',
  'self-cleaning': 'question',

  // Selection questions sections
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

  // Common SQ question-like headers
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

  // Common SQ response-like headers
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

  // Guidance/instruction columns (treat as notes)
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
 * Normalise a table header cell to a canonical column name.
 *
 * Strips whitespace, lowercases, removes trailing punctuation, and maps
 * known variants via HEADER_MAP. Returns the canonical name or the cleaned
 * text if no mapping is found.
 */
export function normaliseHeader(text: string): string {
  let cleaned = text.trim().toLowerCase();
  // Remove trailing punctuation (colons, hyphens, underscores)
  cleaned = cleaned.replace(/[:\-_]+$/, '').trim();
  return HEADER_MAP[cleaned] ?? cleaned;
}

// ---------------------------------------------------------------------------
// Table format detection — ported from Python detect_table_format
// ---------------------------------------------------------------------------

/** Recognised table format identifiers. */
/** @public */
export type TableFormat =
  | 'audit_6col'
  | 'draft_5col'
  | 'numbered_6col'
  | 'positional_5col'
  | 'positional_6col'
  | 'generic_qa';

/**
 * Infer canonical names for empty header columns.
 *
 * Some template files have "Question" in column 0 but empty strings in
 * columns 1-2 that actually contain standard/advanced answers. This
 * fills in those blanks by position.
 */
function inferEmptyHeaders(rawHeaders: string[]): string[] {
  const normalised = rawHeaders.map(normaliseHeader);

  // Only apply if column 0 is "question" and we have empty columns after it
  if (!normalised.length || normalised[0] !== 'question') {
    return normalised;
  }

  const emptyIndices = normalised
    .map((h, i) => (i > 0 && h === '' ? i : -1))
    .filter((i) => i >= 0);

  if (emptyIndices.length === 0) return normalised;

  const result = [...normalised];
  if (emptyIndices.length >= 1) result[emptyIndices[0]] = 'standard';
  if (emptyIndices.length >= 2) result[emptyIndices[1]] = 'advanced';
  return result;
}

/**
 * Detect the table format from raw header cell texts.
 *
 * Returns the format identifier or null if the table is not recognised
 * as a Q&A table. Mirrors the Python `detect_table_format()` logic.
 */
function detectTableFormat(rawHeaders: string[]): TableFormat | null {
  let normalised = rawHeaders.map(normaliseHeader);

  const has = (name: string) => normalised.includes(name);

  const hasQuestion = has('question');
  let hasStandard = has('standard');
  let hasAdvanced = has('advanced');
  const hasSection = has('section');
  const hasNumber = has('number');

  // Try inferring empty headers if we have question but no standard
  if (hasQuestion && !hasStandard) {
    normalised = inferEmptyHeaders(rawHeaders);
    hasStandard = normalised.includes('standard');
    hasAdvanced = normalised.includes('advanced');
  }

  if (!hasQuestion || !hasStandard) {
    // Positional fallback: if all headers are empty or unrecognised
    const allEmpty = rawHeaders.every((h) => h.trim() === '');
    if (allEmpty || (!hasQuestion && !hasStandard)) {
      const colCount = rawHeaders.length;
      if (colCount === 5) return 'positional_5col';
      if (colCount >= 6) return 'positional_6col';
    }
    return null;
  }

  const colCount = normalised.length;

  if (colCount >= 6 && hasAdvanced && hasSection && hasNumber) {
    // Distinguish Pattern A from Pattern C by column order
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

  // Generic fallback: at this point question + standard are guaranteed.
  if (hasAdvanced) return 'audit_6col';
  return 'generic_qa';
}

// ---------------------------------------------------------------------------
// HTML table extraction
// ---------------------------------------------------------------------------

/**
 * Extract clean text from an HTML element, collapsing whitespace
 * but preserving paragraph breaks.
 */
function cellText(element: HTMLElement): string {
  // Get all paragraph elements within the cell
  const paragraphs = element.querySelectorAll('p');
  if (paragraphs.length > 0) {
    return paragraphs
      .map((p) => p.textContent.trim())
      .filter((t) => t.length > 0)
      .join('\n');
  }
  // Fallback: just get the text content
  return element.textContent.trim();
}

/**
 * Extract Q&A pairs from a single HTML table element.
 *
 * Parses the first row as headers, normalises them, detects the table
 * format, then extracts data rows mapping columns to question/answer fields.
 */
function extractFromTable(
  table: HTMLElement,
  sectionName: string,
  tableIndex: number,
): DetectedQAPair[] {
  const rows = table.querySelectorAll('tr');
  if (rows.length < 2) return []; // Need at least header + one data row

  // Extract header row
  const headerCells = rows[0].querySelectorAll('th, td');
  const rawHeaders = Array.from(headerCells).map((cell) => cellText(cell));

  const format = detectTableFormat(rawHeaders);
  if (!format) return []; // Not a Q&A table

  // Determine column indices based on format
  let qIdx: number | null = null;
  let stdIdx: number | null = null;
  let advIdx: number | null = null;
  let secIdx: number | null = null;
  let dataStart = 1; // Skip header row by default

  if (format === 'positional_5col') {
    qIdx = 0;
    stdIdx = 1;
    advIdx = null;
    secIdx = null;
    dataStart = 0; // First row is data (no recognisable headers)
  } else if (format === 'positional_6col') {
    qIdx = 0;
    stdIdx = 1;
    advIdx = 2;
    secIdx = null;
    dataStart = 0;
  } else {
    // Use inferred headers for column mapping
    const normalised = inferEmptyHeaders(rawHeaders);

    // Build column index map (first occurrence wins)
    const colMap: Record<string, number> = {};
    for (let i = 0; i < normalised.length; i++) {
      if (normalised[i] && !(normalised[i] in colMap)) {
        colMap[normalised[i]] = i;
      }
    }

    qIdx = colMap['question'] ?? null;
    stdIdx = colMap['standard'] ?? null;
    advIdx = colMap['advanced'] ?? null;
    secIdx = colMap['section'] ?? null;
  }

  if (qIdx === null || stdIdx === null) return [];

  const pairs: DetectedQAPair[] = [];

  for (let rowNum = dataStart; rowNum < rows.length; rowNum++) {
    const cells = rows[rowNum].querySelectorAll('th, td');
    const cellArray = Array.from(cells);

    // Guard against rows shorter than expected
    if (cellArray.length <= Math.max(qIdx, stdIdx)) continue;

    const question = cellText(cellArray[qIdx]);
    const standard = cellText(cellArray[stdIdx]);

    // Skip empty question rows (spacing/formatting rows)
    if (!question.trim()) continue;

    let advanced = '';
    if (advIdx !== null && advIdx < cellArray.length) {
      advanced = cellText(cellArray[advIdx]);
    }

    // Use section from column if present, otherwise fall back to heading-based section
    let rowSection = sectionName;
    if (secIdx !== null && secIdx < cellArray.length) {
      const cellSection = cellText(cellArray[secIdx]);
      if (cellSection.trim()) {
        rowSection = cellSection.trim();
      }
    }

    pairs.push({
      question,
      answer: standard,
      answerAdvanced: advanced,
      source: 'table',
      confidence: 'high',
      sectionName: rowSection,
      tableIndex,
      rowIndex: rowNum,
    });
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// Numbered list extraction
// ---------------------------------------------------------------------------

/**
 * Detect numbered Q&A patterns in plain text extracted from HTML.
 *
 * Supports formats:
 *   - "Q1: question text\nA1: answer text"
 *   - "Q1. question text\nA1. answer text"
 *   - "1. Question: text\n   Answer: text"
 */
function extractFromNumberedLists(text: string): DetectedQAPair[] {
  const pairs: DetectedQAPair[] = [];

  // Pattern 1: Q1:/Q1. ... A1:/A1. markers
  // Match Q followed by a number, then colon or period.
  // The question text runs to end of line; the answer (optional) is on the
  // next line starting with A + same number. No `s` flag — `.` must NOT
  // match newlines so that captures stay within single lines.
  const qaNumberedPattern = /^\s*Q(\d+)\s*[.:]\s*(.+)$/gim;
  const answerPattern = (num: string) =>
    new RegExp(`^\\s*A${num}\\s*[.:]\\s*(.+)$`, 'im');

  // Collect all Q-lines first
  const qMatches: Array<{ num: string; question: string; index: number }> = [];
  let qMatch: RegExpExecArray | null;
  qMatch = qaNumberedPattern.exec(text);
  while (qMatch !== null) {
    qMatches.push({
      num: qMatch[1],
      question: qMatch[2].trim(),
      index: qMatch.index + qMatch[0].length,
    });
    qMatch = qaNumberedPattern.exec(text);
  }

  // For each Q-line, look for its corresponding A-line in the text after the Q
  for (const qm of qMatches) {
    const remainingText = text.slice(qm.index);
    const aMatch = answerPattern(qm.num).exec(remainingText);
    const answer = aMatch ? aMatch[1].trim() : '';

    if (qm.question.length > 0) {
      pairs.push({
        question: qm.question,
        answer,
        answerAdvanced: '',
        source: 'list',
        confidence: 'medium',
        sectionName: '',
        tableIndex: -1,
        rowIndex: -1,
      });
    }
  }

  if (pairs.length > 0) return pairs;

  // Pattern 2: Numbered items with Question:/Answer: sub-markers
  // e.g. "1. Question: What is...\n   Answer: We provide..."
  const numberedQPattern = /^\s*\d+\.\s*(?:Question|Q)\s*:\s*(.+)$/gim;
  const numberedAPattern = /^\s*(?:Answer|A)\s*:\s*(.+)$/im;

  const nqMatches: Array<{ question: string; index: number }> = [];
  let nqMatch: RegExpExecArray | null;
  nqMatch = numberedQPattern.exec(text);
  while (nqMatch !== null) {
    nqMatches.push({
      question: nqMatch[1].trim(),
      index: nqMatch.index + nqMatch[0].length,
    });
    nqMatch = numberedQPattern.exec(text);
  }

  for (const nq of nqMatches) {
    // Look for the answer between this Q and the next Q (or end of text)
    const nextQIdx = nqMatches.find((m) => m.index > nq.index);
    const searchEnd = nextQIdx
      ? nq.index + (nextQIdx.index - nq.index)
      : undefined;
    const searchText = text.slice(nq.index, searchEnd);
    const aMatch = numberedAPattern.exec(searchText);
    const answer = aMatch ? aMatch[1].trim() : '';

    if (nq.question.length > 0) {
      pairs.push({
        question: nq.question,
        answer,
        answerAdvanced: '',
        source: 'list',
        confidence: 'medium',
        sectionName: '',
        tableIndex: -1,
        rowIndex: -1,
      });
    }
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// Heading-paragraph extraction
// ---------------------------------------------------------------------------

/**
 * Heuristic to determine if text is likely a question.
 *
 * Checks for question marks, interrogative words, and imperative
 * prompts common in bid documents.
 */
function isLikelyQuestion(text: string): boolean {
  const trimmed = text.trim();

  // Must have meaningful length
  if (trimmed.length < 10 || trimmed.length > 500) return false;

  // Ends with a question mark — strong signal
  if (trimmed.endsWith('?')) return true;

  const lower = trimmed.toLowerCase();

  // Starts with an interrogative word
  const interrogatives = [
    'what',
    'how',
    'why',
    'when',
    'where',
    'who',
    'which',
    'do you',
    'does your',
    'can you',
    'will you',
    'have you',
    'is your',
    'are you',
    'is there',
    'are there',
  ];
  for (const q of interrogatives) {
    if (lower.startsWith(q + ' ') || lower.startsWith(q + ',')) return true;
  }

  // Common bid document imperative prompts
  const imperatives = [
    'please describe',
    'please explain',
    'please provide',
    'please detail',
    'please outline',
    'please confirm',
    'describe your',
    'explain your',
    'provide details',
    'outline your',
    'detail your',
  ];
  for (const imp of imperatives) {
    if (lower.startsWith(imp)) return true;
  }

  return false;
}

/**
 * Extract Q&A pairs from heading+paragraph patterns in HTML.
 *
 * Walks the DOM looking for headings (h1-h6) that appear to be questions,
 * followed by paragraph text that serves as the answer.
 */
function extractFromHeadingParagraphs(root: HTMLElement): DetectedQAPair[] {
  const pairs: DetectedQAPair[] = [];

  // Get all top-level children
  const children = root.childNodes.filter(
    (node) => node.nodeType === 1, // Element nodes only
  ) as HTMLElement[];

  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const tagName = el.tagName?.toLowerCase() ?? '';

    // Check if this is a heading element
    if (/^h[1-6]$/.test(tagName)) {
      const headingText = el.textContent.trim();

      if (isLikelyQuestion(headingText)) {
        // Collect subsequent paragraphs as the answer until the next heading
        const answerParts: string[] = [];
        let j = i + 1;
        while (j < children.length) {
          const nextEl = children[j];
          const nextTag = nextEl.tagName?.toLowerCase() ?? '';
          if (/^h[1-6]$/.test(nextTag)) break;
          if (
            nextTag === 'p' ||
            nextTag === 'div' ||
            nextTag === 'ul' ||
            nextTag === 'ol'
          ) {
            const text = nextEl.textContent.trim();
            if (text.length > 0) answerParts.push(text);
          }
          j++;
        }

        if (answerParts.length > 0) {
          pairs.push({
            question: headingText,
            answer: answerParts.join('\n\n'),
            answerAdvanced: '',
            source: 'heading',
            confidence: 'medium',
            sectionName: '',
            tableIndex: -1,
            rowIndex: -1,
          });
        }
      }
    }
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// Section heading tracking
// ---------------------------------------------------------------------------

/**
 * Walk the HTML DOM and extract Q&A pairs from tables, tracking section
 * headings as context for each table.
 *
 * mammoth preserves heading structure in HTML output, so we can walk
 * h1/h2/h3 elements preceding each table to build section context.
 */
function extractTablesWithSectionContext(root: HTMLElement): DetectedQAPair[] {
  const allPairs: DetectedQAPair[] = [];
  let currentSection = '';
  let tableIndex = 0;

  // Get all top-level children in document order
  const children = root.childNodes.filter(
    (node) => node.nodeType === 1,
  ) as HTMLElement[];

  for (const el of children) {
    const tagName = el.tagName?.toLowerCase() ?? '';

    // Track section headings
    if (/^h[1-3]$/.test(tagName)) {
      const headingText = el.textContent.trim();
      if (headingText) {
        currentSection = headingText;
      }
    }

    // Extract from tables
    if (tagName === 'table') {
      const pairs = extractFromTable(el, currentSection, tableIndex);
      allPairs.push(...pairs);
      tableIndex++;
    }
  }

  return allPairs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect Q&A pairs in mammoth HTML output using multiple strategies.
 *
 * Strategy priority:
 *   1. Table extraction (highest confidence) — parses HTML tables with
 *      recognisable Q/A column headers
 *   2. Numbered list extraction (medium confidence) — detects "Q1/A1" or
 *      numbered question/answer patterns
 *   3. Heading-paragraph extraction (medium confidence) — detects headings
 *      that are questions followed by answer paragraphs
 *   4. Text fallback (medium confidence) — detects "Q: ... A: ..." and
 *      "Question: ... Answer: ..." markers via extractStructuredPairs
 *
 * All strategies are attempted. Table results take priority; list, heading,
 * and text fallback results are appended only for content not already
 * covered by higher-priority strategies.
 *
 * @param html - mammoth HTML output string
 * @returns Array of detected Q&A pairs, empty if none found
 */
export function detectQAPairs(html: string): DetectedQAPair[] {
  if (!html || html.trim().length === 0) return [];

  // Parse the HTML
  let root: HTMLElement;
  try {
    root = parseHTML(html, {
      lowerCaseTagName: true,
      comment: false,
    });
  } catch {
    // Malformed HTML — return empty rather than crash
    return [];
  }

  // Strategy 1: Table extraction (highest confidence)
  const tablePairs = extractTablesWithSectionContext(root);

  // Strategy 2: Numbered list extraction
  const plainText = root.textContent;
  const listPairs = extractFromNumberedLists(plainText);

  // Strategy 3: Heading-paragraph extraction
  const headingPairs = extractFromHeadingParagraphs(root);

  // Strategy 4: Text fallback — extractStructuredPairs from document-diff.ts
  // Catches "Q: ... A: ..." and "Question: ... Answer: ..." marker patterns
  // that the numbered list strategy does not cover.
  const structuredPairs = extractStructuredPairs(plainText);
  const textFallbackPairs: DetectedQAPair[] = structuredPairs.map((sp) => ({
    question: sp.question,
    answer: sp.answer,
    answerAdvanced: '',
    source: 'text' as DetectionSource,
    confidence: 'medium' as DetectionConfidence,
    sectionName: '',
    tableIndex: -1,
    rowIndex: -1,
  }));

  // Combine results: tables first, then list/heading/text pairs that don't
  // duplicate table-extracted questions
  const allPairs = [...tablePairs];

  // Deduplicate list pairs against table pairs
  for (const pair of listPairs) {
    const isDuplicate = allPairs.some(
      (existing) => stringSimilarity(existing.question, pair.question) > 0.8,
    );
    if (!isDuplicate) {
      allPairs.push(pair);
    }
  }

  // Deduplicate heading pairs against all existing pairs
  for (const pair of headingPairs) {
    const isDuplicate = allPairs.some(
      (existing) => stringSimilarity(existing.question, pair.question) > 0.8,
    );
    if (!isDuplicate) {
      allPairs.push(pair);
    }
  }

  // Deduplicate text fallback pairs against all existing pairs
  for (const pair of textFallbackPairs) {
    const isDuplicate = allPairs.some(
      (existing) => stringSimilarity(existing.question, pair.question) > 0.8,
    );
    if (!isDuplicate) {
      allPairs.push(pair);
    }
  }

  return allPairs;
}

/**
 * Truncate text at a word boundary, ensuring it does not exceed maxLength.
 *
 * If the text is shorter than maxLength, returns it unchanged. Otherwise,
 * finds the last space before maxLength and truncates there with an
 * ellipsis suffix.
 */
function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  // Find last space before maxLength (leaving room for ellipsis)
  const truncateAt = maxLength - 3; // Reserve space for "..."
  const lastSpace = text.lastIndexOf(' ', truncateAt);
  if (lastSpace > 0) {
    return text.slice(0, lastSpace) + '...';
  }
  // No space found — hard truncate
  return text.slice(0, truncateAt) + '...';
}

/**
 * Prepare detected pairs for content item creation.
 *
 * Maps detected pairs to the q_a_pair content type format:
 *   - question_text becomes the title (truncated to 120 chars at word boundary)
 *   - Q/A formatted body text
 *   - Deduplicates by question similarity (keeps higher-confidence pair)
 *
 * @param pairs - Detected Q&A pairs from detectQAPairs()
 * @returns Array of creation inputs, deduplicated and formatted
 */
export function splitIntoQAPairs(pairs: DetectedQAPair[]): QACreateInput[] {
  if (!pairs || pairs.length === 0) return [];

  // Deduplicate by question similarity — keep the pair with higher confidence
  const confidenceRank: Record<DetectionConfidence, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };

  const deduped: DetectedQAPair[] = [];

  for (const pair of pairs) {
    const existingIdx = deduped.findIndex(
      (existing) => stringSimilarity(existing.question, pair.question) > 0.8,
    );

    if (existingIdx === -1) {
      // No duplicate — add
      deduped.push(pair);
    } else {
      // Duplicate found — keep the one with higher confidence
      const existing = deduped[existingIdx];
      if (
        confidenceRank[pair.confidence] > confidenceRank[existing.confidence]
      ) {
        deduped[existingIdx] = pair;
      }
    }
  }

  // Map to creation inputs
  return deduped.map((pair) => ({
    title: truncateAtWordBoundary(pair.question, 120),
    content: `Q: ${pair.question}\n\n${pair.answer}`,
    contentType: 'q_a_pair' as const,
    sectionName: pair.sectionName,
    answerAdvanced: pair.answerAdvanced,
    source: pair.source,
    confidence: pair.confidence,
  }));
}
