/**
 * S153 — content_history.change_reason guard test.
 *
 * Ensures every production code site that inserts into `content_history`
 * provides a `change_reason` field. The column is free-text (see the
 * S152B migration) but every TS/Python write path in the repo is expected
 * to supply one of the canonical values documented in
 * `docs/reference/data-entry-points.md` Appendix D.
 *
 * Structural grep rather than per-route mock test — the wiring is
 * mechanical and the risk is that a NEW content_history insert lands
 * without change_reason, silently regressing provenance.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const INCLUDE_DIRS = ['app', 'lib', 'scripts'];
const EXCLUDE_DIR_SEGMENTS = [
  'node_modules',
  '.next',
  '.turbo',
  '__tests__',
  'mcp-eval',
  '__pycache__',
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    if (EXCLUDE_DIR_SEGMENTS.some((seg) => full.includes(seg))) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|py)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = INCLUDE_DIRS.flatMap((d) =>
  walk(path.join(REPO_ROOT, d)),
);

function findInsertBlocks(
  filePath: string,
): Array<{ file: string; line: number; block: string }> {
  const content = readFileSync(filePath, 'utf-8');
  const blocks: Array<{ file: string; line: number; block: string }> = [];
  const tsRegex = /\.from\(\s*['"]content_history['"]\s*\)\s*\.insert\b/g;
  let match: RegExpExecArray | null;
  while ((match = tsRegex.exec(content)) !== null) {
    const startIdx = match.index;
    const priorText = content.slice(0, startIdx);
    const lineNumber = priorText.split('\n').length;
    const block = content.slice(startIdx, startIdx + 800);
    blocks.push({ file: filePath, line: lineNumber, block });
  }
  return blocks;
}

describe('content_history.change_reason guard (S153)', () => {
  it('every TS content_history.insert call provides change_reason', () => {
    const violations: string[] = [];
    for (const file of SOURCE_FILES) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
      const blocks = findInsertBlocks(file);
      if (blocks.length === 0) continue;
      // File-level fallback: if insert passes a variable (e.g. a row built
      // by a helper function in the same file), the inline-object check
      // will miss it. Accept the file if `change_reason:` appears anywhere
      // in the file AND the helper-consumer pattern (a .insert(<identifier>)
      // call) is present. See S186 WP-E backfill script for the pattern.
      const fileContent = readFileSync(file, 'utf-8');
      const fileHasChangeReason = /\bchange_reason\s*:/.test(fileContent);
      for (const { line, block } of blocks) {
        const braceStart = block.indexOf('{');
        // Detect variable-argument inserts: `.insert(rows)` / `.insert(row)`.
        // Check the first ~5 lines since supabase-js chains commonly wrap:
        //   .from('content_history')\n    .insert(rows)\n    .select(...)
        const openingBlock = block.split('\n').slice(0, 5).join('\n');
        const variableInsert =
          /\.insert\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\)/.test(openingBlock);
        if (braceStart === -1) {
          if (variableInsert && fileHasChangeReason) continue;
          violations.push(
            `${file.replace(REPO_ROOT + '/', '')}:${line} — insert without object literal`,
          );
          continue;
        }
        let depth = 0;
        let braceEnd = -1;
        for (let i = braceStart; i < block.length; i++) {
          if (block[i] === '{') depth++;
          else if (block[i] === '}') {
            depth--;
            if (depth === 0) {
              braceEnd = i;
              break;
            }
          }
        }
        if (braceEnd === -1) continue;
        const objectLiteral = block.slice(braceStart, braceEnd + 1);
        if (!/\bchange_reason\s*:/.test(objectLiteral)) {
          // Variable-argument case again: `.insert(rows)` followed by
          // unrelated `{` (e.g. `if (error) {`). Accept if file has
          // change_reason elsewhere (helper pattern).
          if (variableInsert && fileHasChangeReason) continue;
          violations.push(
            `${file.replace(REPO_ROOT + '/', '')}:${line} — missing change_reason`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('Python store.py exposes insert_content_history_entry with canonical default', () => {
    const storePath = path.join(REPO_ROOT, 'scripts/kb_pipeline/store.py');
    const content = readFileSync(storePath, 'utf-8');
    expect(content).toMatch(/def insert_content_history_entry\(/);
    expect(content).toMatch(/change_reason:\s*str\s*=\s*["']initial_ingest["']/);
    expect(content).toMatch(
      /PIPELINE_SERVICE_ACCOUNT_USER_ID\s*=\s*["']a0000000-0000-4000-8000-000000000001["']/,
    );
  });

  it('Python pipeline v1-history is guaranteed by DB trigger (OPS-20 Step 1 no-op)', () => {
    // S185 WP-D centralised v1-history in post_insert.py; S186 added
    // DB trigger `trg_content_items_ensure_v1_history` (migration
    // 20260422060118) as a backstop. OPS-20 (S188 WP2) made
    // post_insert.py Step 1 a deliberate no-op because the trigger fires
    // first at transaction commit, leaving the app-level INSERT to hit the
    // UNIQUE (content_item_id, version) constraint and silent-fail.
    //
    // Guard intent: every Python ingest path produces exactly one v1
    // `content_history` row. The guarantee now lives at the DB layer.
    // This guard verifies: (a) the trigger migration exists and creates
    // the trigger, (b) post_insert.py documents the no-op contract, and
    // (c) callers still invoke run_post_insert so the broader pipeline
    // (embedding / chunks / entities / temporal) still runs.
    const triggerMigration = 'supabase/migrations/20260422060118_ensure_content_items_v1_history.sql';
    const triggerContent = readFileSync(path.join(REPO_ROOT, triggerMigration), 'utf-8');
    expect(
      triggerContent,
      `${triggerMigration} should create trg_content_items_ensure_v1_history`,
    ).toMatch(/trg_content_items_ensure_v1_history/);

    const helperPath = 'scripts/kb_pipeline/post_insert.py';
    const helperContent = readFileSync(path.join(REPO_ROOT, helperPath), 'utf-8');
    expect(
      helperContent,
      `${helperPath} should document the OPS-20 Step 1 no-op`,
    ).toMatch(/DELIBERATE NO-OP \(OPS-20\)/);
    expect(
      helperContent,
      `${helperPath} should reference migration 20260422060118`,
    ).toMatch(/20260422060118/);

    // Callers must call run_post_insert (which still orchestrates embedding,
    // chunking, entity extraction, temporal refs, etc.).
    for (const rel of [
      'scripts/kb_pipeline/pipeline.py',
      'scripts/ingest_markdown.py',
    ]) {
      const callerContent = readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
      expect(
        callerContent,
        `${rel} should call run_post_insert (S185 WP-D shared helper)`,
      ).toMatch(/run_post_insert\(/);
    }
  });
});
