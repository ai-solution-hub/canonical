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

  it('returns null for a root-relative link', () => {
    expect(resolveInternalMdLink('tables/orders', '/customers.md')).toBeNull();
  });

  it('returns null for a non-.md link', () => {
    expect(resolveInternalMdLink('tables/orders', 'schema.png')).toBeNull();
  });

  it('resolves a link from a root-level concept with no directory segment', () => {
    expect(resolveInternalMdLink('orders', 'customers.md')).toBe('customers');
  });
});
