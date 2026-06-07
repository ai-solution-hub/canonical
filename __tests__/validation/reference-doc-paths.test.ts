/**
 * reference-doc-paths.test.ts — ID-68 {68.12} 0b / R8 / OQ-R8.
 *
 * Slim replacement for the retired doc-freshness.test.ts. The 3 freshness-guarded
 * reference docs (data-entry-points.md, classification-architecture.md,
 * runbooks/taxonomy-change-runbook.md) relocate to the private knowledge-hub-internal
 * repo under the docs split, so public CI must NOT read their prose. This guard reads
 * the code-repo path-manifest (__tests__/fixtures/reference-doc-paths.json, authored in
 * 0g from those docs' Source-file / File-Reference citations) and verifies, against the
 * live code tree, the two guarantees the old test provided:
 *
 *   (i)  path-existence — every code path the now-private docs cite still resolves;
 *   (ii) content_items-INSERT completeness — every app/api or lib/mcp/tools file that
 *        INSERTs into content_items is either a documented data entry point or
 *        explicitly allow-listed (doc-freshness.test.ts:100-187, allow-list preserved).
 *
 * Per docs/reference/test-philosophy.md — pure file-system read; no Supabase fixtures,
 * no chain-method asserts. Behaviour under test = the manifest's paths exist + the
 * content_items entry-point set is complete.
 */

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const PROJECT_ROOT = join(__dirname, '../..');

interface Manifest {
  requiredPaths: string[];
  contentItems: { entryPoints: string[]; allowedUnreferenced: string[] };
}

const manifest: Manifest = JSON.parse(
  readFileSync(
    join(PROJECT_ROOT, '__tests__/fixtures/reference-doc-paths.json'),
    'utf8',
  ),
);

const fileExists = (rel: string): boolean =>
  existsSync(join(PROJECT_ROOT, rel));

describe('reference-doc-paths: manifest shape', () => {
  it('carries non-empty requiredPaths + contentItems lists', () => {
    expect(Array.isArray(manifest.requiredPaths)).toBe(true);
    expect(manifest.requiredPaths.length).toBeGreaterThan(0);
    expect(Array.isArray(manifest.contentItems.entryPoints)).toBe(true);
    expect(manifest.contentItems.entryPoints.length).toBeGreaterThan(0);
    expect(Array.isArray(manifest.contentItems.allowedUnreferenced)).toBe(true);
  });
});

describe('reference-doc-paths: (i) path-existence', () => {
  it('every code path the now-private docs cite still exists on disk', () => {
    const missing = manifest.requiredPaths.filter((p) => !fileExists(p));
    expect(
      missing,
      `Manifest code paths missing from disk (update reference-doc-paths.json or restore the file): ${missing.join(', ')}`,
    ).toHaveLength(0);
  });

  it('every documented content_items entry point still exists on disk', () => {
    const missing = manifest.contentItems.entryPoints.filter(
      (p) => !fileExists(p),
    );
    expect(
      missing,
      `Documented entry points missing from disk: ${missing.join(', ')}`,
    ).toHaveLength(0);
  });
});

describe('reference-doc-paths: (ii) content_items-INSERT completeness', () => {
  it('every content_items inserter is documented or allow-listed', () => {
    // Scan app/api + lib/mcp/tools for files that INSERT into content_items —
    // identical logic to the retired doc-freshness.test.ts:100-187.
    const insertFiles: string[] = [];
    function scanDir(dir: string): void {
      const absDir = join(PROJECT_ROOT, dir);
      if (!existsSync(absDir)) return;
      for (const entry of readdirSync(absDir, { withFileTypes: true })) {
        const relPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(relPath);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.py')) {
          const fileContent = readFileSync(join(PROJECT_ROOT, relPath), 'utf8');
          if (
            fileContent.includes("'content_items'") &&
            fileContent.includes('.insert(')
          ) {
            insertFiles.push(relPath);
          }
        }
      }
    }
    for (const dir of ['app/api', 'lib/mcp/tools']) scanDir(dir);

    // Restrict to actual entry points (route handlers + MCP tools), excluding
    // UPDATE+INSERT auxiliary patterns — same filter as the old test.
    const entryPointInsertFiles = insertFiles.filter(
      (f) => f.endsWith('route.ts') || f.includes('lib/mcp/tools/'),
    );

    const documented = new Set([
      ...manifest.contentItems.entryPoints,
      ...manifest.contentItems.allowedUnreferenced,
    ]);
    const undocumented = entryPointInsertFiles.filter(
      (f) => !documented.has(f),
    );

    expect(
      undocumented,
      `Files that INSERT into content_items but are neither a documented data entry point nor allow-listed in reference-doc-paths.json: ${undocumented.join(', ')}`,
    ).toHaveLength(0);
  });
});
