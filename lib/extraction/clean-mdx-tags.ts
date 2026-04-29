/**
 * Strip MDX/JSX component tags, import/export statements, and the
 * "Documentation Index" blockquote block from markdown content.
 *
 * Mirrors `clean_mdx_tags()` in `scripts/ingest_markdown.py`. Differences:
 * also strips top-level `import ... from ...` and `export ...` lines (MDX
 * file convention). PascalCase-named tags only — lowercase HTML tags
 * (`<strong>`, `<a>`, `<em>`, etc.) are preserved.
 */

const MDX_TAG_RE = /<\/?[A-Z][A-Za-z0-9]*[^>]*>/g;
const IMPORT_LINE_RE = /^import\s.+$/gm;
const EXPORT_LINE_RE = /^export\s.+$/gm;
const EXCESSIVE_BLANKS_RE = /\n{4,}/g;

export function cleanMdxTags(input: string): string {
  let content = stripDocumentationIndex(input);

  content = content.replace(IMPORT_LINE_RE, '');
  content = content.replace(EXPORT_LINE_RE, '');
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
