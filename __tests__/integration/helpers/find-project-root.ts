/**
 * Pure, side-effect-free project-root resolver (bl-292).
 *
 * Walks up from `startDir` looking for a `.env` or `.env.local` file.
 * Returns the first directory that contains either marker.
 * Throws if neither is found within `levels` steps — loud config failure
 * rather than silently returning a directory where env load would be a no-op.
 *
 * Extracted from service-client.ts so this logic is unit-testable without
 * triggering the import-time Supabase client creation that service-client.ts
 * performs on load.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Resolves the project root directory by walking up from `startDir`.
 *
 * @param startDir - Directory to start searching from (default: process.cwd())
 * @param levels   - Maximum number of parent directories to search (default: 5)
 * @returns Absolute path to the directory containing `.env` or `.env.local`
 * @throws Error if neither marker file is found within `levels` steps
 */
export function findProjectRoot(
  startDir: string = process.cwd(),
  levels: number = 5,
): string {
  let dir = startDir;
  for (let i = 0; i < levels; i++) {
    if (
      existsSync(resolve(dir, '.env')) ||
      existsSync(resolve(dir, '.env.local'))
    ) {
      return dir;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) {
      // Reached filesystem root
      break;
    }
    dir = parent;
  }
  throw new Error(
    `findProjectRoot: neither .env nor .env.local found within ${levels} levels of "${startDir}". ` +
      'Ensure the project root with .env.local is reachable from the working directory.',
  );
}
