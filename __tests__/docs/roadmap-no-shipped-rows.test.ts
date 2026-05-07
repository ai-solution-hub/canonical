/**
 * Roadmap forward-discipline guard.
 *
 * The roadmap (`docs/reference/product-roadmap.md`) MUST stay forward-looking.
 * Once a row ships its narrative belongs in the State of the Product
 * (`docs/reference/state-of-the-product.md`) and the row itself should be
 * removed from the roadmap. The audit trail lives in `git log` + continuation
 * prompts; the roadmap is not the audit trail. See:
 * - `docs/reference/product-roadmap.md` line 3 ("Forward-looking only")
 * - Memory: `feedback_roadmap_forward_looking.md`
 * - Memory: `feedback_action_items_single_location.md`
 *
 * Source: S210-WP-C3 — `.planning/.research/s210-ref-doc-optimisation/C-roadmap-backlog-purge.md`
 * §6.1 (Option A — Vitest doc-freshness guard) + `D-s210-decisions-and-s211-followup.md` §WP-C.
 *
 * What this guards against. The "build the thing, mark it Done, leave the
 * row in the roadmap" pattern. The roadmap header asserts no completed
 * items; this test enforces it mechanically. Inserting a synthetic row with
 * `Status: Done S211` (or any of the forbidden status values below) MUST
 * fail CI.
 *
 * What it does NOT flag. The string "shipped" or "Done" appearing as
 * context inside other columns (Description, Item, Owner, Effort) is fine
 * because we only inspect the Status column. A Status field that mentions a
 * shipped sub-phase as context but ALSO carries forward-looking remaining
 * work (e.g. row 1.11's "EP8 spec shipped; ... EP2 build now unblocked;
 * impl remaining") is allowed because the offending tokens do not appear at
 * the START of the field. The guard fires only when the status value
 * itself is a closure marker — anchored to the leading content of the
 * Status cell, or to the explicit "Status: <closure>" inline form
 * sometimes used in the backlog Notes column.
 *
 * Skip list. Rows under `## Operational Notes` are skipped because that
 * section is operational tracking (per the doc's own note "NOT product
 * roadmap items"). Code fences are skipped to allow example tables in
 * future prose.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const PROJECT_ROOT = join(__dirname, '../..');
const ROADMAP_PATH = join(PROJECT_ROOT, 'docs/reference/product-roadmap.md');

/**
 * Forbidden status values — anchored to the BEGINNING of the Status cell
 * (after stripping leading whitespace and markdown bold markers). Word
 * boundaries ensure "Donegal" or "Closedown" don't false-positive.
 *
 * The session-suffix variants (`Shipped S\d+`, `Completed S\d+`,
 * `Done S\d+`) match the close-out tag convention used historically:
 * "Done S185 WP-D", "Shipped kh-prod-readiness-S9", "Closed S209 WP3".
 */
const FORBIDDEN_STATUS_LEADING = /^(\*\*|_|~~)?\s*(Done|Shipped|Completed|Closed|Wontfix|Resolved)\b/i;

/**
 * Inline `Status: <closure>` pattern — sometimes used inside Notes/Status
 * cells in long-form rows. Matches the explicit-tag convention.
 */
const FORBIDDEN_STATUS_INLINE = /\bStatus:\s*(Done|Shipped|Completed|Closed|Wontfix|Resolved)\b/i;

interface OffendingRow {
  lineNumber: number;
  rowId: string;
  statusCell: string;
  matchedPattern: string;
}

/**
 * Parse markdown table header to find the index of the column whose header
 * matches `Status` (case-insensitive, allowing surrounding whitespace).
 * Returns -1 if no Status column exists.
 */
function findStatusColumnIndex(headerLine: string): number {
  const cells = headerLine.split('|').map((c) => c.trim());
  for (let i = 0; i < cells.length; i++) {
    if (/^Status$/i.test(cells[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * Detect data row: starts with `|`, second cell begins with a digit or `§`
 * (handles 1.7, 9.16.10, 12.4.1 plus any future `§N.M` ID variant).
 * Excludes header separator rows (all `---`) and metric rows (e.g.
 * `| **Total** | ... |`).
 */
function isDataRow(line: string): boolean {
  if (!line.startsWith('|')) return false;
  if (/^\|[\s|:-]+\|$/.test(line)) return false;
  const cells = line.split('|');
  if (cells.length < 2) return false;
  const firstDataCell = cells[1].trim();
  return /^[\d§]/.test(firstDataCell);
}

describe('Roadmap forward-discipline guard', () => {
  it('no roadmap row may carry a closed/shipped/done Status (outside Operational Notes)', () => {
    const content = readFileSync(ROADMAP_PATH, 'utf8');
    const lines = content.split('\n');

    const offending: OffendingRow[] = [];
    let inOperationalNotes = false;
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
        inOperationalNotes = /^## Operational Notes/i.test(line);
        currentStatusColumn = -1;
        continue;
      }
      if (inOperationalNotes) continue;

      if (line.startsWith('|') && !isDataRow(line) && !/^\|[\s|:-]+\|$/.test(line)) {
        const idx = findStatusColumnIndex(line);
        currentStatusColumn = idx;
        continue;
      }

      if (!isDataRow(line)) continue;
      if (currentStatusColumn === -1) continue;

      const cells = line.split('|');
      if (currentStatusColumn >= cells.length) continue;
      const statusCell = cells[currentStatusColumn].trim();

      const leadingMatch = FORBIDDEN_STATUS_LEADING.exec(statusCell);
      const inlineMatch = FORBIDDEN_STATUS_INLINE.exec(statusCell);

      if (leadingMatch) {
        const rowId = cells[1]?.trim() ?? '???';
        offending.push({
          lineNumber: i + 1,
          rowId,
          statusCell: statusCell.slice(0, 120),
          matchedPattern: `leading "${leadingMatch[0]}"`,
        });
      } else if (inlineMatch) {
        const rowId = cells[1]?.trim() ?? '???';
        offending.push({
          lineNumber: i + 1,
          rowId,
          statusCell: statusCell.slice(0, 120),
          matchedPattern: `inline "${inlineMatch[0]}"`,
        });
      }
    }

    const formatted = offending
      .map(
        (row) =>
          `  L${row.lineNumber} (row ${row.rowId}): Status="${row.statusCell}" -- matched ${row.matchedPattern}`,
      )
      .join('\n');

    expect(
      offending,
      `Roadmap must stay forward-looking. Found ${offending.length} row(s) ` +
        `with closure markers in Status column:\n${formatted}\n\n` +
        `Fix: remove the row entirely and fold its narrative into ` +
        `\`docs/reference/state-of-the-product.md\` (§5 capabilities or §8 ` +
        `track-specific). Audit trail lives in \`git log\` + continuation ` +
        `prompts. See \`feedback_roadmap_forward_looking.md\`.`,
    ).toEqual([]);
  });

  /**
   * Self-test: confirm the regex actually fires on a synthetic offending
   * row. Without this, a regex regression that silently makes the test
   * vacuous (always green) would go unnoticed.
   */
  it('regex fires on synthetic Status: Done row', () => {
    const synthetic = '| 9.99.9 | Synthetic | desc | Engineering | ~1h | Done S210 |';
    const cells = synthetic.split('|');
    const statusCell = cells[6].trim();
    expect(FORBIDDEN_STATUS_LEADING.test(statusCell)).toBe(true);
  });

  it('regex does not fire on legitimate forward-looking Status with shipped context', () => {
    const realStatus = 'EP8 spec shipped; EP2 spec + plan shipped S200. EP2 build now unblocked; EP8 + EP2 impl remaining.';
    expect(FORBIDDEN_STATUS_LEADING.test(realStatus)).toBe(false);
    expect(FORBIDDEN_STATUS_INLINE.test(realStatus)).toBe(false);
  });
});
