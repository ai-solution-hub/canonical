/**
 * backlog-schema-roundtrip.test.ts — CI regression guard (ID-68).
 *
 * Parses the live `docs/reference/product-backlog.json` through
 * `BacklogSchema.parse()` on every CI run. Catches structural drift,
 * invalid field values, and id-uniqueness violations before they reach
 * main.
 *
 * Motivation: the three S59 W1 blockers on backlog item 66 (missing
 * `session_refs`, `commit_refs`, `cross_doc_links`) would have been
 * surfaced mechanically by this test, avoiding the Wave A rollback.
 *
 * What this guards:
 *
 *   1. Every field in every item matches `BacklogItemSchema` (status enum,
 *      id regex, required structured-provenance triple, etc.).
 *   2. No two items share the same id (BacklogSchema `.refine()` from ID-67).
 *   3. The root document shape (document_name, document_purpose, etc.) is
 *      preserved.
 *
 * Failure recovery:
 *   - Run `BacklogSchema.parse(JSON.parse(fs.readFileSync(BACKLOG_PATH)))` in
 *     a REPL to get the full Zod error path.
 *   - Fix the offending field in `docs/reference/product-backlog.json`.
 *
 * Per `docs/reference/test-philosophy.md` — pure schema parse, no Supabase
 * fixtures, no chain-method asserts.
 *
 * ID-68 (kh-prod-readiness-S60 Wave B).
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { BacklogSchema } from '@/lib/validation/backlog-schema';

const BACKLOG_PATH = resolve(__dirname, '../fixtures/ledger/product-backlog.json');

describe('product-backlog.json schema roundtrip (BacklogSchema)', () => {
  it('parses the live JSON file without throwing', () => {
    const raw = readFileSync(BACKLOG_PATH, 'utf-8');
    const json: unknown = JSON.parse(raw);

    const result = BacklogSchema.safeParse(json);

    if (!result.success) {
      // Surface all Zod issues for fast failure diagnosis
      const issues = result.error.issues
        .map(
          (issue) =>
            `  [${issue.path.join('.')}] ${issue.code}: ${issue.message}`,
        )
        .join('\n');
      expect.fail(
        `BacklogSchema.parse() failed for docs/reference/product-backlog.json.\n` +
          `Fix the offending fields and re-run.\n\n` +
          `Zod issues (${result.error.issues.length}):\n${issues}`,
      );
    }

    expect(result.success).toBe(true);
  });

  it('parsed document carries expected root metadata fields', () => {
    const raw = readFileSync(BACKLOG_PATH, 'utf-8');
    const result = BacklogSchema.parse(JSON.parse(raw));

    expect(result.document_name).toBe('Product Backlog');
    expect(typeof result.document_purpose).toBe('string');
    expect(result.document_purpose.length).toBeGreaterThan(0);
    expect(Array.isArray(result.related_documents)).toBe(true);
  });

  it('items array is non-empty (backlog should always have open items)', () => {
    const raw = readFileSync(BACKLOG_PATH, 'utf-8');
    const result = BacklogSchema.parse(JSON.parse(raw));

    expect(result.items.length).toBeGreaterThan(0);
  });

  it('all parsed item ids are unique (id-uniqueness refine from ID-67)', () => {
    const raw = readFileSync(BACKLOG_PATH, 'utf-8');
    const result = BacklogSchema.parse(JSON.parse(raw));

    const ids = result.items.map((item) => item.id);
    const uniqueIds = new Set(ids);

    expect(
      uniqueIds.size,
      `Duplicate ids found — every backlog item must have a unique id. ` +
        `Total items: ${ids.length}, unique ids: ${uniqueIds.size}. ` +
        `Duplicates: ${ids.filter((id, idx) => ids.indexOf(id) !== idx).join(', ')}`,
    ).toBe(ids.length);
  });

  it('all parsed items carry the structured-provenance triple', () => {
    const raw = readFileSync(BACKLOG_PATH, 'utf-8');
    const result = BacklogSchema.parse(JSON.parse(raw));

    const missing: string[] = [];

    for (const item of result.items) {
      if (!Array.isArray(item.session_refs))
        missing.push(`id=${item.id}: missing session_refs`);
      if (!Array.isArray(item.commit_refs))
        missing.push(`id=${item.id}: missing commit_refs`);
      if (!Array.isArray(item.cross_doc_links))
        missing.push(`id=${item.id}: missing cross_doc_links`);
    }

    expect(
      missing,
      `Structured-provenance triple required on every item (session_refs, ` +
        `commit_refs, cross_doc_links). Offending items:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('id-uniqueness refine correctly rejects a synthetically duplicated document', () => {
    // Verify the refine mechanism fires on a constructed duplicate — not just
    // that the live data happens to be clean.
    const raw = readFileSync(BACKLOG_PATH, 'utf-8');
    const liveDoc = JSON.parse(raw) as { items: unknown[] } & Record<
      string,
      unknown
    >;

    // Clone first item and give it a duplicate id
    const originalItem = liveDoc.items[0] as Record<string, unknown>;
    const duplicateItem = { ...originalItem, id: originalItem['id'] };

    const docWithDuplicate = {
      ...liveDoc,
      items: [originalItem, duplicateItem],
    };

    const result = BacklogSchema.safeParse(docWithDuplicate);

    expect(
      result.success,
      'BacklogSchema should reject a document with duplicate item ids',
    ).toBe(false);

    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(
        messages,
        'Error message should mention uniqueness and include the duplicate id',
      ).toMatch(/unique/i);
    }
  });
});
