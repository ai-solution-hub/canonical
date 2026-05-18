/**
 * CLAUDE.md Consistency Guard Tests
 *
 * Parses CLAUDE.md and asserts every referenced filesystem path exists on
 * disk. Covers:
 *
 *   1. The "Key Reference Documents" markdown table
 *   2. The "Architecture" key directories table
 *   3. Every backticked filesystem path elsewhere in the file
 *
 * Skips: URLs, env vars, TypeScript path aliases (`@/...`), placeholders
 * (`<url>`, `{name}`, `${...}`), wildcards (`**`, `*`), URL routes (`/login`),
 * absolute system paths (`/opt/homebrew/...`, `/Users/...`), and ESLint
 * rule names (e.g. `react-hooks/set-state-in-effect`).
 *
 * Pattern mirrors __tests__/validation/doc-freshness.test.ts and
 * __tests__/validation/pipeline-parity.test.ts.
 *
 * Closes Liam's Q-18 / Q-45 decision (docs/audits/s151-decision-responses.md)
 * and roadmap §14.14.
 */

import { join } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const PROJECT_ROOT = join(__dirname, '../..');
const CLAUDE_MD_PATH = join(PROJECT_ROOT, 'CLAUDE.md');
const claudeMdContent = readFileSync(CLAUDE_MD_PATH, 'utf8');
const claudeMdLines = claudeMdContent.split('\n');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FILE_EXTENSIONS = [
  '.md',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.py',
  '.sql',
  '.yml',
  '.yaml',
  '.css',
  '.html',
  '.pdf',
  '.txt',
];

const KNOWN_ROOT_PREFIXES = [
  'app/',
  'mcp-apps/',
  'lib/',
  'scripts/',
  'docs/',
  'contexts/',
  'components/',
  'hooks/',
  'types/',
  '__tests__/',
  'e2e/',
  'supabase/',
  '.planning/',
  '.claude/',
];

/**
 * Strip a trailing `:line` or `:line-line` suffix that CLAUDE.md uses for
 * line-range references like `app/api/items/[id]/route.ts:419-423`.
 */
function stripLineSuffix(token: string): string {
  return token.replace(/:\d+(?:-\d+)?$/, '');
}

/**
 * Decide whether a backticked token (or sub-token) should be checked as a
 * filesystem path.
 *
 * Returns false for:
 *   - URLs
 *   - TypeScript path aliases (`@/...`)
 *   - Placeholders (`<...>`, `${...}`, `{...}`)
 *   - Wildcard globs (`**`, `*`)
 *   - URL routes (`/login`, `/api/...`, `/review`) — start with `/`, no
 *     known root prefix, no extension
 *   - Absolute system paths (`/Users/...`, `/opt/...`)
 *   - Tilde-prefixed home paths (`~/.claude/...`)
 *   - ESLint rule names like `react-hooks/set-state-in-effect`
 */
function looksLikePath(token: string): boolean {
  if (!token.includes('/')) return false;
  if (token.startsWith('http://') || token.startsWith('https://')) return false;
  if (token.startsWith('@/')) return false;
  if (token.startsWith('~')) return false;
  if (token.includes('${')) return false;
  if (token.includes('<') || token.includes('>')) return false;
  if (token.includes('{') || token.includes('}')) return false;
  if (token.includes('*')) return false;
  if (token.startsWith('/Users/') || token.startsWith('/opt/')) return false;
  // URL routes: start with `/` and don't have an extension
  if (token.startsWith('/')) {
    const hasExt = FILE_EXTENSIONS.some((ext) => token.endsWith(ext));
    if (!hasExt) return false;
  }

  const stripped = stripLineSuffix(token);
  const hasKnownExt = FILE_EXTENSIONS.some((ext) => stripped.endsWith(ext));
  const hasKnownRoot = KNOWN_ROOT_PREFIXES.some((root) =>
    stripped.startsWith(root),
  );
  const isDirectoryToken = stripped.endsWith('/');

  // Must either have a known file extension OR be a directory under a known
  // root prefix. This excludes ESLint rule names like
  // `react-hooks/set-state-in-effect` (no extension, not a known root).
  if (hasKnownExt) return true;
  if (isDirectoryToken && hasKnownRoot) return true;
  return false;
}

/**
 * Extract path-like tokens from a backticked string. The string may be a bare
 * path (`docs/foo.md`) or a command line containing one (`python3 scripts/ingest.py`).
 */
function extractPathTokens(backtickContent: string): string[] {
  // Match sequences of path characters: letters, digits, dots, dashes,
  // underscores, slashes, colons (for line suffixes), and `[...]` Next.js
  // dynamic-route brackets.
  const tokenPattern = /[A-Za-z0-9._/\-[\]:]+/g;
  const tokens: string[] = [];
  for (const match of backtickContent.matchAll(tokenPattern)) {
    if (looksLikePath(match[0])) {
      tokens.push(stripLineSuffix(match[0]));
    }
  }
  return tokens;
}

/**
 * Check whether a path resolves to an existing file or directory under the
 * project root.
 */
function pathExists(relativePath: string): boolean {
  return existsSync(join(PROJECT_ROOT, relativePath));
}

/**
 * Check whether a path resolves to an existing directory.
 */
function isDirectoryPath(relativePath: string): boolean {
  const full = join(PROJECT_ROOT, relativePath);
  if (!existsSync(full)) return false;
  return statSync(full).isDirectory();
}

// ---------------------------------------------------------------------------
// Pass 1: Key Reference Documents table
// ---------------------------------------------------------------------------

interface KeyReferenceRow {
  name: string;
  path: string;
  lineNumber: number;
}

function extractKeyReferenceRows(): KeyReferenceRow[] {
  const rows: KeyReferenceRow[] = [];
  let inSection = false;
  let inTable = false;
  for (let i = 0; i < claudeMdLines.length; i++) {
    const line = claudeMdLines[i];
    if (line.startsWith('## Key Reference Documents')) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith('## ')) {
      break; // next top-level section
    }
    if (!inSection) continue;
    // Detect table header separator (`| --- | --- |`)
    if (/^\|\s*-+/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    // Match `| name | `path` (suffix) |`
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*`([^`]+)`[^|]*\|/);
    if (!match) continue;
    rows.push({
      name: match[1].trim(),
      path: match[2].trim(),
      lineNumber: i + 1,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Pass 2: Architecture directory table
// ---------------------------------------------------------------------------

interface ArchitectureRow {
  directory: string;
  lineNumber: number;
}

function extractArchitectureDirectoryRows(): ArchitectureRow[] {
  const rows: ArchitectureRow[] = [];
  let inSection = false;
  let inTable = false;
  for (let i = 0; i < claudeMdLines.length; i++) {
    const line = claudeMdLines[i];
    if (line.startsWith('## Architecture')) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith('## ') && !line.startsWith('## Arch')) {
      break;
    }
    if (!inSection) continue;
    if (/^\|\s*-+/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    // Match `| `dirname/` | description |`
    const match = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (!match) continue;
    const token = match[1].trim();
    // Only include trailing-slash directory rows
    if (!token.endsWith('/')) continue;
    rows.push({ directory: token, lineNumber: i + 1 });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Pass 3: General backticked path scan
// ---------------------------------------------------------------------------

interface ScannedPath {
  path: string;
  lineNumber: number;
}

/**
 * Paths under `.claude/` that are environment-specific or ephemeral and
 * cannot be relied on to exist in worktrees or fresh checkouts. Same
 * rationale as the existing `plugin-taxonomy-consistency.test.ts` worktree
 * gotcha (CLAUDE.md §Testing).
 */
const SKIP_PATHS = new Set<string>(['.claude/worktrees/']);

/**
 * Path prefixes that are gitignored plugin-managed files — present in a
 * developer's local checkout but absent in CI runners and fresh clones.
 * Mirrors the `.claude/skills/*` and `.claude/plugins/*` entries in
 * `.gitignore`.
 */
const SKIP_PATH_PREFIXES = ['.claude/skills/', '.claude/plugins/'];

function extractAllBacktickedPaths(): ScannedPath[] {
  const seen = new Map<string, number>();
  const backtickPattern = /`([^`]+)`/g;
  for (let i = 0; i < claudeMdLines.length; i++) {
    const line = claudeMdLines[i];
    for (const match of line.matchAll(backtickPattern)) {
      // Skip backticks containing glob wildcards entirely — splitting on `*`
      // would create false positives like `/SKILL.md` from
      // `.claude/plugins/.../skills/*/SKILL.md`.
      if (match[1].includes('*')) continue;
      const tokens = extractPathTokens(match[1]);
      for (const token of tokens) {
        if (SKIP_PATHS.has(token)) continue;
        if (SKIP_PATH_PREFIXES.some((prefix) => token.startsWith(prefix)))
          continue;
        if (!seen.has(token)) {
          seen.set(token, i + 1);
        }
      }
    }
  }
  return [...seen.entries()].map(([path, lineNumber]) => ({
    path,
    lineNumber,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLAUDE.md consistency', () => {
  it('CLAUDE.md exists', () => {
    expect(existsSync(CLAUDE_MD_PATH)).toBe(true);
  });

  describe('Key Reference Documents table', () => {
    const rows = extractKeyReferenceRows();

    it('parses at least 5 rows from the Key Reference Documents table', () => {
      expect(
        rows.length,
        'Expected the Key Reference Documents table to have rows. ' +
          'Parser regex may be broken.',
      ).toBeGreaterThanOrEqual(5);
    });

    for (const { name, path, lineNumber } of rows) {
      it(`"${name}" references an existing path: ${path}`, () => {
        expect(
          pathExists(path),
          `Path "${path}" (CLAUDE.md line ${lineNumber}, row "${name}") does not exist on disk. ` +
            'Either fix the path or remove the row.',
        ).toBe(true);
      });
    }
  });

  describe('Architecture directory table', () => {
    const rows = extractArchitectureDirectoryRows();

    it('parses at least 10 directory rows from the Architecture table', () => {
      expect(
        rows.length,
        'Expected the Architecture table to have at least 10 directory rows. ' +
          'Parser regex may be broken.',
      ).toBeGreaterThanOrEqual(10);
    });

    for (const { directory, lineNumber } of rows) {
      it(`"${directory}" is an existing directory`, () => {
        expect(
          isDirectoryPath(directory),
          `Directory "${directory}" (CLAUDE.md line ${lineNumber}) does not exist or is not a directory. ` +
            'Either fix the path or remove the row.',
        ).toBe(true);
      });
    }
  });

  describe('Backticked filesystem paths', () => {
    const scanned = extractAllBacktickedPaths();

    it('finds at least 20 backticked paths to validate', () => {
      expect(
        scanned.length,
        'Expected the general backtick scan to find many paths. ' +
          'Path-extraction regex may be broken.',
      ).toBeGreaterThanOrEqual(20);
    });

    for (const { path, lineNumber } of scanned) {
      it(`backticked path exists: ${path} (line ${lineNumber})`, () => {
        expect(
          pathExists(path),
          `Backticked path "${path}" (CLAUDE.md line ${lineNumber}) does not exist on disk. ` +
            'Either fix the reference in CLAUDE.md or remove it.',
        ).toBe(true);
      });
    }
  });
});
