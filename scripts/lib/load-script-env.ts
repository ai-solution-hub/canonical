/**
 * Shared scriptDir+cwd `.env` loader for standalone scripts (bl-356).
 *
 * Background: three scripts carried a byte-identical copy of this loader —
 * `scripts/mcp-eval/fixtures.ts`, `scripts/calibrate-coverage-thresholds.ts`,
 * and `scripts/kb-search.ts`. This consolidates them onto one helper.
 *
 * Distinct from `load-env.ts` (a cwd-only walk): this variant ALSO walks up
 * from the CALLING script's own directory — passed in as `import.meta.url` — so
 * the repo root is found from the real file location even when the script is
 * invoked with a cwd outside the repo, or symlinked into a git worktree. That
 * scriptDir leg is the worktree-robustness the three copies relied on, so it is
 * preserved here rather than collapsed onto the cwd-only helper.
 *
 * Precedence matches the copies it replaces:
 *   - existing `process.env` keys are NEVER overwritten (real env wins over file
 *     — this is what keeps CI's secret-injected env authoritative);
 *   - within the resolved root, `.env.local` is read before `.env`.
 *
 * Usage — call once at module top, passing the caller's own module URL so the
 * scriptDir leg resolves relative to the calling script, not this helper:
 *
 *   import { loadScriptEnv } from '@/scripts/lib/load-script-env';
 *   loadScriptEnv(import.meta.url);
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

function loadEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist — that's fine.
  }
}

/**
 * Resolve the project root by collecting candidate directories from both the
 * calling script's directory and `process.cwd()`, then returning the first that
 * contains a `.env`/`.env.local`. Falls back to the script's parent directory
 * when none is found (the no-env path — e.g. CI, where real env is already set).
 */
function findProjectRoot(importMetaUrl: string): string {
  const scriptDir = dirname(fileURLToPath(importMetaUrl));
  const candidates = new Set<string>();

  // Walk up from the calling script's directory.
  let dir = resolve(scriptDir, '..');
  for (let i = 0; i < 10; i++) {
    candidates.add(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Walk up from cwd (handles worktrees where the script is symlinked).
  dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.add(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const root of candidates) {
    if (
      existsSync(resolve(root, '.env')) ||
      existsSync(resolve(root, '.env.local'))
    ) {
      return root;
    }
  }

  return resolve(scriptDir, '..');
}

/**
 * Load `.env.local` then `.env` from the resolved project root. Pass the
 * caller's `import.meta.url` so the scriptDir leg of the walk is anchored to the
 * calling script.
 */
export function loadScriptEnv(importMetaUrl: string): void {
  const root = findProjectRoot(importMetaUrl);
  loadEnvFile(resolve(root, '.env.local'));
  loadEnvFile(resolve(root, '.env'));
}
