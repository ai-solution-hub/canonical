import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const PROJECT_ROOT = join(__dirname, '../..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract backtick-quoted file paths from markdown content. */
function extractFilePaths(content: string): string[] {
  const pathPattern =
    /`((?:app|lib|scripts|docs|contexts|components)\/[\w/.-]+\.\w+)`/g;
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(content)) !== null) {
    paths.push(match[1]);
  }
  // Deduplicate
  return [...new Set(paths)];
}

/** Check if a file path exists relative to PROJECT_ROOT. */
function fileExists(relativePath: string): boolean {
  return existsSync(join(PROJECT_ROOT, relativePath));
}

// ---------------------------------------------------------------------------
// data-entry-points.md
// ---------------------------------------------------------------------------

describe('Doc Freshness: data-entry-points.md', () => {
  const docPath = join(PROJECT_ROOT, 'docs/reference/data-entry-points.md');
  const docExists = existsSync(docPath);

  it('document should exist', () => {
    expect(docExists, 'docs/reference/data-entry-points.md is missing').toBe(
      true,
    );
  });

  // S152B WP8 (Q-19): wrap content-dependent assertions in a describe block
  // that is explicitly SKIPPED when the doc is missing. Previously this
  // test file assigned `content = docExists ? readFileSync(...) : ''` so
  // downstream tests ran against an empty string — some of them failed
  // loudly (string .includes checks) but others that did not touch
  // `content` (e.g., "referenced scripts should exist on disk") passed
  // silently despite failing to validate anything about the doc. With
  // `describe.skipIf`, missing docs produce explicit SKIPPED output in
  // the test report instead of silent trivial passes. `readFileSync`
  // cannot move inside the describe body because vitest evaluates
  // describe bodies eagerly (before applying skipIf); keeping the
  // ternary ensures the body evaluates on a missing-doc run, and
  // `describe.skipIf(!docExists)` prevents the tests from running.
  const content = docExists ? readFileSync(docPath, 'utf8') : '';

  describe.skipIf(!docExists)('content checks', () => {
    // Known entry point source files (the 10 entry points from the doc)
    const KNOWN_ENTRY_POINT_FILES = [
      'scripts/kb_pipeline/pipeline.py',
      'scripts/ingest_markdown.py',
      'app/api/upload/route.ts',
      'app/api/ingest/url/route.ts',
      'app/api/items/route.ts',
      'app/api/items/batch/route.ts',
      'scripts/batch-reclassify.ts',
      'scripts/import_bid_library.py',
      'lib/mcp/tools/content.ts',
      'app/api/bids/[id]/outcome/integrate/route.ts',
    ];

    it('all known entry point source files should be referenced', () => {
      const unreferenced = KNOWN_ENTRY_POINT_FILES.filter(
        (f) => !content.includes(f),
      );
      expect(
        unreferenced,
        `Entry point files not referenced in doc: ${unreferenced.join(', ')}`,
      ).toHaveLength(0);
    });

    it('all referenced source files should exist on disk', () => {
      // Extract the "Source file" paths from the doc
      const sourceFilePattern = /\*\*Source file\*\*[^`]*`([^`]+)`/g;
      const referencedFiles: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = sourceFilePattern.exec(content)) !== null) {
        // Strip function/line info (e.g. " -- process_url() (line 44)")
        referencedFiles.push(match[1]);
      }

      const missing = referencedFiles.filter((f) => !fileExists(f));
      expect(
        missing,
        `Source files referenced in doc but missing from disk: ${missing.join(', ')}`,
      ).toHaveLength(0);
    });

    it('all files that INSERT into content_items should be referenced', () => {
      // Scan app/api/ and lib/mcp/tools/ for files that insert into content_items
      const dirsToScan = ['app/api', 'lib/mcp/tools'];
      const insertFiles: string[] = [];

      function scanDir(dir: string): void {
        const absDir = join(PROJECT_ROOT, dir);
        if (!existsSync(absDir)) return;

        const entries = readdirSync(absDir, { withFileTypes: true });
        for (const entry of entries) {
          const relPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(relPath);
          } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.py')) {
            const fileContent = readFileSync(
              join(PROJECT_ROOT, relPath),
              'utf8',
            );
            // Check for .from('content_items') followed by .insert(
            if (
              fileContent.includes("'content_items'") &&
              fileContent.includes('.insert(')
            ) {
              insertFiles.push(relPath);
            }
          }
        }
      }

      for (const dir of dirsToScan) {
        scanDir(dir);
      }

      // Filter to files that are actual entry points (route.ts files and tool files)
      // Exclude files that only do UPDATE+INSERT patterns (e.g. governance, review)
      const entryPointInsertFiles = insertFiles.filter((f) => {
        // Must be a route.ts or a tool file
        return f.endsWith('route.ts') || f.includes('lib/mcp/tools/');
      });

      const unreferenced = entryPointInsertFiles.filter(
        (f) => !content.includes(f),
      );

      // These are files that insert into content_items but are not data entry
      // points in the traditional sense (they modify existing items or are
      // auxiliary operations). Allow-list them to avoid false positives.
      const ALLOWED_UNREFERENCED = [
        // These routes do INSERT for content_history, review assignments, etc.
        // but are not content creation entry points
        'app/api/items/[id]/route.ts', // update handler creates content_history
        'app/api/source-documents/[id]/diff/route.ts', // diff tracking
        'app/api/review/assignments/route.ts', // review assignment
        'app/api/governance/review/route.ts', // governance review
        'app/api/items/[id]/owner/route.ts', // owner assignment
        'app/api/cron/quality-score/route.ts', // quality score updates
        'app/api/content-owners/bulk-assign/route.ts', // bulk owner assignment
        'app/api/review/action/route.ts', // review action
        'app/api/cron/freshness-transitions/route.ts', // freshness cron
        'app/api/items/[id]/rollback/route.ts', // rollback
        'app/api/cron/classification-quality/route.ts', // classification quality cron
        'app/api/bids/[id]/responses/draft-stream/route.ts', // bid draft stream
        // §1.7 admin dedup review — UPDATE content_items + INSERT content_history
        'app/api/admin/content-dedup/[id]/confirm-duplicate/route.ts',
        'app/api/admin/content-dedup/[id]/confirm-unique/route.ts',
        'app/api/admin/content-dedup/[id]/supersede/route.ts',
        'lib/mcp/tools/governance.ts', // governance tools
        'lib/mcp/tools/review.ts', // review tools (S180 P0-23) — head-count queries only; no content_items INSERTs
      ];

      const trueUnreferenced = unreferenced.filter(
        (f) => !ALLOWED_UNREFERENCED.includes(f),
      );

      expect(
        trueUnreferenced,
        `Files that INSERT into content_items but are not in data-entry-points.md: ${trueUnreferenced.join(', ')}`,
      ).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// classification-architecture.md
// ---------------------------------------------------------------------------

describe('Doc Freshness: classification-architecture.md', () => {
  const docPath = join(
    PROJECT_ROOT,
    'docs/reference/classification-architecture.md',
  );
  const docExists = existsSync(docPath);

  it('document should exist', () => {
    expect(
      docExists,
      'docs/reference/classification-architecture.md is missing',
    ).toBe(true);
  });

  // S152B WP8 (Q-19): see data-entry-points.md block above for rationale.
  const content = docExists ? readFileSync(docPath, 'utf8') : '';

  describe.skipIf(!docExists)('content checks', () => {
    it('lib/ai/classify.ts should exist and contain classifyContent', () => {
      const filePath = join(PROJECT_ROOT, 'lib/ai/classify.ts');
      expect(existsSync(filePath), 'lib/ai/classify.ts is missing').toBe(true);
      const fileContent = readFileSync(filePath, 'utf8');
      expect(
        fileContent.includes('classifyContent'),
        'lib/ai/classify.ts does not contain classifyContent',
      ).toBe(true);
    });

    it('scripts/kb_pipeline/classify.py should exist', () => {
      expect(
        existsSync(join(PROJECT_ROOT, 'scripts/kb_pipeline/classify.py')),
        'scripts/kb_pipeline/classify.py is missing',
      ).toBe(true);
    });

    it('scripts/kb_pipeline/layer_inference.py should exist', () => {
      expect(
        existsSync(
          join(PROJECT_ROOT, 'scripts/kb_pipeline/layer_inference.py'),
        ),
        'scripts/kb_pipeline/layer_inference.py is missing',
      ).toBe(true);
    });

    it('all file paths in the File Reference table should exist on disk', () => {
      // Extract paths from the File Reference section at the end of the doc
      const fileRefSection = content.split('## File Reference')[1];
      if (!fileRefSection) {
        expect.fail(
          'File Reference section not found in classification-architecture.md',
        );
        return;
      }

      const filePaths = extractFilePaths(fileRefSection);
      const missing = filePaths.filter((f) => !fileExists(f));

      expect(
        missing,
        `File paths in File Reference but missing from disk: ${missing.join(', ')}`,
      ).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// taxonomy-change-runbook.md
// ---------------------------------------------------------------------------

describe('Doc Freshness: taxonomy-change-runbook.md', () => {
  // S152B WP1: moved from docs/reference/ to docs/operations/ per the
  // S151 reference-folder audit. The doc is structurally a runbook and
  // belongs alongside other operational procedures in docs/operations/.
  const docPath = join(
    PROJECT_ROOT,
    'docs/operations/taxonomy-change-runbook.md',
  );
  const docExists = existsSync(docPath);

  it('document should exist', () => {
    expect(
      docExists,
      'docs/operations/taxonomy-change-runbook.md is missing',
    ).toBe(true);
  });

  // S152B WP8 (Q-19): see data-entry-points.md block above for rationale.
  const content = docExists ? readFileSync(docPath, 'utf8') : '';

  describe.skipIf(!docExists)('content checks', () => {
    it('should reference sync:taxonomy', () => {
      expect(
        content.includes('sync:taxonomy'),
        'taxonomy-change-runbook.md does not reference sync:taxonomy',
      ).toBe(true);
    });

    it('referenced scripts should exist on disk', () => {
      const expectedScripts = [
        'scripts/generate-classification-prompt-taxonomy.ts',
        'scripts/generate-taxonomy-snapshot.ts',
        'scripts/sync-plugin-taxonomy.ts',
      ];

      const missing = expectedScripts.filter((s) => !fileExists(s));
      expect(
        missing,
        `Scripts referenced in runbook but missing from disk: ${missing.join(', ')}`,
      ).toHaveLength(0);
    });

    it('all file paths referenced in the Scripts table should exist', () => {
      const scriptsSection = content.split('### Scripts')[1]?.split('###')[0];
      if (!scriptsSection) {
        expect.fail('Scripts section not found in taxonomy-change-runbook.md');
        return;
      }

      const filePaths = extractFilePaths(scriptsSection);
      const missing = filePaths.filter((f) => !fileExists(f));

      expect(
        missing,
        `Script paths in runbook but missing from disk: ${missing.join(', ')}`,
      ).toHaveLength(0);
    });

    it('all file paths in the Generated artefacts table should exist', () => {
      const artefactsSection = content
        .split('### Generated artefacts')[1]
        ?.split('###')[0];
      if (!artefactsSection) {
        expect.fail(
          'Generated artefacts section not found in taxonomy-change-runbook.md',
        );
        return;
      }

      const filePaths = extractFilePaths(artefactsSection);
      const missing = filePaths.filter((f) => !fileExists(f));

      expect(
        missing,
        `Artefact paths in runbook but missing from disk: ${missing.join(', ')}`,
      ).toHaveLength(0);
    });
  });
});
