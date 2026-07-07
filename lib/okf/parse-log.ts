/**
 * `log.md` read-only change-log parser — `<BundleLog>`'s data source
 * (ID-132 {132.14} G-VIEWER, TECH-ADDENDUM-reference-agents.md Part 2:
 * "read-only `log.md` `<BundleLog>`: `log.md` read-only, reverse-chronological
 * (ISO-8601 dates, DR-019)").
 *
 * NATIVE ADDITION: the reference agent has no `log.md` equivalent (TECH.md
 * "cross-cutting takeaways" §2 — no reference review surface). TECH.md:252-255
 * only specifies that `{132.10}` G-BUNDLE's `log.md` writer "appends one
 * block per producer run" (concepts added/changed/removed/moved + orphaned-
 * anchor warnings) — it does not pin an exact heading syntax, and {132.10}
 * has not shipped yet. This parser adopts the natural convention implied by
 * DR-019 (ISO-8601 timestamps) and BI-11 (append-only blocks): each run is a
 * `## <ISO-8601 timestamp>` heading followed by its change-summary body.
 * Flagged for the Executor's discrepancy report — {132.10}'s eventual writer
 * is the source of truth and this parser should be reconciled against it
 * when it lands.
 */

/** One producer-run block from `log.md`. */
export interface BundleLogEntry {
  /** The `##` heading text for this run (an ISO-8601 timestamp per DR-019); `''` when the file has no run headings. */
  heading: string;
  /** The block's markdown body (change summary / warnings). */
  body: string;
}

const RUN_HEADING_RE = /^##\s+(.+?)\s*$/;

/**
 * Parse `log.md` into reverse-chronological run entries (most recent first —
 * `log.md` is append-only, so the LAST `##` heading in the file is the most
 * recent run).
 *
 * When the file has no `##` run headings at all, the entire (trimmed)
 * content is returned as a single unheaded entry — unless it is empty or
 * whitespace-only, in which case `[]` is returned. Any content before the
 * first `##` heading (e.g. a `#` document title) is discarded.
 */
export function parseBundleLog(text: string): BundleLogEntry[] {
  const lines = text.split(/\r\n|\r|\n/);

  const headingIndices: { index: number; heading: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(RUN_HEADING_RE);
    if (match) headingIndices.push({ index: i, heading: match[1] });
  }

  if (headingIndices.length === 0) {
    const trimmed = text.trim();
    return trimmed ? [{ heading: '', body: trimmed }] : [];
  }

  const entries: BundleLogEntry[] = [];
  for (let i = 0; i < headingIndices.length; i++) {
    const { index, heading } = headingIndices[i];
    const nextIndex = headingIndices[i + 1]?.index ?? lines.length;
    const body = lines
      .slice(index + 1, nextIndex)
      .join('\n')
      .trim();
    entries.push({ heading, body });
  }

  return entries.reverse();
}
