/**
 * Word document generation for bid response export.
 *
 * Generates a formatted .docx from bid questions, responses, and metadata.
 * Uses the `docx` npm package (v9.6.0) with server-side Packer.toBuffer().
 *
 * @module bid-export-docx
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  BorderStyle,
  AlignmentType,
  TableOfContents,
  Header,
  Footer,
  PageNumber,
} from 'docx';
import type { ISectionOptions } from 'docx';
import { format } from 'date-fns';
import { enGB } from 'date-fns/locale';
import { countWords } from '@/lib/editor-utils';
import { stripMarkdown } from '@/lib/content/strip-markdown';
import { BRANDING } from '@/lib/client-config';
import type {
  ExportQuestion,
  ExportProcurementMetadata,
  DocxExportOptions,
} from '@/lib/domains/procurement/procurement-export-types';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface GroupedSection {
  name: string;
  sequence: number;
  questions: ExportQuestion[];
}

// ---------------------------------------------------------------------------
// Status formatting
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

function formatStatus(status: string): string {
  return STATUS_LABELS[status] || status;
}

// ---------------------------------------------------------------------------
// Markdown-to-DOCX helpers
// ---------------------------------------------------------------------------

/**
 * Parse inline markdown formatting into TextRun objects.
 *
 * Handles bold, italic, underscore-italic, and bold-italic within a
 * single line of text, producing docx TextRun objects with the
 * appropriate formatting properties.
 */
function parseMarkdownInline(text: string): TextRun[] {
  const runs: TextRun[] = [];

  // Regex to match bold+italic (***), bold (**), or italic (* or _)
  // Order matters: bold+italic before bold before italic
  const inlineRegex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index);
      if (plain.length > 0) {
        runs.push(new TextRun({ text: plain, font: 'Calibri', size: 22 }));
      }
    }

    // Determine formatting type
    if (match[2] !== undefined) {
      // ***bold italic***
      runs.push(
        new TextRun({
          text: match[2],
          font: 'Calibri',
          size: 22,
          bold: true,
          italics: true,
        }),
      );
    } else if (match[3] !== undefined) {
      // **bold**
      runs.push(
        new TextRun({
          text: match[3],
          font: 'Calibri',
          size: 22,
          bold: true,
        }),
      );
    } else if (match[4] !== undefined) {
      // *italic*
      runs.push(
        new TextRun({
          text: match[4],
          font: 'Calibri',
          size: 22,
          italics: true,
        }),
      );
    } else if (match[5] !== undefined) {
      // _italic_
      runs.push(
        new TextRun({
          text: match[5],
          font: 'Calibri',
          size: 22,
          italics: true,
        }),
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining plain text after last match
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining.length > 0) {
      runs.push(new TextRun({ text: remaining, font: 'Calibri', size: 22 }));
    }
  }

  // Fallback for text with no inline formatting
  if (runs.length === 0 && text.length > 0) {
    runs.push(new TextRun({ text, font: 'Calibri', size: 22 }));
  }

  return runs;
}

/**
 * Convert Tiptap markdown to an array of Word Paragraphs.
 *
 * Parses the markdown subset produced by `@tiptap/markdown`'s
 * `getMarkdown()` method:
 * - `# H1` / `## H2` / `### H3` headings (mapped to H3/H4/H5 in DOCX
 *   to avoid conflicting with document section/question headings)
 * - `**bold**`, `*italic*`, `_italic_` inline formatting
 * - `- ` / `* ` unordered list items
 * - `1. ` / `2. ` ordered list items
 * - Paragraph breaks on blank lines (double newline)
 * - GFM pipe tables rendered as plain text rows (full DOCX table
 *   construction is out of scope for this lightweight parser)
 *
 * Also handles plain text and legacy HTML gracefully — if the input
 * contains no markdown features, it produces a single paragraph.
 *
 * @internal Exported for unit tests only.
 */
export function markdownToDocxParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  if (!markdown || markdown.trim().length === 0) {
    return paragraphs;
  }

  // Split into blocks on blank lines (markdown paragraph convention)
  const blocks = markdown.split(/\n{2,}/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed.length === 0) continue;

    // Process each line within the block (handles lists and headings
    // that may appear as consecutive single-newline-separated lines)
    const lines = trimmed.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (line.length === 0) continue;

      // ── Headings: # H1, ## H2, ### H3 ──
      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2];
        // Response headings start at H3 (H1/H2 used by section/question)
        const headingLevel =
          level === 1
            ? HeadingLevel.HEADING_3
            : level === 2
              ? HeadingLevel.HEADING_4
              : HeadingLevel.HEADING_5;

        paragraphs.push(
          new Paragraph({
            heading: headingLevel,
            children: [
              new TextRun({
                text: headingText,
                bold: true,
                font: 'Calibri',
              }),
            ],
            spacing: { before: 200, after: 100 },
          }),
        );
        continue;
      }

      // ── Unordered list: - item or * item ──
      const ulMatch = line.match(/^[-*]\s+(.+)$/);
      if (ulMatch) {
        paragraphs.push(
          new Paragraph({
            bullet: { level: 0 },
            children: parseMarkdownInline(ulMatch[1]),
            spacing: { after: 60 },
          }),
        );
        continue;
      }

      // ── Ordered list: 1. item, 2. item ──
      const olMatch = line.match(/^\d+\.\s+(.+)$/);
      if (olMatch) {
        paragraphs.push(
          new Paragraph({
            numbering: { reference: 'default-numbering', level: 0 },
            children: parseMarkdownInline(olMatch[1]),
            spacing: { after: 60 },
          }),
        );
        continue;
      }

      // ── Table separator rows (---) — skip ──
      if (/^\|?\s*[-:]+[-|\s:]*$/.test(line)) {
        continue;
      }

      // ── Table data/header rows — render as plain text ──
      if (line.startsWith('|') && line.endsWith('|')) {
        const cellText = line
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim())
          .join(' | ');
        paragraphs.push(
          new Paragraph({
            children: parseMarkdownInline(cellText),
            spacing: { after: 60 },
          }),
        );
        continue;
      }

      // ── Regular paragraph ──
      paragraphs.push(
        new Paragraph({
          children: parseMarkdownInline(line),
          spacing: { after: 120 },
        }),
      );
    }
  }

  return paragraphs;
}

// ---------------------------------------------------------------------------
// Section grouping
// ---------------------------------------------------------------------------

/**
 * Group questions by section_name and sort by sequence.
 *
 * Questions with a null/empty section_name are placed in a
 * "General Questions" section at the end.
 */
function groupBySection(questions: ExportQuestion[]): GroupedSection[] {
  const sectionMap = new Map<string, GroupedSection>();

  for (const q of questions) {
    const sectionName = q.section_name || 'General Questions';
    const existing = sectionMap.get(sectionName);

    if (existing) {
      existing.questions.push(q);
    } else {
      sectionMap.set(sectionName, {
        name: sectionName,
        sequence: q.section_sequence,
        questions: [q],
      });
    }
  }

  // Sort sections by sequence, then questions within each section
  const sections = Array.from(sectionMap.values());
  sections.sort((a, b) => a.sequence - b.sequence);
  for (const section of sections) {
    section.questions.sort((a, b) => a.question_sequence - b.question_sequence);
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Document builders
// ---------------------------------------------------------------------------

/**
 * Build the cover page section.
 */
function buildCoverSection(
  metadata: ExportProcurementMetadata,
  companyName: string,
): ISectionOptions {
  const children: Paragraph[] = [];

  // Spacer at top
  children.push(new Paragraph({ spacing: { before: 3000 } }));

  // Company name
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: companyName,
          font: 'Calibri',
          size: 28, // 14pt
          color: '6B7280',
        }),
      ],
      spacing: { after: 200 },
    }),
  );

  // Procurement title
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: metadata.procurement_name,
          font: 'Calibri',
          size: 72, // 36pt
          bold: true,
          color: '1E408A',
        }),
      ],
      spacing: { after: 400 },
    }),
  );

  // Buyer name
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: metadata.buyer,
          font: 'Calibri',
          size: 40, // 20pt
          color: '374151',
        }),
      ],
      spacing: { after: 600 },
    }),
  );

  // Metadata items
  const metaItems: string[] = [];
  if (metadata.reference_number) {
    metaItems.push(`Reference: ${metadata.reference_number}`);
  }
  if (metadata.deadline) {
    const deadlineDate = new Date(metadata.deadline);
    metaItems.push(
      `Deadline: ${format(deadlineDate, 'dd/MM/yyyy', { locale: enGB })}`,
    );
  }
  if (metadata.estimated_value) {
    metaItems.push(`Estimated Value: ${metadata.estimated_value}`);
  }

  for (const item of metaItems) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: item,
            font: 'Calibri',
            size: 24, // 12pt
            color: '6B7280',
          }),
        ],
        spacing: { after: 100 },
      }),
    );
  }

  // Generation timestamp
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Generated: ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: enGB })}`,
          font: 'Calibri',
          size: 20, // 10pt
          color: '9CA3AF',
          italics: true,
        }),
      ],
      spacing: { before: 400 },
    }),
  );

  return {
    properties: {
      page: {
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children,
  };
}

/**
 * Build the table of contents section.
 */
function buildTocSection(): ISectionOptions {
  return {
    properties: {
      page: {
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [
          new TextRun({
            text: 'Table of Contents',
            bold: true,
            size: 36,
            font: 'Calibri',
            color: '1E408A',
          }),
        ],
        spacing: { after: 300 },
      }),
      new TableOfContents('Table of Contents', {
        hyperlink: true,
        headingStyleRange: '1-2',
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: 'Right-click the table above and select "Update Field" to populate.',
            italics: true,
            size: 18, // 9pt
            color: '9CA3AF',
            font: 'Calibri',
          }),
        ],
        spacing: { before: 200 },
      }),
    ],
  };
}

/**
 * Build paragraphs for a single question/response pair.
 */
function buildQuestionParagraphs(
  question: ExportQuestion,
  opts: { includeCitations: boolean; useAdvancedVariant: boolean },
): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // Question heading (Heading 2)
  paragraphs.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun({
          text: `Q${question.question_sequence}: ${question.question_text}`,
          bold: true,
          size: 44, // 22pt
          font: 'Calibri',
          color: '111827',
        }),
      ],
      spacing: { before: 200, after: 100 },
    }),
  );

  // Metadata row
  const metaParts: string[] = [];
  if (question.word_limit !== null) {
    metaParts.push(`Word Limit: ${question.word_limit}`);
  }
  if (question.evaluation_weight !== null) {
    metaParts.push(`Weight: ${question.evaluation_weight}%`);
  }
  metaParts.push(
    `Status: ${formatStatus(question.review_status || question.status)}`,
  );

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: metaParts.join(' | '),
          italics: true,
          size: 20, // 10pt
          font: 'Calibri',
          color: '6B7280',
        }),
      ],
      spacing: { after: 120 },
    }),
  );

  // Response content
  const responseMarkdown = opts.useAdvancedVariant
    ? question.response_text_advanced || question.response_text
    : question.response_text;

  if (responseMarkdown) {
    paragraphs.push(...markdownToDocxParagraphs(responseMarkdown));
  } else {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '[No response drafted yet]',
            italics: true,
            size: 22,
            font: 'Calibri',
            color: '9CA3AF',
          }),
        ],
        spacing: { after: 120 },
      }),
    );
  }

  // Word count footer
  const plainText = responseMarkdown ? stripMarkdown(responseMarkdown) : '';
  const wordCount = countWords(plainText);
  const wordCountText = question.word_limit
    ? `Word count: ${wordCount}/${question.word_limit}`
    : `Word count: ${wordCount}`;

  const isOverLimit =
    question.word_limit !== null && wordCount > question.word_limit;
  const wordCountColour =
    question.word_limit === null
      ? '6B7280' // grey -- no limit
      : isOverLimit
        ? 'DC2626' // red -- over limit
        : '059669'; // green -- within limit

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: wordCountText,
          italics: true,
          size: 18, // 9pt
          font: 'Calibri',
          color: wordCountColour,
        }),
      ],
      spacing: { after: 60 },
    }),
  );

  // Citation references
  if (opts.includeCitations && question.citations.length > 0) {
    const citationText =
      'Sources: ' +
      question.citations
        .map((c) => `[${c.source_index}] ${c.source_title}`)
        .join(', ');

    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: citationText,
            size: 18, // 9pt
            font: 'Calibri',
            color: '2563EB',
          }),
        ],
        spacing: { after: 100 },
      }),
    );
  }

  // Horizontal rule separator
  paragraphs.push(
    new Paragraph({
      border: {
        bottom: {
          color: 'E5E7EB',
          style: BorderStyle.SINGLE,
          size: 1,
          space: 1,
        },
      },
      spacing: { before: 200, after: 200 },
    }),
  );

  return paragraphs;
}

/**
 * Build the responses section containing all questions grouped by section.
 */
function buildResponsesSection(
  sections: GroupedSection[],
  opts: { includeCitations: boolean; useAdvancedVariant: boolean },
): ISectionOptions {
  const children: (Paragraph | TableOfContents)[] = [];

  for (const section of sections) {
    // Section heading (Heading 1)
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [
          new TextRun({
            text: section.name,
            bold: true,
            size: 56, // 28pt
            font: 'Calibri',
            color: '1E408A',
          }),
        ],
        spacing: { before: 300, after: 150 },
        pageBreakBefore: true,
      }),
    );

    for (const question of section.questions) {
      children.push(...buildQuestionParagraphs(question, opts));
    }
  }

  // Export summary at the end
  children.push(...buildExportSummary(sections));

  return {
    properties: {
      page: {
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: 'Procurement Response Export',
                font: 'Calibri',
                size: 16, // 8pt
                color: '9CA3AF',
                italics: true,
              }),
            ],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                children: [
                  'Page ',
                  PageNumber.CURRENT,
                  ' of ',
                  PageNumber.TOTAL_PAGES,
                ],
                font: 'Calibri',
                size: 16, // 8pt
                color: '9CA3AF',
              }),
            ],
          }),
        ],
      }),
    },
    children,
  };
}

/**
 * Build the export summary paragraphs for the final page.
 */
function buildExportSummary(sections: GroupedSection[]): Paragraph[] {
  const allQuestions = sections.flatMap((s) => s.questions);
  const totalQuestions = allQuestions.length;
  const responsesCompleted = allQuestions.filter(
    (q) => q.review_status === 'approved' || q.review_status === 'edited',
  ).length;
  const responsesPending = totalQuestions - responsesCompleted;

  const paragraphs: Paragraph[] = [];

  paragraphs.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [
        new TextRun({
          text: 'Export Summary',
          bold: true,
          size: 56, // 28pt
          font: 'Calibri',
          color: '1E408A',
        }),
      ],
      spacing: { after: 300 },
    }),
  );

  // Calculate average confidence
  const confidenceScores: Record<string, number> = {
    strong_match: 100,
    partial_match: 60,
    needs_sme: 30,
    no_content: 0,
  };
  const questionsWithConfidence = allQuestions.filter(
    (q) => q.confidence_posture && q.confidence_posture in confidenceScores,
  );
  const averageConfidence =
    questionsWithConfidence.length > 0
      ? Math.round(
          questionsWithConfidence.reduce(
            (sum, q) => sum + (confidenceScores[q.confidence_posture!] ?? 0),
            0,
          ) / questionsWithConfidence.length,
        )
      : 0;

  const summaryItems = [
    `Total Questions: ${totalQuestions}`,
    `Responses Completed: ${responsesCompleted}`,
    `Responses Pending: ${responsesPending}`,
    `Average Confidence: ${averageConfidence}%`,
    `Export Generated: ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: enGB })}`,
  ];

  for (const item of summaryItems) {
    paragraphs.push(
      new Paragraph({
        bullet: { level: 0 },
        children: [
          new TextRun({
            text: item,
            font: 'Calibri',
            size: 22, // 11pt
          }),
        ],
        spacing: { after: 60 },
      }),
    );
  }

  return paragraphs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a Word document Buffer from bid data.
 *
 * @param metadata - Procurement metadata for cover page
 * @param questions - Array of questions with responses
 * @param options - Export configuration
 * @returns Buffer containing the .docx file
 */
export async function generateProcurementDocx(
  metadata: ExportProcurementMetadata,
  questions: ExportQuestion[],
  options: DocxExportOptions = {},
): Promise<Buffer> {
  const {
    includeCover = true,
    includeToc = true,
    includeCitations = true,
    includeUnanswered = true,
    useAdvancedVariant = false,
    companyName = BRANDING.productName,
  } = options;

  // Filter questions if not including unanswered
  const exportQuestions = includeUnanswered
    ? questions
    : questions.filter((q) => q.response_text !== null);

  // Group questions by section
  const sections = groupBySection(exportQuestions);

  // Build document sections
  const docSections: ISectionOptions[] = [];

  if (includeCover) {
    docSections.push(buildCoverSection(metadata, companyName));
  }

  if (includeToc) {
    docSections.push(buildTocSection());
  }

  docSections.push(
    buildResponsesSection(sections, {
      includeCitations,
      useAdvancedVariant,
    }),
  );

  const doc = new Document({
    features: {
      updateFields: true,
    },
    styles: {
      default: {
        document: {
          run: {
            font: 'Calibri',
            size: 22, // 11pt in half-points
          },
        },
      },
    },
    sections: docSections,
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
