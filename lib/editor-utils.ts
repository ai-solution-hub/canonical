/**
 * Utility functions for the Tiptap response editor.
 * Works on both client (DOMParser) and server (regex fallback).
 */

/** Convert HTML to plain text, handling both client and server environments */
export function htmlToPlainText(html: string): string {
  if (!html) return '';

  if (typeof window !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent ?? '';
  }

  // Server-side fallback: strip tags and decode common entities
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Count words in a plain text string */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

/** Count words directly from HTML content */
export function countWordsFromHtml(html: string): number {
  return countWords(htmlToPlainText(html));
}

/** Calculate word count compliance percentage */
export function wordCountPercentage(wordCount: number, wordLimit: number): number {
  if (wordLimit <= 0) return 100;
  return Math.round((wordCount / wordLimit) * 100);
}
