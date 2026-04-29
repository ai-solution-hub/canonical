/**
 * Strip MDX/JSX component tags and the "Documentation Index" blockquote block
 * from markdown content.
 *
 * Mirrors `clean_mdx_tags()` in `scripts/ingest_markdown.py`. PascalCase-named
 * tags only — lowercase HTML tags (`<strong>`, `<a>`, `<em>`, etc.) are
 * preserved. Import/export statements are NOT stripped here (Python parity);
 * they pass through to the downstream pipeline untouched.
 */

const MDX_TAG_RE = /<\/?[A-Z][A-Za-z]*[^>]*>/g;
const EXCESSIVE_BLANKS_RE = /\n{4,}/g;

export function cleanMdxTags(input: string): string {
  let content = stripDocumentationIndex(input);

  content = content.replace(MDX_TAG_RE, '');
  content = content.replace(EXCESSIVE_BLANKS_RE, '\n\n\n');

  return content.trim();
}

function stripDocumentationIndex(input: string): string {
  const lines = input.split(/\r?\n/);
  const out: string[] = [];
  let inDocIndex = false;

  for (const line of lines) {
    const stripped = line.trim();

    if (stripped.startsWith('> ## Documentation Index')) {
      inDocIndex = true;
      continue;
    }

    if (inDocIndex) {
      if (stripped.startsWith('>')) continue;
      // Blockquote ended — line is regular content.
      inDocIndex = false;
      if (stripped !== '') out.push(line);
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}
