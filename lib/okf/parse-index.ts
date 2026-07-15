/**
 * `index.md` progressive-disclosure parser — `<BundleNav>`'s data source
 * (ID-132 {132.14} G-VIEWER, TECH-ADDENDUM-reference-agents.md Part 2
 * §"Operationally defining 'progressive disclosure' for index.md").
 *
 * NATIVE ADDITION, not a lift: the reference viewer's `generator.py` SKIPS
 * `index.md` entirely, and the reference's own `regenerate_indexes()`
 * produces a flat type-grouped index — neither matches the three-level
 * disclosure PRODUCT BI-5/BI-11 define ("themes → concepts, with one-line
 * descriptions"). This module parses the KH-specific format the addendum
 * specifies: `##`/`###` headings are themes/subthemes; a
 * `* [title](path.md) — description` bullet under a heading is a concept
 * entry, with description separated by a hyphen or em dash (both accepted —
 * the exact separator glyph is not pinned by any shipped `{132.10}` writer
 * yet, since G-BUNDLE has not landed; see the Executor's discrepancy note).
 *
 * Soft-dep {132.10}: when `index.md` is absent, `<BundleNav>` falls back to
 * grouping the concept graph's nodes by `type` (a caller-side concern — this
 * module only parses text that exists; a null/undefined check belongs to
 * the route handler, matching `useBundleNav`'s `nav: BundleNavTheme[] | null`
 * contract).
 */

const HEADING_RE = /^(#{2,3})\s+(.+?)\s*$/;
// `* [title](path.md)` optionally followed by ` - description` / ` — description`.
const CONCEPT_BULLET_RE =
  /^[*-]\s*\[(.+?)\]\(([^)\s]+\.md)\)(?:\s*[-—]\s*(.*))?$/;

/** One concept entry under a theme/subtheme heading. */
export interface BundleNavConcept {
  title: string;
  /** Bundle-root-relative concept id (`.md` suffix stripped) — matches `BundleGraphNodeData.id`. */
  path: string;
  description: string;
}

/** One `##`/`###` heading node in the nav tree. */
export interface BundleNavTheme {
  heading: string;
  level: 2 | 3;
  concepts: BundleNavConcept[];
  /** `###` subthemes nested under a `##` theme; always `[]` on a level-3 node. */
  children: BundleNavTheme[];
}

function stripMdSuffix(link: string): string {
  return link.endsWith('.md') ? link.slice(0, -3) : link;
}

/**
 * Strip a leading YAML frontmatter block (`---` … `---`) — SPEC §11
 * permits the bundle-root `index.md` (and only it, among indexes) a
 * frontmatter block; the producer stamps `okf_version: "0.1"` there
 * (DR-019 house rule). The nav parser skips it rather than risking a
 * frontmatter value line ever matching a heading or bullet shape.
 */
function stripFrontmatter(lines: string[]): string[] {
  if (lines[0]?.trim() !== '---') return lines;
  const close = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  );
  return close === -1 ? lines : lines.slice(close + 1);
}

/**
 * Parse `index.md` text into a nav tree of themes → (subthemes) → concepts.
 * A leading `---` frontmatter block (the §11 `okf_version` stamp) is
 * skipped.
 *
 * Returns `[]` for content with no `##`/`###` headings (including empty
 * input) — the caller treats that the same as an absent file.
 */
export function parseBundleNav(text: string): BundleNavTheme[] {
  const themes: BundleNavTheme[] = [];
  let currentTheme: BundleNavTheme | null = null;
  let currentNode: BundleNavTheme | null = null;

  for (const rawLine of stripFrontmatter(text.split(/\r\n|\r|\n/))) {
    const headingMatch = rawLine.match(HEADING_RE);
    if (headingMatch) {
      const level = headingMatch[1].length as 2 | 3;
      const heading = headingMatch[2].trim();
      const node: BundleNavTheme = {
        heading,
        level,
        concepts: [],
        children: [],
      };
      if (level === 2) {
        themes.push(node);
        currentTheme = node;
        currentNode = node;
      } else {
        // `###` nests under the most recent `##`; a `###` with no preceding
        // `##` is treated as a top-level theme (defensive — not expected
        // from a well-formed {132.10} writer).
        if (currentTheme) {
          currentTheme.children.push(node);
        } else {
          themes.push(node);
        }
        currentNode = node;
      }
      continue;
    }

    const bulletMatch = rawLine.match(CONCEPT_BULLET_RE);
    if (bulletMatch && currentNode) {
      const [, title, link, description] = bulletMatch;
      currentNode.concepts.push({
        title,
        path: stripMdSuffix(link),
        description: description?.trim() ?? '',
      });
    }
    // Any other line (blank, prose, preamble before the first heading) is
    // ignored — the nav tree only cares about headings and concept bullets.
  }

  return themes;
}
