/**
 * {132.32} G-LANDING-IMPL — bundle enumeration (LI-14: enumerate ALL
 * immediate subdirs of OKF_BUNDLE_ROOT, each keyed by its safe directory
 * name). Behaviour-first: exercises the real filesystem via a temp dir,
 * matching the sibling `bundle-graph.test.ts` convention.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { enumerateOkfBundles } from '@/lib/okf/enumerate-bundles';

describe('enumerateOkfBundles', () => {
  const ORIGINAL = process.env.OKF_BUNDLE_ROOT;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'okf-enumerate-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (ORIGINAL === undefined) delete process.env.OKF_BUNDLE_ROOT;
    else process.env.OKF_BUNDLE_ROOT = ORIGINAL;
  });

  it('returns [] (never throws) when OKF_BUNDLE_ROOT is unset (LI-4(a))', () => {
    delete process.env.OKF_BUNDLE_ROOT;
    expect(enumerateOkfBundles()).toEqual([]);
  });

  it('returns [] when the root is configured but has no subdirs (LI-4(b))', () => {
    process.env.OKF_BUNDLE_ROOT = root;
    expect(enumerateOkfBundles()).toEqual([]);
  });

  it('returns [] when the configured root does not exist on disk', () => {
    process.env.OKF_BUNDLE_ROOT = path.join(root, 'does-not-exist');
    expect(enumerateOkfBundles()).toEqual([]);
  });

  it('lists every immediate bundle subdir, sorted (LI-14)', () => {
    process.env.OKF_BUNDLE_ROOT = root;
    mkdirSync(path.join(root, 'zeta-client'));
    mkdirSync(path.join(root, 'alpha-client'));
    expect(enumerateOkfBundles()).toEqual(['alpha-client', 'zeta-client']);
  });

  it('lists a single bundle subdir', () => {
    process.env.OKF_BUNDLE_ROOT = root;
    mkdirSync(path.join(root, 'only-client'));
    expect(enumerateOkfBundles()).toEqual(['only-client']);
  });

  it('ignores plain files at the root (only directories are bundles)', () => {
    process.env.OKF_BUNDLE_ROOT = root;
    mkdirSync(path.join(root, 'real-client'));
    writeFileSync(path.join(root, 'README.md'), 'not a bundle', 'utf-8');
    expect(enumerateOkfBundles()).toEqual(['real-client']);
  });

  it('excludes a subdir name that fails the safe-bundle-id guard', () => {
    process.env.OKF_BUNDLE_ROOT = root;
    mkdirSync(path.join(root, 'good-client'));
    mkdirSync(path.join(root, 'bad client name'));
    expect(enumerateOkfBundles()).toEqual(['good-client']);
  });
});
