/**
 * DOCX-to-markdown conversion helpers for the bid library ingest pipeline.
 *
 * Uses the two-step mammoth HTML -> Turndown markdown approach per CLAUDE.md
 * gotcha: mammoth.convertToMarkdown() silently drops tables. This module uses
 * mammoth.convertToHtml() followed by Turndown (with turndown-plugin-gfm) to
 * preserve full table structure.
 *
 * Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md ss6.3.
 */

import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

function createTurndownService(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });
  turndown.use(gfm);
  return turndown;
}

const sharedTurndown = createTurndownService();

/**
 * Convert a DOCX file buffer to full-document markdown.
 *
 * This is the whole-document conversion path. For Q&A table cell extraction,
 * use `extractQaPairs()` from `extract-qa-pairs.ts` which applies Turndown
 * per-cell.
 *
 * @param buffer - The DOCX file as a Buffer or ArrayBuffer
 * @returns The full document as GFM markdown
 */
export async function docxBufferToMarkdown(
  buffer: Buffer | ArrayBuffer,
): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return sharedTurndown.turndown(html).trim();
}

/**
 * Convert an HTML string to GFM markdown.
 *
 * Used for per-cell conversion where mammoth has already produced HTML
 * for individual table cells (or any HTML fragment).
 *
 * @param html - An HTML string to convert
 * @returns GFM markdown
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return '';
  return sharedTurndown.turndown(html).trim();
}

/**
 * Convert a DOCX file buffer to HTML.
 *
 * Exposed for internal use by the Q&A extractor which needs the raw HTML
 * to parse table structures before converting individual cells.
 *
 * @param buffer - The DOCX file as a Buffer or ArrayBuffer
 * @returns The document as HTML
 */
export async function docxBufferToHtml(
  buffer: Buffer | ArrayBuffer,
): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return html;
}
