import { turndown } from '@/lib/extraction/turndown';

function isHtml(text: string): boolean {
  return text.trimStart().startsWith('<');
}

export function htmlToMarkdown(text: string | null | undefined): string {
  if (!text || text.trim() === '') return '';
  if (!isHtml(text)) return text;
  return turndown.turndown(text).trim();
}
