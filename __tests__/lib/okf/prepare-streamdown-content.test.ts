/**
 * {132.32} G-LANDING-IMPL — Streamdown link-safety compat shim (LI-5).
 *
 * Streamdown's bundled `rehype-harden` rehype plugin (its default
 * `rehypePlugins`, not overridable per-instance without duplicating the
 * vendor's internal pipeline) blocks a BARE relative link outright (it only
 * recognises `/`, `./`, `../`-prefixed relatives as resolvable), and even a
 * `./`/`../`-prefixed link is re-resolved against a FIXED dummy origin
 * (`http://example.com`, not the current document's real directory) —
 * losing the actual bundle-tree directory context and any embedded `../`
 * climbing. So this shim fully pre-resolves every internal `.md` link to
 * its bundle-root-relative target (the same algorithm as
 * `resolveInternalMdLink`) and rewrites it behind a reserved
 * `INTERNAL_LINK_MARKER` path prefix that (a) always starts with `/`, so
 * harden's dummy-base resolution passes it through byte-identical (no
 * further segments to climb), and (b) cannot plausibly collide with an
 * author-written root-absolute href (which `bundle-graph.ts:extractLinks`
 * already treats as external, never internal). `<FileRenderPane>`'s `a`
 * override checks for the marker to recover the resolved bundle-relative
 * path.
 */
import { describe, it, expect } from 'vitest';
import {
  normaliseInternalMdLinksForStreamdown,
  INTERNAL_LINK_MARKER,
} from '@/lib/okf/prepare-streamdown-content';

describe('normaliseInternalMdLinksForStreamdown', () => {
  it('rewrites a bare-relative internal .md link behind the marker, resolved against the current path', () => {
    expect(
      normaliseInternalMdLinksForStreamdown(
        'See [Orders](tables/orders.md) for detail.',
        'index.md',
      ),
    ).toBe(`See [Orders](${INTERNAL_LINK_MARKER}tables/orders.md) for detail.`);
  });

  it('preserves an anchor fragment on the rewritten link', () => {
    expect(
      normaliseInternalMdLinksForStreamdown(
        '[Orders](tables/orders.md#rows)',
        'index.md',
      ),
    ).toBe(`[Orders](${INTERNAL_LINK_MARKER}tables/orders.md#rows)`);
  });

  it('resolves a link relative to a nested current file, not the bundle root', () => {
    // Written inside theme/concept.md, climbing up to a sibling theme.
    expect(
      normaliseInternalMdLinksForStreamdown(
        '[Other](../other-theme/other.md)',
        'theme/concept.md',
      ),
    ).toBe(`[Other](${INTERNAL_LINK_MARKER}other-theme/other.md)`);
  });

  it('leaves an author-written root-absolute link unchanged (treated as external, per extractLinks)', () => {
    expect(
      normaliseInternalMdLinksForStreamdown(
        '[Orders](/tables/orders.md)',
        'index.md',
      ),
    ).toBe('[Orders](/tables/orders.md)');
  });

  it('leaves an external https:// link unchanged', () => {
    expect(
      normaliseInternalMdLinksForStreamdown(
        '[GOV.UK](https://gov.uk/guide.md)',
        'index.md',
      ),
    ).toBe('[GOV.UK](https://gov.uk/guide.md)');
  });

  it('leaves a non-.md link unchanged', () => {
    expect(
      normaliseInternalMdLinksForStreamdown(
        '[Docs](https://example.com/)',
        'index.md',
      ),
    ).toBe('[Docs](https://example.com/)');
  });

  it('normalises every internal link in a multi-link document', () => {
    const input = [
      '## Sales',
      '',
      '* [Orders](tables/orders.md) — One row per order.',
      '* [Customers](tables/customers.md) — One row per customer.',
    ].join('\n');
    const expected = [
      '## Sales',
      '',
      `* [Orders](${INTERNAL_LINK_MARKER}tables/orders.md) — One row per order.`,
      `* [Customers](${INTERNAL_LINK_MARKER}tables/customers.md) — One row per customer.`,
    ].join('\n');
    expect(normaliseInternalMdLinksForStreamdown(input, 'index.md')).toBe(
      expected,
    );
  });

  it('returns text with no links unchanged', () => {
    expect(
      normaliseInternalMdLinksForStreamdown('Plain body text.', 'index.md'),
    ).toBe('Plain body text.');
  });
});
