/**
 * Unit tests for findProjectRoot (bl-292).
 *
 * These are plain Vitest unit tests — NOT integration tests — so they run
 * under `bun run test` (vitest.config.ts includes __tests__/**\/*.test.ts and
 * excludes **\/*.integration.test.ts).
 *
 * Uses mkdtempSync so no real repo layout is required; cleans up in finally.
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findProjectRoot } from './find-project-root';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'bl-292-'));
}

describe('findProjectRoot', () => {
  it('returns the directory when only .env.local is present', () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, '.env.local'),
        'NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co\n',
      );
      expect(findProjectRoot(dir)).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the directory when only .env is present', () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, '.env'),
        'NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co\n',
      );
      expect(findProjectRoot(dir)).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws an explicit error when neither .env nor .env.local is found', () => {
    const dir = makeTempDir();
    try {
      // Ensure no env files exist — dir is fresh from mkdtempSync
      expect(() => findProjectRoot(dir, 2)).toThrow(
        /neither \.env nor \.env\.local found/i,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('walks up to find .env.local in a parent directory', () => {
    const root = makeTempDir();
    const child = join(root, 'sub', 'dir');
    try {
      mkdirSync(child, { recursive: true });
      writeFileSync(join(root, '.env.local'), 'KEY=val\n');
      expect(findProjectRoot(child, 5)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
