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
import { htmlToPlainText, countWords } from '@/lib/editor-utils';
import type {
  ExportQuestion,
  ExportBidMetadata,
  DocxExportOptions,
} from '@/lib/bid/bid-export-types';

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
// HTML helpers
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags from a string and decode common entities.
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Parse inline HTML into TextRun objects, preserving bold/italic/underline.
 *
 * Walks the HTML string using regex to detect inline formatting tags
 * and converts them to docx TextRun properties.
 */
function parseInlineFormatting(html: string): TextRun[] {
  const runs: TextRun[] = [];

  // Regex to match opening/closing inline tags or plain text segments
  const tokenRegex = /<(\/?)(?:strong|b|em|i|u|a)(?:\s[^>]*)?>|([^<]+)/gi;
  let bold = false;
  let italic = false;
  let underline = false;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(html)) !== null) {
    const fullMatch = match[0];
    const isClosing = match[1] === '/';
    const textContent = match[2];

    if (textContent !== undefined) {
      // Plain text segment — decode entities and create a run
      const decoded = decodeEntities(textContent);
      if (decoded.length > 0) {
        runs.push(
          new TextRun({
            text: decoded,
            font: 'Calibri',
            size: 22,
            bold: bold || undefined,
            italics: italic || undefined,
            underline: underline ? { type: 'single' as const } : undefined,
          })
        );
      }
    } else {
      // Tag — update formatting state
      const tagName = fullMatch
        .replace(/<\/?/i, '')
        .replace(/[\s>].*/, '')
        .toLowerCase();
      if (tagName === 'strong' || tagName === 'b') {
        bold = !isClosing;
      } else if (tagName === 'em' || tagName === 'i') {
        italic = !isClosing;
      } else if (tagName === 'u') {
        underline = !isClosing;
      }
    }
  }

  // Fallback: if no runs were produced (e.g., empty or tag-only input)
  if (runs.length === 0) {
    const plain = stripHtmlTags(html);
    if (plain.length > 0) {
      runs.push(new TextRun({ text: plain, font: 'Calibri', size: 22 }));
    }
  }

  return runs;
}

/** Decode common HTML entities */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Convert Tiptap HTML to an array of Word Paragraphs.
 *
 * Handles the HTML output from the Tiptap editor, converting block-level
 * and inline elements to their Word equivalents. Headings within responses
 * are mapped to H3+ to avoid conflicting with section/question headings.
 */
function htmlToDocxParagraphs(html: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // Split on block-level closing tags to identify paragraphs
  const blocks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .split(/<\/(?:p|div|h[1-6]|li)>/gi)
    .filter((block) => block.trim().length > 0);

  for (const block of blocks) {
    const trimmed = block.trim();

    // Detect heading level
    const headingMatch = trimmed.match(/<h([1-3])[^>]*>/i);
    if (headingMatch) {
      const level = parseInt(headingMatch[1], 10);
      const text = stripHtmlTags(trimmed);
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
              text,
              bold: true,
              font: 'Calibri',
            }),
          ],
          spacing: { before: 200, after: 100 },
        })
      );
      continue;
    }

    // Detect list items — check for ordered vs unordered
    const isListItem = /<li[^>]*>/i.test(trimmed);
    const isOrderedItem = /<ol[^>]*>/i.test(trimmed);

    if (isListItem) {
      const text = stripHtmlTags(trimmed);
      if (text.length > 0) {
        const listProps: Record<string, unknown> = isOrderedItem
          ? { numbering: { reference: 'default-numbering', level: 0 } }
          : { bullet: { level: 0 } };
        paragraphs.push(
          new Paragraph({
            ...listProps,
            children: parseInlineFormatting(trimmed),
            spacing: { after: 60 },
          })
        );
      }
      continue;
    }

    // Regular paragraph
    const text = stripHtmlTags(trimmed);
    if (text.length > 0) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(trimmed),
          spacing: { after: 120 },
        })
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
    section.questions.sort(
      (a, b) => a.question_sequence - b.question_sequence
    );
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
  metadata: ExportBidMetadata,
  companyName: string
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
    })
  );

  // Bid title
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: metadata.bid_name,
          font: 'Calibri',
          size: 72, // 36pt
          bold: true,
          color: '1E408A',
        }),
      ],
      spacing: { after: 400 },
    })
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
    })
  );

  // Metadata items
  const metaItems: string[] = [];
  if (metadata.reference_number) {
    metaItems.push(`Reference: ${metadata.reference_number}`);
  }
  if (metadata.deadline) {
    const deadlineDate = new Date(metadata.deadline);
    metaItems.push(
      `Deadline: ${format(deadlineDate, 'dd/MM/yyyy', { locale: enGB })}`
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
      })
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
    })
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
  opts: { includeCitations: boolean; useAdvancedVariant: boolean }
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
    })
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
    `Status: ${formatStatus(question.review_status || question.status)}`
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
    })
  );

  // Response content
  const responseHtml = opts.useAdvancedVariant
    ? question.response_text_advanced || question.response_text
    : question.response_text;

  if (responseHtml) {
    paragraphs.push(...htmlToDocxParagraphs(responseHtml));
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
      })
    );
  }

  // Word count footer
  const plainText = responseHtml ? htmlToPlainText(responseHtml) : '';
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
    })
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
      })
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
    })
  );

  return paragraphs;
}

/**
 * Build the responses section containing all questions grouped by section.
 */
function buildResponsesSection(
  sections: GroupedSection[],
  opts: { includeCitations: boolean; useAdvancedVariant: boolean }
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
      })
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
                text: 'Bid Response Export',
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
    (q) => q.review_status === 'approved' || q.review_status === 'edited'
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
    })
  );

  // Calculate average confidence
  const confidenceScores: Record<string, number> = {
    strong_match: 100,
    partial_match: 60,
    needs_sme: 30,
    no_content: 0,
  };
  const questionsWithConfidence = allQuestions.filter(
    (q) => q.confidence_posture && q.confidence_posture in confidenceScores
  );
  const averageConfidence =
    questionsWithConfidence.length > 0
      ? Math.round(
          questionsWithConfidence.reduce(
            (sum, q) => sum + (confidenceScores[q.confidence_posture!] ?? 0),
            0
          ) / questionsWithConfidence.length
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
      })
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
 * @param metadata - Bid metadata for cover page
 * @param questions - Array of questions with responses
 * @param options - Export configuration
 * @returns Buffer containing the .docx file
 */
export async function generateBidDocx(
  metadata: ExportBidMetadata,
  questions: ExportQuestion[],
  options: DocxExportOptions = {}
): Promise<Buffer> {
  const {
    includeCover = true,
    includeToc = true,
    includeCitations = true,
    includeUnanswered = true,
    useAdvancedVariant = false,
    companyName = 'Knowledge Hub',
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
    })
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
