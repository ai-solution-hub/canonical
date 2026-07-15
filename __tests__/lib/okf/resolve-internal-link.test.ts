import { describe, it, expect } from 'vitest';
import { resolveInternalMdLink } from '@/lib/okf/resolve-internal-link';

describe('resolveInternalMdLink', () => {
  it('resolves a sibling-file link relative to the current concept directory', () => {
    expect(resolveInternalMdLink('tables/orders', 'customers.md')).toBe(
      'tables/customers',
    );
  });

  it('resolves a parent-relative link (../)', () => {
    expect(resolveInternalMdLink('tables/orders', '../datasets/sales.md')).toBe(
      'datasets/sales',
    );
  });

  it('strips a trailing #anchor before resolving', () => {
    expect(resolveInternalMdLink('tables/orders', 'customers.md#schema')).toBe(
      'tables/customers',
    );
  });

  it('returns null for an external link (scheme present)', () => {
    expect(
      resolveInternalMdLink('tables/orders', 'https://example.com/x.md'),
    ).toBeNull();
  });

  it('resolves a leading-/ link against the bundle root (SPEC §5.1 bundle-absolute form)', () => {
    // The producer's citation trailer + body-prose cross-link convention:
    // never relative to the current file's directory.
    expect(resolveInternalMdLink('tables/orders', '/customers.md')).toBe(
      'customers',
    );
    expect(
      resolveInternalMdLink('tables/orders', '/certifications/iso-9001.md'),
    ).toBe('certifications/iso-9001');
  });

  it('returns null for a non-.md link', () => {
    expect(resolveInternalMdLink('tables/orders', 'schema.png')).toBeNull();
  });

  it('resolves a link from a root-level concept with no directory segment', () => {
    expect(resolveInternalMdLink('orders', 'customers.md')).toBe('customers');
  });
});
