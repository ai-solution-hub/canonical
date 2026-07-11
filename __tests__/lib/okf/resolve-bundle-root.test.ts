import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import {
  resolveOkfBundleRoot,
  resolveOkfBundleRootDirOrNull,
  SAFE_BUNDLE_ID_RE,
} from '@/lib/okf/resolve-bundle-root';

describe('resolveOkfBundleRoot', () => {
  const ORIGINAL = process.env.OKF_BUNDLE_ROOT;

  beforeEach(() => {
    delete process.env.OKF_BUNDLE_ROOT;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OKF_BUNDLE_ROOT;
    else process.env.OKF_BUNDLE_ROOT = ORIGINAL;
  });

  it('joins OKF_BUNDLE_ROOT with the bundleId', () => {
    process.env.OKF_BUNDLE_ROOT = '/srv/okf-bundles';

    expect(resolveOkfBundleRoot('first-client')).toBe(
      path.join('/srv/okf-bundles', 'first-client'),
    );
  });

  it('throws an actionable error when OKF_BUNDLE_ROOT is unset', () => {
    expect(() => resolveOkfBundleRoot('first-client')).toThrow(
      /OKF_BUNDLE_ROOT not set/,
    );
  });

  it('throws when OKF_BUNDLE_ROOT is blank', () => {
    process.env.OKF_BUNDLE_ROOT = '   ';

    expect(() => resolveOkfBundleRoot('first-client')).toThrow(
      /OKF_BUNDLE_ROOT not set/,
    );
  });

  it('rejects a bundleId that is not a safe path segment (traversal guard)', () => {
    process.env.OKF_BUNDLE_ROOT = '/srv/okf-bundles';

    expect(() => resolveOkfBundleRoot('../../etc/passwd')).toThrow(
      /Invalid bundleId/,
    );
  });

  it('rejects an empty bundleId', () => {
    process.env.OKF_BUNDLE_ROOT = '/srv/okf-bundles';

    expect(() => resolveOkfBundleRoot('')).toThrow(/Invalid bundleId/);
  });
});

// {132.32} G-LANDING-IMPL: root-only resolution (LI-3(a)/LI-14) — this seam is
// deliberately non-throwing (unlike resolveOkfBundleRoot) so the /okf index
// route degrades to a friendly empty state (LI-4(a)) instead of a 500.
describe('resolveOkfBundleRootDirOrNull', () => {
  const ORIGINAL = process.env.OKF_BUNDLE_ROOT;

  beforeEach(() => {
    delete process.env.OKF_BUNDLE_ROOT;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OKF_BUNDLE_ROOT;
    else process.env.OKF_BUNDLE_ROOT = ORIGINAL;
  });

  it('returns the trimmed root when OKF_BUNDLE_ROOT is set', () => {
    process.env.OKF_BUNDLE_ROOT = '/srv/okf-bundles';
    expect(resolveOkfBundleRootDirOrNull()).toBe('/srv/okf-bundles');
  });

  it('returns null (never throws) when OKF_BUNDLE_ROOT is unset', () => {
    expect(resolveOkfBundleRootDirOrNull()).toBeNull();
  });

  it('returns null (never throws) when OKF_BUNDLE_ROOT is blank', () => {
    process.env.OKF_BUNDLE_ROOT = '   ';
    expect(resolveOkfBundleRootDirOrNull()).toBeNull();
  });
});

describe('SAFE_BUNDLE_ID_RE', () => {
  it('accepts single safe path segments', () => {
    expect(SAFE_BUNDLE_ID_RE.test('first-client')).toBe(true);
    expect(SAFE_BUNDLE_ID_RE.test('client_2')).toBe(true);
  });

  it('rejects traversal / multi-segment / separator characters', () => {
    expect(SAFE_BUNDLE_ID_RE.test('../etc')).toBe(false);
    expect(SAFE_BUNDLE_ID_RE.test('a/b')).toBe(false);
    expect(SAFE_BUNDLE_ID_RE.test('')).toBe(false);
  });
});
