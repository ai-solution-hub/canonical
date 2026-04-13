/**
 * Markdown-to-HTML conversion utility for bid response rendering.
 *
 * The content editor (`ContentEditor`) now outputs markdown directly via
 * `@tiptap/markdown`, so this module is only used by the bid response editor
 * (`ResponseEditor`) which still uses TipTap's HTML output mode.
 *
 * AI-drafted responses are stored as Markdown (from Claude's text output).
 * User-edited responses are stored as HTML (from TipTap's getHTML()).
 * This module detects which format a string is in and converts Markdown
 * to HTML when needed, so TipTap always receives valid HTML.
 */

import { marked } from 'marked';

// Configure marked for safe, sensible output
marked.use({
  breaks: false,
  gfm: true,
});

/**
 * Detect whether a string is likely HTML (from TipTap) rather than Markdown.
 * TipTap always wraps content in HTML tags like <p>, <h1>, <ul>, etc.
 */
function isHtml(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('<');
}

/**
 * Convert a response text to HTML suitable for TipTap.
 *
 * - If the text is already HTML (from a user edit), return as-is.
 * - If the text is Markdown (from AI drafting), convert to HTML.
 * - If the text is empty/null, return empty paragraph.
 */
export function responseToHtml(text: string | null | undefined): string {
  if (!text || text.trim() === '') return '<p></p>';

  // Already HTML — pass through
  if (isHtml(text)) return text;

  // Convert Markdown to HTML
  const html = marked.parse(text);

  // marked.parse can return string or Promise<string> depending on config.
  // With synchronous config (no async extensions), it returns string.
  if (typeof html === 'string') return html;

  // Fallback: wrap in paragraph tags
  return `<p>${text}</p>`;
}
