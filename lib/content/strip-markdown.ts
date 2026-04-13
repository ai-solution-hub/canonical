/**
 * Strip markdown syntax for plain-text display (search snippets, previews).
 *
 * Removes: headings (#), bold/italic (*), links ([]()), blockquotes (>),
 * code markers (`), horizontal rules (---), table pipes (|), images (![]).
 * Preserves: line breaks for paragraph separation, link text, image alt text.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\[.+?\]:\s+.+$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^```[\w]*$/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^\|[-:\s|]+\|$/gm, '')
    .replace(/^\|(.+)\|$/gm, (_match, content: string) =>
      content.replace(/\|/g, '  ').trim(),
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
