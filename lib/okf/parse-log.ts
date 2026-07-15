/**
 * `log.md` read-only change-log parser — `<BundleLog>`'s data source
 * (ID-132 {132.14} G-VIEWER; format contract per OKF SPEC v0.1 §7 as
 * adopted by the ID-132 conformance wave).
 *
 * The producer's `bundle_writer.append_log_entry` is the format source of
 * truth: `## YYYY-MM-DD` ISO-8601 DATE headings (§7 MUST), newest date
 * FIRST (prepend); within a date section each run's records are
 * `* **Run <ISO-ts> — <Action> (N):** …` bullets, newest run first, every
 * bullet carrying its full run timestamp (BI-11 per-run visibility).
 * Non-bullet continuation lines (nested validator sub-bullets, the
 * git-sync `### git-sync reconcile findings` block) attach to the run
 * whose bullets they follow.
 *
 * LEGACY fallback (pre-conformance format — `## <ISO-8601 timestamp>` run
 * headings, append-only, most-recent-LAST): when a file contains NO
 * `**Run <ts> — …**` bullets at all, each `##` section is one entry and
 * the order is reversed on read, exactly as the pre-§7 parser behaved.
 */

/** One producer-run record from `log.md`. */
export interface BundleLogEntry {
  /** The run's ISO-8601 timestamp (from its `**Run <ts> — …**` bullets); a section heading for legacy/unstructured sections; `''` when the file has no headings at all. */
  heading: string;
  /** The run's markdown lines (change summary / warnings / findings). */
  body: string;
}

const DATE_HEADING_RE = /^##\s+(.+?)\s*$/;
// `* **Run <ISO-ts> — …**` — the §7 per-run bullet; em dash from the
// writer, ASCII hyphen tolerated.
const RUN_BULLET_RE = /^\*\s+\*\*Run\s+(\S+)\s+[—-]/;

interface Section {
  heading: string;
  lines: string[];
}

function splitSections(lines: string[]): {
  sections: Section[];
  hasHeadings: boolean;
} {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const match = line.match(DATE_HEADING_RE);
    if (match) {
      current = { heading: match[1], lines: [] };
      sections.push(current);
      continue;
    }
    // Content before the first `##` heading (e.g. a `#` title) is discarded.
    current?.lines.push(line);
  }
  return { sections, hasHeadings: sections.length > 0 };
}

function entriesForSection(section: Section): {
  entries: BundleLogEntry[];
  sawRunBullets: boolean;
} {
  const entries: BundleLogEntry[] = [];
  const preamble: string[] = [];
  let currentTs: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentTs !== null) {
      entries.push({
        heading: currentTs,
        body: currentLines.join('\n').trim(),
      });
    }
    currentTs = null;
    currentLines = [];
  };

  for (const line of section.lines) {
    const match = line.match(RUN_BULLET_RE);
    if (match) {
      if (match[1] !== currentTs) {
        flush();
        currentTs = match[1];
      }
      currentLines.push(line);
    } else if (currentTs !== null) {
      // Continuation of the open run group — nested sub-bullets, blank
      // separators, or an inserted `###` findings block.
      currentLines.push(line);
    } else {
      preamble.push(line);
    }
  }
  flush();

  const sawRunBullets = entries.length > 0;
  const preambleBody = preamble.join('\n').trim();
  if (preambleBody) {
    // A section with content but no run bullets (legacy or hand-authored)
    // — or stray prose above the first run bullet — keeps the section
    // heading as its entry heading.
    entries.unshift({ heading: section.heading, body: preambleBody });
  } else if (!sawRunBullets) {
    // Headed but empty section — still surface the heading.
    entries.push({ heading: section.heading, body: '' });
  }
  return { entries, sawRunBullets };
}

/**
 * Parse `log.md` into reverse-chronological run entries (most recent
 * first). Under the §7 format that is simply DOCUMENT ORDER — the writer
 * prepends: newest date section first, newest run's bullets first within
 * a section. Legacy files (no `**Run …**` bullets anywhere) are reversed
 * on read, preserving the pre-§7 append-only contract.
 *
 * When the file has no `##` headings at all, the entire (trimmed) content
 * is returned as a single unheaded entry — unless it is empty or
 * whitespace-only, in which case `[]` is returned.
 */
export function parseBundleLog(text: string): BundleLogEntry[] {
  const lines = text.split(/\r\n|\r|\n/);
  const { sections, hasHeadings } = splitSections(lines);

  if (!hasHeadings) {
    const trimmed = text.trim();
    return trimmed ? [{ heading: '', body: trimmed }] : [];
  }

  const entries: BundleLogEntry[] = [];
  let sawAnyRunBullets = false;
  for (const section of sections) {
    const parsed = entriesForSection(section);
    sawAnyRunBullets = sawAnyRunBullets || parsed.sawRunBullets;
    entries.push(...parsed.entries);
  }

  // Legacy (pre-§7) files are append-only, most-recent-LAST — reverse.
  return sawAnyRunBullets ? entries : entries.reverse();
}
