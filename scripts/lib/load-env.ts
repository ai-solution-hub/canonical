/**
 * Shared worktree-aware `.env` loader for standalone scripts.
 *
 * Background: ~38 scripts under `scripts/` carried an inline copy of this
 * walk-up loader. It walks up from `process.cwd()` looking for `.env.local`
 * (then `.env`) in each ancestor directory, loading the first of each it finds,
 * and stops once it reaches a directory containing `package.json` (the package
 * root). This is what lets a script run correctly from inside a git worktree —
 * the worktree symlinks `.env.local` at its own root, and the walk finds it
 * before falling back to the main checkout.
 *
 * Precedence matches the copies it consolidates:
 *   - Existing `process.env` keys are NEVER overwritten (real env wins over file).
 *   - Within a directory, `.env.local` is read before `.env`.
 *   - The walk stops at the first ancestor containing `package.json`.
 *
 * Usage — call once at module top, before reading any env var:
 *
 *   import { loadEnv } from './lib/load-env';
 *   loadEnv();
 *   const url = process.env.SUPABASE_URL;
 */
import path from 'path';
import fs from 'fs';

/**
 * Walk up from `startDir` (default `process.cwd()`) loading `.env.local` then
 * `.env` from each ancestor, stopping at the package root (`package.json`).
 * Existing `process.env` values are preserved — file values only fill gaps.
 */
export function loadEnv(startDir: string = process.cwd()): void {
  let dir = startDir;
  while (dir !== '/') {
    for (const file of ['.env.local', '.env']) {
      const p = path.join(dir, file);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq === -1) continue;
          const key = trimmed.slice(0, eq).trim();
          const val = trimmed
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
    if (fs.existsSync(path.join(dir, 'package.json'))) break;
    dir = path.dirname(dir);
  }
}
