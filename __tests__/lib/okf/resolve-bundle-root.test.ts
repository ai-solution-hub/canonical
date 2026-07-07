import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { resolveOkfBundleRoot } from '@/lib/okf/resolve-bundle-root';

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
