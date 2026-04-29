/**
 * Extract a markdown title via priority chain:
 *   1. Front-matter `title` field (string only)
 *   2. Bold line following a `# Article N` H1 (Python `extract_title` parity)
 *   3. First H1 (`^# ...`) within the first 20 body lines, skipping bare
 *      `Article N` headings
 *   4. Filename without extension, hyphens/underscores → spaces, title-cased
 *
 * `frontMatter` may be `null` when the input had no FM block or the FM was
 * malformed — the priority chain falls through to bold-after-Article-N / H1 /
 * filename in that case.
 */

export type TitleProvenance =
  | 'front-matter'
  | 'bold-after-article-n'
  | 'h1'
  | 'filename';

export interface ExtractMarkdownTitleInput {
  frontMatter: Record<string, unknown> | null;
  body: string;
  filename: string;
}

export interface ExtractedMarkdownTitle {
  title: string;
  provenance: TitleProvenance;
}

const ARTICLE_N_HEADING_RE = /^#\s+Article\s+\d+\s*$/;
const H1_RE = /^#\s+(.+)$/;
// Python parity: `re.match(r"^\*\*(.+?)\*\*", line.strip())` — no end anchor,
// so trailing text on the bold line is permitted.
const BOLD_LINE_RE = /^\*\*(.+?)\*\*/;

export function extractMarkdownTitle(
  input: ExtractMarkdownTitleInput,
): ExtractedMarkdownTitle {
  const { frontMatter, body, filename } = input;

  const fmTitle = frontMatter?.title;
  if (typeof fmTitle === 'string' && fmTitle.trim() !== '') {
    return { title: fmTitle.trim(), provenance: 'front-matter' };
  }

  const lines = body.split(/\r?\n/);

  // "# Article N" pattern + bold-line follow-up (Python parity).
  if (lines.length > 0 && ARTICLE_N_HEADING_RE.test(lines[0].trim())) {
    for (let i = 1; i < Math.min(6, lines.length); i++) {
      const boldMatch = lines[i].trim().match(BOLD_LINE_RE);
      if (boldMatch) {
        return {
          title: boldMatch[1].trim(),
          provenance: 'bold-after-article-n',
        };
      }
    }
  }

  // First H1 in first 20 lines, skipping bare "Article N".
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const h1Match = lines[i].trim().match(H1_RE);
    if (h1Match) {
      const candidate = h1Match[1].trim();
      if (!/^Article\s+\d+$/.test(candidate)) {
        return { title: candidate, provenance: 'h1' };
      }
    }
  }

  return { title: filenameToTitle(filename), provenance: 'filename' };
}

function filenameToTitle(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  const base = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const cleaned = base.replace(/[-_]+/g, ' ').trim();
  return cleaned
    .split(/\s+/)
    .map((word) =>
      word.length > 0
        ? word[0].toUpperCase() + word.slice(1).toLowerCase()
        : '',
    )
    .join(' ');
}
