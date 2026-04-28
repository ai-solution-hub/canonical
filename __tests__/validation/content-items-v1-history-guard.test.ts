/**
 * Guard test — v1 `content_history` is now trigger-authored exclusively.
 *
 * Inversion rationale (S207 WP-A4 / spec
 * `docs/specs/ingest-path-consistency-spec.md` §3.4 AC4.4):
 *
 * The S186 design wrote v1 history rows from app code at every ingest
 * entry point (5 sites: items, items/batch, upload, ingest/url,
 * mcp/tools/content) AND fell back to a deferred trigger if any of them
 * dropped the write. The original guard test scanned for
 * `.from('content_items').insert(...)` sites and asserted that each
 * paired with a v1 history write OR appeared on an ALLOWLIST.
 *
 * S207 WP-A4 promotes ingest provenance to a typed
 * `content_items.ingest_source` column and rewrites the deferred trigger
 * to read it (Task 3.1). All five app-level v1 history writes are
 * deleted (Task 3.4). The trigger is now the SINGLE authority for v1
 * rows. The original guard's pairing requirement no longer matches the
 * production design; it is inverted here.
 *
 * Inverted invariant:
 *   No production code in `lib/`, `app/`, or `scripts/` may write a
 *   `content_history` row with `version: 1` outside the
 *   `BACKFILL_HISTORY_ALLOWLIST`. The trigger
 *   `trg_content_items_ensure_v1_history` (migration 20260422060118,
 *   rewritten by 20260428174512 via Option D) is the only authority.
 *
 * BACKFILL_HISTORY_ALLOWLIST handling (plan v1.1 fix C-1):
 *   `scripts/backfill-content-history-v1.ts` writes `version: 1` rows
 *   by design — it is the S186 backfill helper for items missing v1
 *   history. Allowlisting it is mandatory; without the allowlist the
 *   inverted guard would fail on first CI run. The script's
 *   `buildHistoryRow()` constructs rows with `version: 1`; its
 *   `.from('content_history').insert(rows)` call writes them. Both
 *   markers must remain visible in the file (validated below).
 *
 * `scripts/mcp-eval/fixtures.ts` is intentionally NOT allowlisted (plan
 * v1.1 fix C-2). The original spec §3.4 AC4.4 fix M-7 claimed it
 * "builds synthetic content_history rows for eval scenarios". That is
 * factually incorrect — verified at fixtures.ts:427 the file only
 * `.delete()`s from content_history; it never inserts. The original
 * ALLOWLIST entry exempted fixtures.ts from the OUTGOING (paired-write)
 * guard scope, which is a different scope from this inverted guard.
 * Tracked as OQ-A4-FIXTURES-ALLOWLIST in the plan §11 for spec v1.2.
 *
 * If a NEW v1 content_history insert lands in the codebase outside the
 * backfill helper, this guard will fail. The fix is one of:
 *   1. Delete the insert — the trigger covers it. (Default.)
 *   2. If the insert is a backfill helper of similar shape, add the
 *      file to BACKFILL_HISTORY_ALLOWLIST below with a comment citing
 *      the relevant spec session.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const SCAN_DIRS = ['lib', 'app', 'scripts'];
const EXTENSIONS = ['.ts', '.tsx'];

/**
 * Files that are expected to write v1 `content_history` rows.
 *
 * Each entry MUST have a comment citing the spec/session that justifies
 * the exemption AND the file MUST contain both a content_history insert
 * AND a `version: 1` marker (validated by the stale-list assertion).
 */
const BACKFILL_HISTORY_ALLOWLIST = [
  // S186 v1-history backfill helper. `buildHistoryRow()` constructs
  // rows with `version: 1`; the `.from('content_history').insert(rows)`
  // call writes them. Required by the spec's S186 backfill design.
  // See `docs/specs/backfill-content-history-v1-spec.md`.
  'scripts/backfill-content-history-v1.ts',
] as const;

function walk(dir: string, out: string[] = []): string[] {
  const abs = join(REPO_ROOT, dir);
  const entries = readdirSync(abs);
  for (const entry of entries) {
    if (
      entry.startsWith('.') ||
      entry === 'node_modules' ||
      entry === '__tests__'
    ) {
      continue;
    }
    const full = join(abs, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(relative(REPO_ROOT, full), out);
    } else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      // Skip test/spec files.
      if (entry.includes('.test.') || entry.includes('.spec.')) continue;
      // Skip generated bundles — they bake in third-party library code
      // (e.g. zod's internal version literals) that look like matches.
      if (entry === 'app-bundles.ts' || entry === 'plugin-bundle.ts') continue;
      out.push(relative(REPO_ROOT, full));
    }
  }
  return out;
}

interface V1InsertSite {
  file: string;
  line: number;
}

/**
 * A file is a v1-history INSERT site iff:
 *   (a) it contains at least one `.from('content_history').insert(` call, AND
 *   (b) it contains at least one `version: 1` literal.
 *
 * The two markers may live in the same statement (the deleted S186 pattern)
 * or be split across helper + caller (the backfill script pattern). Both
 * shapes are caught.
 */
const HISTORY_INSERT_PATTERN =
  /\.from\((['"])content_history\1\)[\s\S]{0,80}?\.(insert|upsert)\(/;
const VERSION_ONE_PATTERN = /version:\s*1(?![0-9])/;

function findV1HistoryInsertSites(): V1InsertSite[] {
  const sites: V1InsertSite[] = [];

  for (const dir of SCAN_DIRS) {
    const files = walk(dir);
    for (const file of files) {
      const content = readFileSync(join(REPO_ROOT, file), 'utf-8');
      if (!HISTORY_INSERT_PATTERN.test(content)) continue;
      if (!VERSION_ONE_PATTERN.test(content)) continue;

      // Report at the line of the first content_history insert call (most
      // useful for human readers; the version-1 literal may be elsewhere).
      const lines = content.split('\n');
      let line = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/\.from\((['"])content_history\1\)/.test(lines[i])) {
          line = i + 1;
          break;
        }
      }
      sites.push({ file, line: line === -1 ? 1 : line });
    }
  }

  return sites;
}

describe('content_items v1 history guard (inverted)', () => {
  const sites = findV1HistoryInsertSites();

  it('every v1 content_history insert site is on BACKFILL_HISTORY_ALLOWLIST', () => {
    const offenders = sites.filter(
      (s) =>
        !BACKFILL_HISTORY_ALLOWLIST.includes(
          s.file as (typeof BACKFILL_HISTORY_ALLOWLIST)[number],
        ),
    );

    if (offenders.length > 0) {
      const msg = offenders.map((s) => `  - ${s.file}:${s.line}`).join('\n');
      throw new Error(
        `Found ${offenders.length} v1 content_history insert site(s) outside BACKFILL_HISTORY_ALLOWLIST:\n${msg}\n\nExpected: v1 rows are now trigger-authored exclusively (see docs/specs/ingest-path-consistency-spec.md §3.4 AC4.4). The deferred trigger trg_content_items_ensure_v1_history is the single authority. Fix: delete the explicit v1 write — the trigger covers it. If the insert is a backfill helper of similar shape to scripts/backfill-content-history-v1.ts, add the file to BACKFILL_HISTORY_ALLOWLIST with a comment citing the spec/session.`,
      );
    }
  });

  it('the DB trigger migration is in-tree', () => {
    const migrationPath = join(
      REPO_ROOT,
      'supabase/migrations/20260422060118_ensure_content_items_v1_history.sql',
    );
    const migration = readFileSync(migrationPath, 'utf-8');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER');
    expect(migration).toContain('trg_content_items_ensure_v1_history');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('ensure_v1_history_at_commit');
    // SET search_path required per CLAUDE.md.
    expect(migration).toMatch(/SET search_path\s*=\s*public,\s*extensions/);
  });

  it('every BACKFILL_HISTORY_ALLOWLIST entry exists and writes v1 rows (stale-list detection)', () => {
    for (const file of BACKFILL_HISTORY_ALLOWLIST) {
      let content: string;
      expect(() => {
        content = readFileSync(join(REPO_ROOT, file), 'utf-8');
      }).not.toThrow();
      // Both markers must be present — the file IS expected to write v1
      // history rows. If either is missing, the allowlist entry is stale
      // (the file may have been refactored to no longer write v1 rows,
      // in which case the entry should be deleted).
      expect(HISTORY_INSERT_PATTERN.test(content!)).toBe(true);
      expect(VERSION_ONE_PATTERN.test(content!)).toBe(true);
    }
  });
});
