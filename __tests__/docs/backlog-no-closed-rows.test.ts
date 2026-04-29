/**
 * Backlog forward-discipline guard.
 *
 * The active backlog (`docs/reference/product-backlog.md` sections 2-6) MUST
 * NOT carry rows that have been closed, completed, or marked Wontfix. Once
 * closed, the audit trail belongs in `git log` + continuation prompts +
 * the State of the Product narrative; the backlog row itself should be
 * removed. The historical "keep but strike through" convention was retired
 * in S210 — see `D-s210-decisions-and-s211-followup.md` section WP-C and
 * memory `feedback_roadmap_forward_looking.md`.
 *
 * Source: S210-WP-C3 — `.planning/.research/s210-ref-doc-optimisation/C-roadmap-backlog-purge.md`
 * section 6.1 plus `D-s210-decisions-and-s211-followup.md` section WP-C.
 *
 * What this guards against. Two failure modes:
 *   1. Strikethrough markers `~~OPS-N~~` on the row ID -- historical
 *      keep-but-mark-closed convention which generates noise without
 *      providing forward value.
 *   2. Status column (or inline `Status:` in long-form Notes) reading
 *      `Done`, `Closed`, `Completed`, `Wontfix`, `Resolved`, or `Shipped`
 *      with or without a session suffix.
 *
 * What it does NOT flag. The string "shipped"/"closed"/"done" appearing
 * as context inside a Description, Notes, or Effort field is fine because
 * the leading-anchor regex requires the offending word at the START of
 * the Status cell. Only the explicit "Status: <closure>" form is matched
 * inline (the conventional pattern for embedded closure markers in
 * long-form note text).
 *
 * Skip list. Rows under `## 7. Archive` are skipped because that section
 * is the closed-out archive (the metric table at lines 196-200 contains
 * `**Done (archived)**` etc. which are summary metrics, not active
 * backlog rows). The section 1 Summary metric table (`Total active items`
 * etc.) is naturally skipped because it has no Status column.
 *
 * Code fences are skipped to allow example tables in future prose.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const PROJECT_ROOT = join(__dirname, '../..');
const BACKLOG_PATH = join(PROJECT_ROOT, 'docs/reference/product-backlog.md');

const FORBIDDEN_STATUS_LEADING = /^(\*\*|_|~~)?\s*(Done|Shipped|Completed|Closed|Wontfix|Resolved)\b/i;

const FORBIDDEN_STATUS_INLINE = /\bStatus:\s*(Done|Shipped|Completed|Closed|Wontfix|Resolved)\b/i;

const STRIKETHROUGH_ID = /^\s*~~[^~]+~~\s*$/;

interface OffendingRow {
  lineNumber: number;
  rowId: string;
  reason: string;
  excerpt: string;
}

function findStatusColumnIndex(headerLine: string): number {
  const cells = headerLine.split('|').map((c) => c.trim());
  for (let i = 0; i < cells.length; i++) {
    if (/^Status$/i.test(cells[i])) {
      return i;
    }
  }
  return -1;
}

function isDataRow(line: string): boolean {
  if (!line.startsWith('|')) return false;
  if (/^\|[\s|:-]+\|$/.test(line)) return false;
  const cells = line.split('|');
  if (cells.length < 2) return false;
  const firstDataCell = cells[1].trim();
  if (!firstDataCell) return false;
  if (/^\*\*/.test(firstDataCell)) return false;
  // Backlog IDs always carry at least one hyphen between alphanumeric
  // segments (OPS-1, C2-PA5, F-11, MCP-EMBED-1, S153-Mobile-1,
  // FIX-S207-WPA4-1, ENG-TAX-SIMPLIFY). Optional ~~strikethrough~~ wrap.
  // Header cells like "ID", "Metric", "Deferred -- Onboarding Track" do
  // not have an ID-shape hyphen so they correctly fail this check.
  return /^(~~)?[A-Z][\w]*-[\w-]+(~~)?$/.test(firstDataCell);
}

describe('Backlog forward-discipline guard', () => {
  it('no backlog row may be strikethrough or carry a closure Status (outside section 7 Archive)', () => {
    const content = readFileSync(BACKLOG_PATH, 'utf8');
    const lines = content.split('\n');

    const offending: OffendingRow[] = [];
    let inArchive = false;
    let inCodeFence = false;
    let currentStatusColumn = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('```')) {
        inCodeFence = !inCodeFence;
        continue;
      }
      if (inCodeFence) continue;

      if (line.startsWith('## ')) {
        inArchive = /^##\s*7\.\s*Archive/i.test(line);
        currentStatusColumn = -1;
        continue;
      }
      if (inArchive) continue;

      if (line.startsWith('|') && !isDataRow(line) && !/^\|[\s|:-]+\|$/.test(line)) {
        const idx = findStatusColumnIndex(line);
        currentStatusColumn = idx;
        continue;
      }

      if (!isDataRow(line)) continue;

      const cells = line.split('|');
      const idCell = cells[1]?.trim() ?? '';

      if (STRIKETHROUGH_ID.test(idCell)) {
        offending.push({
          lineNumber: i + 1,
          rowId: idCell,
          reason: 'strikethrough ID',
          excerpt: line.trim().slice(0, 120),
        });
        continue;
      }

      if (currentStatusColumn !== -1 && currentStatusColumn < cells.length) {
        const statusCell = cells[currentStatusColumn].trim();

        const leadingMatch = FORBIDDEN_STATUS_LEADING.exec(statusCell);
        if (leadingMatch) {
          offending.push({
            lineNumber: i + 1,
            rowId: idCell,
            reason: `Status leading "${leadingMatch[0]}"`,
            excerpt: statusCell.slice(0, 120),
          });
          continue;
        }
        const inlineMatch = FORBIDDEN_STATUS_INLINE.exec(statusCell);
        if (inlineMatch) {
          offending.push({
            lineNumber: i + 1,
            rowId: idCell,
            reason: `Status inline "${inlineMatch[0]}"`,
            excerpt: statusCell.slice(0, 120),
          });
          continue;
        }
      }

      const inlineAnywhere = FORBIDDEN_STATUS_INLINE.exec(line);
      if (inlineAnywhere) {
        offending.push({
          lineNumber: i + 1,
          rowId: idCell,
          reason: `inline "${inlineAnywhere[0]}" in row`,
          excerpt: line.trim().slice(0, 120),
        });
      }
    }

    const formatted = offending
      .map(
        (row) =>
          `  L${row.lineNumber} (row ${row.rowId}): ${row.reason} -- "${row.excerpt}"`,
      )
      .join('\n');

    expect(
      offending,
      `Backlog must contain only forward/open items. Found ${offending.length} ` +
        `closed-but-retained row(s):\n${formatted}\n\n` +
        `Fix: remove the row entirely. The audit trail lives in \`git log\` + ` +
        `continuation prompts + State of the Product narrative; closed rows ` +
        `belong in \`docs/reference/product-backlog-completed.md\` if archive ` +
        `is wanted. The strikethrough-and-keep convention was retired in S210 ` +
        `(see \`D-s210-decisions-and-s211-followup.md\` section WP-C).`,
    ).toEqual([]);
  });

  it('regex fires on synthetic strikethrough ID', () => {
    const idCell = '~~OPS-1~~';
    expect(STRIKETHROUGH_ID.test(idCell)).toBe(true);
  });

  it('regex fires on synthetic Status: Done row', () => {
    const statusCell = 'Done S210 WP-A';
    expect(FORBIDDEN_STATUS_LEADING.test(statusCell)).toBe(true);
  });

  it('regex fires on inline Status: Closed marker', () => {
    const line = '| OPS-99 | desc | Open | ~1h | Low | Status: Closed S211 -- see git log |';
    expect(FORBIDDEN_STATUS_INLINE.test(line)).toBe(true);
  });

  it('regex does not fire on legitimate Open Status with shipped context', () => {
    const realStatus = 'Open -- Reframed S196';
    expect(FORBIDDEN_STATUS_LEADING.test(realStatus)).toBe(false);
    expect(FORBIDDEN_STATUS_INLINE.test(realStatus)).toBe(false);
  });

  it('isDataRow accepts standard backlog ID formats', () => {
    expect(isDataRow('| OPS-1 | desc | ... |')).toBe(true);
    expect(isDataRow('| C2-PA5 | desc | ... |')).toBe(true);
    expect(isDataRow('| F-11 | desc | ... |')).toBe(true);
    expect(isDataRow('| MCP-EMBED-1 | desc | ... |')).toBe(true);
    expect(isDataRow('| S153-Mobile-1 | desc | ... |')).toBe(true);
    expect(isDataRow('| FIX-S207-WPA4-1 | desc | ... |')).toBe(true);
    expect(isDataRow('| ~~OPS-1~~ | desc | ... |')).toBe(true);
  });

  it('isDataRow rejects header, separator, and metric rows', () => {
    expect(isDataRow('| ID | Description | Status |')).toBe(false);
    expect(isDataRow('| --- | --- | --- |')).toBe(false);
    expect(isDataRow('| **Total active items** | 57 |')).toBe(false);
  });
});
