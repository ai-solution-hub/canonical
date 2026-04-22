/**
 * Guard test — S186 WP-E structural prevention for the v1 content_history
 * gap.
 *
 * Context: the S186 WP-A quality gate found 475 real-content items without
 * v1 history rows. Root causes:
 *   1. Pre-S153 Python ingest scripts (closed S153 + S185 WP-D).
 *   2. `lib/mcp/tools/content.ts::create_content_item` never wrote v1
 *      history (closed S186 WP-E).
 *   3. No DB-level guarantee (closed S186 WP-E via migration
 *      `20260422060118_ensure_content_items_v1_history.sql`).
 *
 * This guard enforces two invariants going forward:
 *   A. The deferred constraint trigger migration exists in-tree.
 *   B. Every code path that inserts into `content_items` either writes a
 *      paired v1 `content_history` row OR is on the ALLOWLIST (known to
 *      rely on the DB trigger).
 *
 * If you add a new `.from('content_items').insert(...)` call, either:
 *   - Add an explicit `content_history` insert within 80 lines (see
 *     `app/api/items/route.ts` for the canonical pattern), OR
 *   - Add the file path to ALLOWLIST below with a comment explaining why.
 *
 * Either way, the DB trigger is the safety net.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const SCAN_DIRS = ['lib', 'app', 'scripts'];
const EXTENSIONS = ['.ts', '.tsx'];

/**
 * Files known to insert into content_items without a paired v1 history
 * write. These rely on the DB trigger `trg_content_items_ensure_v1_history`
 * (migration 20260422060118).
 *
 * Each entry MUST have a comment explaining why an explicit write is not
 * appropriate (e.g. the insert path is non-critical, or adding the write
 * would duplicate trigger-provided semantics).
 */
const ALLOWLIST = [
  // SI pipeline ingest — creates content_items from sector intelligence
  // feeds. Volume is low; DB trigger is sufficient backstop.
  'lib/intelligence/pipeline.ts',
  // Bid outcome integration — creates a synthetic content item summarising
  // a bid outcome. Trigger-provided auto_v1_on_insert is semantically
  // acceptable here (no human-authored change_reason is needed).
  'app/api/bids/[id]/outcome/integrate/route.ts',
  // MCP eval fixtures — not a production path; test setup only.
  'scripts/mcp-eval/fixtures.ts',
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
      out.push(relative(REPO_ROOT, full));
    }
  }
  return out;
}

interface InsertSite {
  file: string;
  line: number;
  hasPairedHistory: boolean;
}

const FROM_PATTERN = /\.from\((['"])content_items\1\)/;
// Match both `.insert(` and `.upsert(` — upsert is also a write path that
// creates a row on miss and therefore must pair with a v1 history write.
const INSERT_PATTERN = /\.(insert|upsert)\(/;
const HISTORY_INSERT_PATTERN =
  /\.from\((['"])content_history\1\)[\s\S]*?\.(insert|upsert)\(/;

function findInsertSites(): InsertSite[] {
  const sites: InsertSite[] = [];

  for (const dir of SCAN_DIRS) {
    const files = walk(dir);
    for (const file of files) {
      const content = readFileSync(join(REPO_ROOT, file), 'utf-8');
      const lines = content.split('\n');

      // File-level check: does this file contain any content_history insert?
      // A "paired" insert is anywhere-in-file since upload + batch routes can
      // have the history write hundreds of lines after the items insert.
      const fileHasHistoryInsert = HISTORY_INSERT_PATTERN.test(content);

      for (let i = 0; i < lines.length; i++) {
        if (!FROM_PATTERN.test(lines[i])) continue;
        // Check next 5 lines for .insert( — supabase-js chains may wrap.
        const window = lines.slice(i, Math.min(i + 6, lines.length)).join('\n');
        if (!INSERT_PATTERN.test(window)) continue;

        sites.push({ file, line: i + 1, hasPairedHistory: fileHasHistoryInsert });
      }
    }
  }

  return sites;
}

describe('content_items v1 history guard', () => {
  const sites = findInsertSites();

  it('at least one content_items insert site was scanned (sanity)', () => {
    // Sanity: if this fails, the scanner is broken.
    expect(sites.length).toBeGreaterThan(0);
  });

  it('every content_items insert either pairs with a v1 history write or is allowlisted', () => {
    const offenders = sites
      .filter((s) => !s.hasPairedHistory)
      .filter((s) => !ALLOWLIST.includes(s.file as (typeof ALLOWLIST)[number]));

    if (offenders.length > 0) {
      const msg = offenders
        .map((s) => `  - ${s.file}:${s.line}`)
        .join('\n');
      throw new Error(
        `Found ${offenders.length} content_items insert site(s) without paired v1 content_history write and not on ALLOWLIST:\n${msg}\n\nFix: add an explicit content_history insert within 80 lines (see app/api/items/route.ts pattern), OR add the file to ALLOWLIST with a justification comment.`,
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

  it('ALLOWLIST entries actually exist in the repo (stale-list detection)', () => {
    for (const file of ALLOWLIST) {
      expect(() => readFileSync(join(REPO_ROOT, file), 'utf-8')).not.toThrow();
    }
  });
});
