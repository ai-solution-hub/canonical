import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  BorderStyle,
} from 'docx';
import { format, parseISO } from 'date-fns';
import { enGB } from 'date-fns/locale';
import { formatDate } from '@/lib/format';
import { changeReportFrequencyLabel } from '@/lib/change-reports/change-reports-helpers';
import type { ChangeReport } from '@/types/change-reports';

/** Format a date string for filenames (e.g. "25-jan-2026") */
function formatDateForFilename(dateString: string): string {
  try {
    const date = parseISO(dateString);
    return format(date, 'd-MMM-yyyy', { locale: enGB }).toLowerCase();
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Markdown Export
// ---------------------------------------------------------------------------

/** @public */
export interface ChangeReportExportOptions {
  /** Include hyperlinks for top items */
  includeItemLinks?: boolean;
  /** Map of item ID -> URL for linking */
  itemUrls?: Record<string, string>;
}

/**
 * Convert a ChangeReport into well-structured Markdown.
 *
 * Used by "Copy as Markdown" and as input to the DOCX generator.
 */
export function changeReportToMarkdown(
  digest: ChangeReport,
  options?: ChangeReportExportOptions,
): string {
  const lines: string[] = [];

  // Title
  const title = `${changeReportFrequencyLabel(digest.frequency)}: ${formatDate(digest.period_start)} -- ${formatDate(digest.period_end)}`;

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(
    `*${digest.item_count} items | Generated ${formatDate(digest.generated_at)}*`,
  );
  lines.push('');

  // Narrative summary
  if (digest.narrative_summary) {
    lines.push('## Overview');
    lines.push('');
    lines.push(digest.narrative_summary);
    lines.push('');
  }

  // Domain summaries
  for (const ds of digest.domain_summaries) {
    lines.push(`## ${ds.domain} (${ds.item_count} items)`);
    lines.push('');
    lines.push(ds.summary);
    lines.push('');

    if (ds.top_items && ds.top_items.length > 0) {
      lines.push('### Top Items');
      lines.push('');
      for (const item of ds.top_items) {
        const url = options?.itemUrls?.[item.id];
        const titleText =
          url && options?.includeItemLinks
            ? `[${item.title}](${url})`
            : `**${item.title}**`;
        const typeLabel = item.content_type ? ` (${item.content_type})` : '';
        const notable = item.why_notable ? ` -- ${item.why_notable}` : '';
        lines.push(`- ${titleText}${typeLabel}${notable}`);
      }
      lines.push('');
    }

    if (ds.key_themes && ds.key_themes.length > 0) {
      lines.push(`*Themes: ${ds.key_themes.join(', ')}*`);
      lines.push('');
    }
  }

  // Review activity this period (governance summary)
  if (digest.governance_summary) {
    const gs = digest.governance_summary;
    lines.push('## Review Activity This Period');
    lines.push('');
    const fmtDelta = (n: number) => (n > 0 ? `+${n}` : String(n));
    lines.push(`- **Items modified:** ${fmtDelta(gs.items_modified)}`);
    lines.push(`- **Items verified:** ${fmtDelta(gs.items_verified)}`);
    lines.push(`- **Items flagged:** ${fmtDelta(gs.items_flagged)}`);
    if (gs.freshness_breakdown) {
      const fb = gs.freshness_breakdown;
      lines.push(
        `- **Freshness:** ${fb.fresh} fresh, ${fb.aging} aging, ${fb.stale} stale, ${fb.expired} expired`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown -> DOCX conversion helpers
// ---------------------------------------------------------------------------

interface MarkdownBlock {
  type: 'h1' | 'h2' | 'h3' | 'bullet' | 'italic' | 'hr' | 'paragraph';
  text: string;
}

/** Parse a Markdown string into typed blocks */
function parseMarkdown(md: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = md.split('\n');

  for (const line of lines) {
    const trimmed = line.trimEnd();

    if (trimmed === '') continue;
    if (trimmed === '---') {
      blocks.push({ type: 'hr', text: '' });
      continue;
    }
    if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'h3', text: trimmed.slice(4) });
      continue;
    }
    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'h2', text: trimmed.slice(3) });
      continue;
    }
    if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'h1', text: trimmed.slice(2) });
      continue;
    }
    if (trimmed.startsWith('- ')) {
      blocks.push({ type: 'bullet', text: trimmed.slice(2) });
      continue;
    }
    if (
      trimmed.startsWith('*') &&
      trimmed.endsWith('*') &&
      !trimmed.startsWith('**')
    ) {
      blocks.push({ type: 'italic', text: trimmed.slice(1, -1) });
      continue;
    }

    blocks.push({ type: 'paragraph', text: trimmed });
  }

  return blocks;
}

/**
 * Convert inline Markdown to an array of TextRun objects.
 *
 * Handles **bold**, *italic*, and [text](url) patterns. Links are rendered
 * as underlined blue text with the URL in parentheses (DOCX relationship-
 * based hyperlinks add considerable complexity; this gives a clear visual
 * cue without that overhead).
 */
function inlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Pattern matches: **bold**, *italic*, or [text](url)
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|\[(.+?)\]\((.+?)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Plain text before this match
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index) }));
    }

    if (match[1] !== undefined) {
      // **bold**
      runs.push(new TextRun({ text: match[1], bold: true }));
    } else if (match[2] !== undefined) {
      // *italic*
      runs.push(new TextRun({ text: match[2], italics: true }));
    } else if (match[3] !== undefined && match[4] !== undefined) {
      // [text](url) -- render as blue underlined text followed by URL
      runs.push(
        new TextRun({
          text: match[3],
          color: '2563EB',
          underline: { type: 'single' as const },
        }),
      );
      runs.push(
        new TextRun({ text: ` (${match[4]})`, color: '6B7280', size: 18 }),
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex) }));
  }

  return runs;
}

// ---------------------------------------------------------------------------
// DOCX Export
// ---------------------------------------------------------------------------

/**
 * Generate a DOCX document from a ChangeReport.
 *
 * Uses `changeReportToMarkdown` internally then converts the Markdown blocks
 * into Word paragraphs via the `docx` package.
 */
async function generateChangeReportDocx(
  digest: ChangeReport,
  options?: ChangeReportExportOptions,
): Promise<Blob> {
  const md = changeReportToMarkdown(digest, options);
  const blocks = parseMarkdown(md);

  const paragraphs: Paragraph[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'h1':
        paragraphs.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: block.text, bold: true, size: 36 })],
            spacing: { after: 200 },
          }),
        );
        break;

      case 'h2':
        paragraphs.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: block.text, bold: true, size: 28 })],
            spacing: { before: 300, after: 150 },
          }),
        );
        break;

      case 'h3':
        paragraphs.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun({ text: block.text, bold: true, size: 24 })],
            spacing: { before: 200, after: 100 },
          }),
        );
        break;

      case 'bullet':
        paragraphs.push(
          new Paragraph({
            bullet: { level: 0 },
            children: inlineRuns(block.text),
            spacing: { after: 60 },
          }),
        );
        break;

      case 'italic':
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: block.text, italics: true })],
            spacing: { after: 100 },
          }),
        );
        break;

      case 'hr':
        paragraphs.push(
          new Paragraph({
            border: {
              bottom: {
                color: 'CCCCCC',
                style: BorderStyle.SINGLE,
                size: 1,
                space: 1,
              },
            },
            spacing: { before: 200, after: 200 },
          }),
        );
        break;

      case 'paragraph':
        paragraphs.push(
          new Paragraph({
            children: inlineRuns(block.text),
            spacing: { after: 120 },
          }),
        );
        break;
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children: paragraphs,
      },
    ],
  });

  return await Packer.toBlob(doc);
}

// ---------------------------------------------------------------------------
// Download helper (browser-only)
// ---------------------------------------------------------------------------

/**
 * Generate a DOCX blob and trigger a browser download.
 *
 * Filename follows the pattern: `change-report-25-jan-24-feb-2026.docx`
 */
export async function downloadChangeReportDocx(
  digest: ChangeReport,
  options?: ChangeReportExportOptions,
): Promise<void> {
  const blob = await generateChangeReportDocx(digest, options);

  const start = formatDateForFilename(digest.period_start);
  const end = formatDateForFilename(digest.period_end);
  const filename = `change-report-${start}-${end}.docx`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
