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
 * further segments to climb), and (b) is a reserved prefix that cannot
 * plausibly collide with real bundle content. A leading-`/` `.md` href is
 * the SPEC §5.1 bundle-ABSOLUTE form (the producer's citation-trailer +
 * body-prose cross-link convention) — already bundle-root-relative, so it
 * is rewritten behind the marker directly. `<FileRenderPane>`'s `a`
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

  it('rewrites a leading-/ bundle-absolute link behind the marker (SPEC §5.1 form)', () => {
    // The producer's citation-trailer + body-prose cross-link convention —
    // already bundle-root-relative, so no directory resolution happens.
    expect(
      normaliseInternalMdLinksForStreamdown(
        '[Orders](/tables/orders.md)',
        'theme/concept.md',
      ),
    ).toBe(`[Orders](${INTERNAL_LINK_MARKER}tables/orders.md)`);
  });

  it('leaves an already-marked href unchanged (idempotent)', () => {
    const marked = `[Orders](${INTERNAL_LINK_MARKER}tables/orders.md)`;
    expect(normaliseInternalMdLinksForStreamdown(marked, 'index.md')).toBe(
      marked,
    );
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

/**
 * {132.49} union-graph regression. `<UnionGraphView>` renders bodies whose
 * concept id is namespaced (`acme::services/orders`). A target resolved
 * WITHOUT that namespace can never match a union node id, so the link
 * degrades to a dead off-app anchor. The `..` and bundle-absolute cases
 * below are the two that regressed; the same-directory case always worked
 * (the separator happens to ride along in the first path segment) and is
 * pinned here so a future refactor cannot quietly break it.
 */
describe('normaliseInternalMdLinksForStreamdown — union-namespaced bodies', () => {
  it('keeps the owning bundle on a link into the same directory', () => {
    expect(
      normaliseInternalMdLinksForStreamdown(
        '[Billing](./billing.md)',
        'acme::services/orders',
      ),
    ).toBe(`[Billing](${INTERNAL_LINK_MARKER}acme::services/billing.md)`);
  });

  it('keeps the owning bundle on a link that climbs out of its directory', () => {
    expect(
      normaliseInternalMdLinksForStreamdown(
        '[Customer](../domain/customer.md)',
        'acme::services/orders',
      ),
    ).toBe(`[Customer](${INTERNAL_LINK_MARKER}acme::domain/customer.md)`);
  });

  it('keeps the owning bundle on a bundle-absolute citation-trailer link', () => {
    // SPEC §5.1 — the form the producer writes under `# Citations`.
    expect(
      normaliseInternalMdLinksForStreamdown(
        '[Glossary](/glossary.md)',
        'acme::services/orders',
      ),
    ).toBe(`[Glossary](${INTERNAL_LINK_MARKER}acme::glossary.md)`);
  });

  it('resolves within the owning bundle, never into a sibling bundle', () => {
    // Two bundles can carry the identical concept path; climbing above the
    // bundle root must not silently address the other one.
    expect(
      normaliseInternalMdLinksForStreamdown(
        '[Escape](../../../glossary.md)',
        'acme::services/orders',
      ),
    ).toBe(`[Escape](${INTERNAL_LINK_MARKER}acme::glossary.md)`);
  });

  it('leaves per-bundle viewer bodies exactly as before', () => {
    // Un-namespaced ids must be byte-identical to the pre-union behaviour.
    expect(
      normaliseInternalMdLinksForStreamdown(
        '[Customer](../domain/customer.md) and [Glossary](/glossary.md)',
        'services/orders',
      ),
    ).toBe(
      `[Customer](${INTERNAL_LINK_MARKER}domain/customer.md) and ` +
        `[Glossary](${INTERNAL_LINK_MARKER}glossary.md)`,
    );
  });
});
