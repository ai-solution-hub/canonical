import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { loadEnv } from '../../../scripts/lib/load-env';

/**
 * Tests for the shared worktree-aware loadEnv().
 *
 * No real `.env` is read: each test builds a throwaway temp dir tree with
 * fixture `.env*` files and a `package.json` sentinel, and drives loadEnv()
 * with an explicit start dir.
 */
describe('loadEnv', () => {
  let tmpRoot: string;
  const savedEnv: Record<string, string | undefined> = {};

  const KEYS = ['LE_FROM_LOCAL', 'LE_FROM_ENV', 'LE_PREEXISTING', 'LE_QUOTED'];

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-'));
    for (const k of KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    for (const k of KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('loads keys from .env.local in the start dir', () => {
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpRoot, '.env.local'), 'LE_FROM_LOCAL=hello\n');

    loadEnv(tmpRoot);

    expect(process.env.LE_FROM_LOCAL).toBe('hello');
  });

  it('strips surrounding quotes from values', () => {
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{}');
    fs.writeFileSync(
      path.join(tmpRoot, '.env.local'),
      'LE_QUOTED="quoted-value"\n',
    );

    loadEnv(tmpRoot);

    expect(process.env.LE_QUOTED).toBe('quoted-value');
  });

  it('ignores blank lines and comments', () => {
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{}');
    fs.writeFileSync(
      path.join(tmpRoot, '.env.local'),
      '# a comment\n\n   \nLE_FROM_LOCAL=set\n',
    );

    loadEnv(tmpRoot);

    expect(process.env.LE_FROM_LOCAL).toBe('set');
  });

  it('does NOT overwrite an already-set process.env key', () => {
    process.env.LE_PREEXISTING = 'real-env-wins';
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{}');
    fs.writeFileSync(
      path.join(tmpRoot, '.env.local'),
      'LE_PREEXISTING=file-value\n',
    );

    loadEnv(tmpRoot);

    expect(process.env.LE_PREEXISTING).toBe('real-env-wins');
  });

  it('reads .env.local before .env (local fills the gap first)', () => {
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpRoot, '.env.local'), 'LE_FROM_LOCAL=local\n');
    fs.writeFileSync(
      path.join(tmpRoot, '.env'),
      'LE_FROM_LOCAL=plain\nLE_FROM_ENV=plain-only\n',
    );

    loadEnv(tmpRoot);

    // .env.local read first wins for the shared key; .env still fills its own.
    expect(process.env.LE_FROM_LOCAL).toBe('local');
    expect(process.env.LE_FROM_ENV).toBe('plain-only');
  });

  it('walks up from a subdir to find the package-root .env.local', () => {
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpRoot, '.env.local'), 'LE_FROM_LOCAL=root\n');
    const sub = path.join(tmpRoot, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });

    loadEnv(sub);

    expect(process.env.LE_FROM_LOCAL).toBe('root');
  });

  it('stops walking at the package root (does not read above package.json)', () => {
    // Outer dir has a .env.local; inner dir is the package root with its own.
    fs.writeFileSync(path.join(tmpRoot, '.env.local'), 'LE_FROM_ENV=outer\n');
    const pkg = path.join(tmpRoot, 'pkg');
    fs.mkdirSync(pkg);
    fs.writeFileSync(path.join(pkg, 'package.json'), '{}');
    fs.writeFileSync(path.join(pkg, '.env.local'), 'LE_FROM_LOCAL=inner\n');

    loadEnv(pkg);

    // Inner (package-root) value loaded; the outer-only key is never reached.
    expect(process.env.LE_FROM_LOCAL).toBe('inner');
    expect(process.env.LE_FROM_ENV).toBeUndefined();
  });
});
