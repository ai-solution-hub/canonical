import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, getAIModel } from '@/lib/anthropic';
import { TenderExtractedMetadataSchema } from '@/lib/validation/schemas';
import type { TenderExtractedMetadata } from '@/types/procurement-metadata';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { logger } from '@/lib/logger';
import { assertSuccessfulStop } from '@/lib/ai/stop-reason';

/**
 * JSON Schema for tender question extraction from PDF documents.
 */
const _TENDER_QUESTIONS_SCHEMA = {
  name: 'tender_questions',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      sections: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            section_name: { type: 'string' as const },
            section_sequence: { type: 'integer' as const },
            questions: {
              type: 'array' as const,
              items: {
                type: 'object' as const,
                properties: {
                  question_text: { type: 'string' as const },
                  question_sequence: { type: 'integer' as const },
                  // Nullable under strict:true — the strict-mode subset has
                  // no array-valued `type`; value-or-null is anyOf (bl-471).
                  word_limit: {
                    anyOf: [
                      { type: 'integer' as const },
                      { type: 'null' as const },
                    ],
                  },
                  evaluation_weight: {
                    anyOf: [
                      { type: 'number' as const },
                      { type: 'null' as const },
                    ],
                  },
                  category: {
                    type: 'string' as const,
                    enum: ['mandatory', 'desirable', 'informational'],
                  },
                  // ID-145 {145.12} — metadata parity with q_a_extractions
                  // (scripts/cocoindex_pipeline/prompts.py Q_A_FORM_PROMPT):
                  // the SAME 2-value vocabulary, additive alongside `category`
                  // (which stays 3-valued for its existing consumers).
                  expected_response_kind: {
                    type: 'string' as const,
                    enum: ['mandatory', 'optional'],
                  },
                },
                required: [
                  'question_text',
                  'question_sequence',
                  'word_limit',
                  'evaluation_weight',
                  'category',
                  'expected_response_kind',
                ] as const,
                additionalProperties: false,
              },
            },
          },
          required: ['section_name', 'section_sequence', 'questions'] as const,
          additionalProperties: false,
        },
      },
    },
    required: ['sections'] as const,
    additionalProperties: false,
  },
};

/**
 * JSON Schema for search query generation used in KB matching.
 */
const _SEARCH_QUERIES_SCHEMA = {
  name: 'search_queries',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      queries: {
        type: 'array' as const,
        items: { type: 'string' as const },
      },
      primary_topic: { type: 'string' as const },
      content_types_needed: {
        type: 'array' as const,
        items: { type: 'string' as const },
      },
    },
    required: ['queries', 'primary_topic', 'content_types_needed'] as const,
    additionalProperties: false,
  },
};

/**
 * Shared tool definition for tender question extraction.
 * Used by both PDF and DOCX extraction functions to guarantee identical schemas.
 */
const EXTRACT_QUESTIONS_TOOL = {
  name: 'extract_questions' as const,
  description: 'Store the extracted questions from the tender document',
  // Grounding shape: forced_tool_strict (B-INV-35,
  // AI_TOUCHPOINT_GROUNDING['extract-questions.extractQuestions']). strict:true
  // + recursive additionalProperties:false guarantees the tool_use.input shape.
  strict: true as const,
  input_schema: {
    type: 'object' as const,
    properties: {
      sections: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            section_name: { type: 'string' as const },
            section_sequence: { type: 'integer' as const },
            questions: {
              type: 'array' as const,
              items: {
                type: 'object' as const,
                properties: {
                  question_text: { type: 'string' as const },
                  question_sequence: { type: 'integer' as const },
                  // Nullable under strict:true — the strict-mode subset has
                  // no array-valued `type`; value-or-null is anyOf (bl-471).
                  word_limit: {
                    anyOf: [
                      { type: 'integer' as const },
                      { type: 'null' as const },
                    ],
                  },
                  evaluation_weight: {
                    anyOf: [
                      { type: 'number' as const },
                      { type: 'null' as const },
                    ],
                  },
                  category: {
                    type: 'string' as const,
                    enum: ['mandatory', 'desirable', 'informational'],
                  },
                  // ID-145 {145.12} — metadata parity with q_a_extractions
                  // (scripts/cocoindex_pipeline/prompts.py Q_A_FORM_PROMPT):
                  // the SAME 2-value vocabulary, additive alongside `category`
                  // (which stays 3-valued for its existing consumers).
                  expected_response_kind: {
                    type: 'string' as const,
                    enum: ['mandatory', 'optional'],
                  },
                },
                required: [
                  'question_text',
                  'question_sequence',
                  'word_limit',
                  'evaluation_weight',
                  'category',
                  'expected_response_kind',
                ] as string[],
                additionalProperties: false as const,
              },
            },
          },
          required: [
            'section_name',
            'section_sequence',
            'questions',
          ] as string[],
          additionalProperties: false as const,
        },
      },
    },
    required: ['sections'] as string[],
    additionalProperties: false as const,
  },
};

/** @public */
export interface ExtractedPDFQuestions {
  sections: Array<{
    section_name: string;
    section_sequence: number;
    questions: Array<{
      question_text: string;
      question_sequence: number;
      word_limit: number | null;
      evaluation_weight: number | null;
      category: 'mandatory' | 'desirable' | 'informational';
      /**
       * ID-145 {145.12} — metadata parity with q_a_extractions
       * (`expected_response_kind`, the SAME 2-value vocabulary as
       * `scripts/cocoindex_pipeline/extraction.py` QAPair). Additive
       * alongside `category`, which keeps its existing 3-value shape.
       */
      expected_response_kind: 'mandatory' | 'optional';
    }>;
  }>;
}

/** @public */
export interface GeneratedSearchQueries {
  queries: string[];
  primary_topic: string;
  content_types_needed: string[];
}

/**
 * Extract the tool_use result from a Claude response.
 * Shared helper for PDF and DOCX extraction.
 */
function extractToolResult(response: Anthropic.Message): ExtractedPDFQuestions {
  const toolBlock = response.content.find((block) => block.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('No tool_use content in response');
  }
  return toolBlock.input as ExtractedPDFQuestions;
}

/**
 * Extract questions from a PDF tender document using Claude tool_use pattern.
 *
 * Uses forced tool_use (tool_choice) to guarantee structured JSON output.
 * The TENDER_QUESTIONS_SCHEMA above is retained for documentation and potential
 * future use with the Anthropic Structured Outputs API (output_config) once
 * it is stable in the SDK.
 */
export async function extractPDFQuestions(
  pdfBase64: string,
): Promise<ExtractedPDFQuestions> {
  return extractPDFQuestionsWithToolUse(pdfBase64);
}

/**
 * Extract questions from a PDF using the tool_use pattern (proven in existing codebase).
 */
async function extractPDFQuestionsWithToolUse(
  pdfBase64: string,
): Promise<ExtractedPDFQuestions> {
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: getAIModel(),
    max_tokens: 8192,
    system: `You are extracting questions from a UK tender document.
Extract ALL questions that require a written response from the bidder.
Ignore instructions, preamble, and administrative sections.
Group questions by section based on document headings.
For each question set expected_response_kind: MUST be EXACTLY ONE of "mandatory" or "optional" — "optional" for administrative/informational detail fields (company name, VAT number, contact details, and similar), "mandatory" for everything else. NEVER use any other value.
Use UK English throughout.
You MUST call the extract_questions tool with your results.`,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          {
            type: 'text',
            text: 'Extract all bid questions from this tender document.',
          },
        ],
      },
    ],
    tools: [EXTRACT_QUESTIONS_TOOL],
    tool_choice: { type: 'tool', name: 'extract_questions' },
  });

  // B-INV-36: surface refusal / max_tokens explicitly before reading the tool result.
  assertSuccessfulStop(response, 'extract-questions.extractQuestions');

  return extractToolResult(response);
}

/**
 * Extract questions from a DOCX tender document using mammoth + Claude tool_use.
 *
 * Converts the DOCX buffer to HTML (preserving table structure), then sends the
 * HTML to Claude for structured extraction using the same tool_use schema as
 * the PDF path.
 */
export async function extractDOCXQuestions(
  buffer: Buffer,
): Promise<ExtractedPDFQuestions> {
  const { value: html } = await mammoth.convertToHtml({ buffer });

  if (!html || html.trim().length === 0) {
    throw new Error('DOCX conversion produced no content');
  }

  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: getAIModel(),
    max_tokens: 8192,
    system: `You are extracting questions from a UK tender document that has been converted from DOCX to HTML.

Extract ALL questions that require a written response from the bidder. These are typically found in:
- HTML tables with columns like "Question", "Requirement", "Response Required", "Description"
- Numbered lists of questions in the document body
- Requirement matrices with evaluation criteria

For each question, detect:
- **Word limits:** Look for patterns like "Max 500 words", "500 words", "(maximum 300 words)" in the question text, adjacent table cells, or dedicated "Word Limit" columns.
- **Evaluation weights:** Look for patterns like "10%", "10 marks", "10 points" in dedicated "Weighting" or "Max Marks" columns.
- **Category:** Classify as "informational" if the question asks for administrative details (company name, registered address, VAT number, contact details, trading name, registration number, DUNS number, website URL, turnover, number of employees, parent company, SME status, postcode, email, telephone, signature). Otherwise classify as "mandatory".
- **Expected response kind:** set expected_response_kind to MUST be EXACTLY ONE of "mandatory" or "optional" — "optional" for the same administrative/informational fields described above, "mandatory" for everything else. NEVER use any other value.

Exclude:
- Instructions and preamble sections
- Administrative header fields (company name, address, VAT, etc.) — these should be classified as "informational" if included
- Response/answer columns (only extract the question text)

Group questions by section based on document headings (h1, h2, h3 tags) or section columns within tables.
Assign sequential section_sequence (starting from 0) and question_sequence (starting from 0 within each section).
Use UK English throughout.

You MUST call the extract_questions tool with your results.`,
    messages: [
      {
        role: 'user',
        content: `Extract all bid questions from this tender document HTML:\n\n${html}`,
      },
    ],
    tools: [EXTRACT_QUESTIONS_TOOL],
    tool_choice: { type: 'tool', name: 'extract_questions' },
  });

  // B-INV-36: surface refusal / max_tokens explicitly before reading the tool result.
  assertSuccessfulStop(response, 'extract-questions.extractQuestions');

  return extractToolResult(response);
}

/**
 * Convert an XLSX/XLS workbook buffer into structured HTML text — one
 * `<table>` per sheet, preceded by an `<h2>` sheet-name heading. Mirrors the
 * DOCX -> HTML conversion (`mammoth`) so the same Claude extraction contract
 * (table cells, headings) applies uniformly to both formats. Exported so the
 * best-effort tender-metadata path (route.ts) can reuse the same conversion
 * without re-deriving it.
 *
 * Sheets with no populated cell range (`!ref` absent) are skipped — an
 * all-empty sheet contributes an empty `<table>` that adds noise without
 * content for Claude to extract from.
 */
export function xlsxWorkbookToHtml(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const sections = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet || !sheet['!ref']) return '';
    return `<h2>${name}</h2>\n${XLSX.utils.sheet_to_html(sheet)}`;
  }).filter((section) => section.length > 0);

  return sections.join('\n');
}

/**
 * Extract questions from an XLSX tender document using the SheetJS `xlsx`
 * reader + Claude tool_use.
 *
 * Converts the workbook to per-sheet HTML tables (preserving row/column
 * structure — the "Question" / "Word Limit" / "Weighting" column layout
 * XLSX-format tenders share with DOCX-format tenders), then sends the HTML
 * to Claude for structured extraction using the same tool_use schema as the
 * PDF and DOCX paths.
 */
export async function extractXLSXQuestions(
  buffer: Buffer,
): Promise<ExtractedPDFQuestions> {
  const html = xlsxWorkbookToHtml(buffer);

  if (!html || html.trim().length === 0) {
    throw new Error('XLSX conversion produced no content');
  }

  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: getAIModel(),
    max_tokens: 8192,
    system: `You are extracting questions from a UK tender document that has been converted from XLSX to HTML (one table per sheet, preceded by an <h2> heading naming the sheet).

Extract ALL questions that require a written response from the bidder. These are typically found in:
- HTML tables with columns like "Question", "Requirement", "Response Required", "Description"
- Requirement matrices with evaluation criteria, one row per question
- Rate-card / pricing schedule rows that require a written response (not just a numeric rate)

For each question, detect:
- **Word limits:** Look for patterns like "Max 500 words", "500 words", "(maximum 300 words)" in the question text, adjacent cells, or dedicated "Word Limit" columns.
- **Evaluation weights:** Look for patterns like "10%", "10 marks", "10 points" in dedicated "Weighting" or "Max Marks" columns.
- **Category:** Classify as "informational" if the question asks for administrative details (company name, registered address, VAT number, contact details, trading name, registration number, DUNS number, website URL, turnover, number of employees, parent company, SME status, postcode, email, telephone, signature). Otherwise classify as "mandatory".
- **Expected response kind:** set expected_response_kind to MUST be EXACTLY ONE of "mandatory" or "optional" — "optional" for the same administrative/informational fields described above, "mandatory" for everything else. NEVER use any other value.

Exclude:
- Instructions and preamble sections
- Administrative header fields (company name, address, VAT, etc.) — these should be classified as "informational" if included
- Response/answer columns and empty answer cells (only extract the question text)

Group questions by section — use the sheet name (the <h2> heading) as the section_name when a sheet has no internal section headings of its own.
Assign sequential section_sequence (starting from 0) and question_sequence (starting from 0 within each section).
Use UK English throughout.

You MUST call the extract_questions tool with your results.`,
    messages: [
      {
        role: 'user',
        content: `Extract all bid questions from this tender spreadsheet, rendered as HTML tables (one per sheet):\n\n${html}`,
      },
    ],
    tools: [EXTRACT_QUESTIONS_TOOL],
    tool_choice: { type: 'tool', name: 'extract_questions' },
  });

  // B-INV-36: surface refusal / max_tokens explicitly before reading the tool result.
  assertSuccessfulStop(response, 'extract-questions.extractQuestions');

  return extractToolResult(response);
}

// ──────────────────────────────────────────
// Tender Metadata Extraction
// ──────────────────────────────────────────

/** Tool definition for tender metadata extraction. */
const TENDER_METADATA_TOOL: Anthropic.Messages.Tool = {
  name: 'extract_tender_metadata',
  description:
    'Extract bid metadata (buyer, deadline, reference, value) from a tender document.',
  // Grounding shape: forced_tool_strict (B-INV-35,
  // AI_TOUCHPOINT_GROUNDING['extract-questions.extractTenderMetadata']).
  strict: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      // Nullable under strict:true — the strict-mode subset has no
      // array-valued `type`; value-or-null is anyOf, which also needs no
      // SDK-type cast (bl-471, fix pattern 0682d507).
      buyer_name: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description: 'The buying organisation / contracting authority name',
      },
      deadline: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description:
          'Submission deadline in ISO 8601 format (e.g., 2026-04-15T17:00:00Z). Convert from UK date formats (DD/MM/YYYY).',
      },
      reference_number: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description:
          'Tender reference number, ITT reference, procurement reference, or contract number',
      },
      estimated_value: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description:
          'Contract value or budget (as displayed, e.g., "£500,000" or "£1.2m per annum")',
      },
      title: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description:
          'The formal tender/contract title from the document cover page or header',
      },
      confidence: {
        type: 'number' as const,
        description:
          'Confidence score 0.0-1.0 for the overall extraction quality',
      },
    },
    required: [
      'buyer_name',
      'deadline',
      'reference_number',
      'estimated_value',
      'title',
      'confidence',
    ],
    additionalProperties: false,
  },
};

function validateExtractedMetadata(
  raw: TenderExtractedMetadata,
): TenderExtractedMetadata {
  const parsed = TenderExtractedMetadataSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(
      {
        issues: parsed.error.issues,
        op: 'extract-questions.metadata.validate',
      },
      'Extracted metadata failed validation',
    );
    return {
      buyer_name: null,
      deadline: null,
      reference_number: null,
      estimated_value: null,
      title: null,
      confidence: 0,
    };
  }
  return parsed.data;
}

/**
 * Extract tender metadata from document content using Claude.
 * Returns null on failure.
 */
export async function extractTenderMetadata(
  content: string,
  format: 'html' | 'pdf_base64',
): Promise<TenderExtractedMetadata | null> {
  const anthropic = getAnthropicClient();

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: 'user',
      content:
        format === 'pdf_base64'
          ? [
              {
                type: 'document' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'application/pdf' as const,
                  data: content,
                },
              },
              {
                type: 'text' as const,
                text: 'Extract bid metadata from this tender document.',
              },
            ]
          : `Extract bid metadata from this tender document HTML:\n\n${content}`,
    },
  ];

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: `You are extracting metadata from a UK tender/procurement document.
Extract the buying organisation name, submission deadline, reference number, estimated contract value, and formal tender title.
Convert all dates to ISO 8601 format. UK dates use DD/MM/YYYY.
If a field cannot be found, return null for that field.
Set confidence based on how clearly the information is stated in the document.
You MUST call the extract_tender_metadata tool with your results.`,
    messages,
    tools: [TENDER_METADATA_TOOL],
    tool_choice: { type: 'tool', name: 'extract_tender_metadata' },
  });

  // B-INV-36: surface refusal / max_tokens explicitly — a refused or truncated
  // call must not collapse into a silent `null` indistinguishable from
  // "no metadata found".
  assertSuccessfulStop(response, 'extract-questions.extractTenderMetadata');

  const toolBlock = response.content.find((b) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    return null;
  }
  return validateExtractedMetadata(toolBlock.input as TenderExtractedMetadata);
}

/**
 * Generate search queries for KB matching using Claude.
 */
export async function generateSearchQueries(
  questionText: string,
): Promise<GeneratedSearchQueries> {
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: getAIModel(),
    max_tokens: 1024,
    system:
      'You generate search queries to find relevant knowledge base content for bid questions. Return 3-5 diverse search queries that would find relevant answers. Use UK English.',
    messages: [
      {
        role: 'user',
        content: `Generate search queries for this bid question: "${questionText}"`,
      },
    ],
    tools: [
      {
        name: 'search_queries',
        description: 'Return the generated search queries',
        // Grounding shape: forced_tool_strict (B-INV-35,
        // AI_TOUCHPOINT_GROUNDING['extract-questions.generateSearchQueries']).
        strict: true,
        input_schema: {
          type: 'object' as const,
          properties: {
            queries: {
              type: 'array',
              items: { type: 'string' },
            },
            primary_topic: { type: 'string' },
            content_types_needed: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['queries', 'primary_topic', 'content_types_needed'],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'search_queries' },
  });

  // B-INV-36: surface refusal / max_tokens explicitly before reading the tool result.
  assertSuccessfulStop(response, 'extract-questions.generateSearchQueries');

  const toolBlock = response.content.find((block) => block.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('No tool_use content in response');
  }
  return toolBlock.input as GeneratedSearchQueries;
}
