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

  // Server-side fallback: strip tags and decode common entities.
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer)>/gi,
      '\n',
    );
  // Strip tags in a loop so that removing one match cannot let its neighbours
  // recombine into a fresh tag (e.g. "<scr<script>ipt>") — single-pass
  // stripping is incomplete sanitization (CodeQL js/incomplete-multi-character-
  // sanitization). Each pass strictly shrinks the string, so this terminates.
  let prev: string;
  do {
    prev = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== prev);
  // Drop any leftover unclosed tag fragment (e.g. "<script src=x" with no ">"),
  // which the tag regex above cannot match — otherwise "<script" could survive.
  text = text.replace(/<[^>]*$/g, '');
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
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
export function wordCountPercentage(
  wordCount: number,
  wordLimit: number,
): number {
  if (wordLimit <= 0) return 100;
  return Math.round((wordCount / wordLimit) * 100);
}
