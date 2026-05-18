/**
 * Backlog forward-discipline guard (JSON edition).
 *
 * The active backlog (`docs/reference/product-backlog.json`) MUST NOT
 * carry items in a closed/completed/shipped/wontfix state. Once closed,
 * the audit trail belongs in `git log` + continuation prompts + the
 * State of the Product narrative; the item itself should be removed.
 *
 * Migrated from MD-table parsing in S37 close-out as part of the
 * product-backlog MD → JSON cutover. Source: feedback memory
 * `feedback_action_items_single_location` and `feedback_roadmap_forward_looking`.
 *
 * What this guards against:
 *
 *   1. Any `status` field outside the canonical forward-only enum
 *      (`needs_spec`, `needs_research`, `parked`, `ready`, `blocked`).
 *      Forbidden values: `closed`, `completed`, `done`, `shipped`,
 *      `wontfix`, `resolved`.
 *   2. A `notes` body whose first non-blank token is one of the closure
 *      markers above (legacy strikethrough convention surfacing in prose).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { BacklogStatus } from '@/lib/validation/backlog-schema';

const PROJECT_ROOT = join(__dirname, '../..');
const BACKLOG_PATH = join(PROJECT_ROOT, 'docs/reference/product-backlog.json');

// Transitional: canonical BacklogStatus values (spec_needed | needs_research |
// parked | ready | blocked) plus the legacy `needs_spec` form still present in
// the existing 36 items. The canonical `spec_needed` form is the schema truth;
// `needs_spec` is a legacy alias that will be retrofitted in FU-NEW when items
// are updated. This union allows the forward-discipline guard to continue
// passing without modifying the live backlog data prematurely.
// TODO(FU-NEW): remove 'needs_spec' from this set after the backlog retrofit.
const ALLOWED_STATUSES = new Set([
  ...BacklogStatus.options,
  'needs_spec', // transitional: existing items use needs_spec; canonical is spec_needed; FU-NEW retrofits items
]);

const FORBIDDEN_STATUS_TOKENS = new Set([
  'closed',
  'completed',
  'done',
  'shipped',
  'wontfix',
  'resolved',
]);

const FORBIDDEN_NOTES_LEADING = /^\s*(\*\*|_|~~)?\s*(Done|Shipped|Completed|Closed|Wontfix|Resolved)\b/i;

interface BacklogItem {
  id: string;
  status: string;
  notes: string | null;
  description: string;
}

interface BacklogDocument {
  document_name: string;
  items: BacklogItem[];
}

interface OffendingItem {
  id: string;
  reason: string;
  excerpt: string;
}

describe('Backlog forward-discipline guard (JSON)', () => {
  it('exposes a parseable JSON document', () => {
    const raw = readFileSync(BACKLOG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as BacklogDocument;
    expect(parsed.document_name).toBe('Product Backlog');
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(parsed.items.length).toBeGreaterThan(0);
  });

  it('every item carries an allowed status enum value', () => {
    const raw = readFileSync(BACKLOG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as BacklogDocument;

    const offending: OffendingItem[] = [];

    for (const item of parsed.items) {
      const status = (item.status ?? '').trim();
      if (!ALLOWED_STATUSES.has(status)) {
        offending.push({
          id: item.id,
          reason: `status="${status}" not in allowed enum`,
          excerpt: `description: ${item.description.slice(0, 80)}`,
        });
        continue;
      }
      if (FORBIDDEN_STATUS_TOKENS.has(status.toLowerCase())) {
        offending.push({
          id: item.id,
          reason: `status="${status}" is a closure marker`,
          excerpt: `description: ${item.description.slice(0, 80)}`,
        });
      }
    }

    const formatted = offending
      .map((row) => `  ${row.id}: ${row.reason} -- "${row.excerpt}"`)
      .join('\n');

    expect(
      offending,
      `Backlog must contain only forward/open items. Found ${offending.length} ` +
        `closed-but-retained item(s):\n${formatted}\n\n` +
        `Fix: remove the item from product-backlog.json. The audit trail lives ` +
        `in \`git log\` + continuation prompts + State of the Product narrative; ` +
        `closed items belong in \`docs/reference/product-backlog-completed.md\` ` +
        `if archive is wanted.`,
    ).toEqual([]);
  });

  it('no item notes start with a closure marker', () => {
    const raw = readFileSync(BACKLOG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as BacklogDocument;

    const offending: OffendingItem[] = [];

    for (const item of parsed.items) {
      if (!item.notes) continue;
      if (FORBIDDEN_NOTES_LEADING.test(item.notes)) {
        offending.push({
          id: item.id,
          reason: 'notes prefix is a closure marker',
          excerpt: item.notes.slice(0, 120),
        });
      }
    }

    const formatted = offending
      .map((row) => `  ${row.id}: ${row.reason} -- "${row.excerpt}"`)
      .join('\n');

    expect(
      offending,
      `No item may have notes starting with a closure marker. Found ${offending.length} ` +
        `offending item(s):\n${formatted}`,
    ).toEqual([]);
  });

  it('rejects synthetic Done status', () => {
    const sample = { id: 'TEST-1', status: 'Done', notes: null, description: 'x' };
    expect(ALLOWED_STATUSES.has(sample.status)).toBe(false);
  });

  it('accepts canonical forward statuses', () => {
    for (const status of ALLOWED_STATUSES) {
      expect(FORBIDDEN_STATUS_TOKENS.has(status.toLowerCase())).toBe(false);
    }
  });
});
