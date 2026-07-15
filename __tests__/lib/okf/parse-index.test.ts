import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseBundleNav } from '@/lib/okf/parse-index';

// ID-132 {132.10} G-BUNDLE round-trip (S451 rider, BINDING): the fixture
// below is emitted VERBATIM by `producer/bundle_writer.py`'s own
// `regenerate_indexes` — proving the writer's output structurally parses
// (never falls through to the graceful type-grouping fallback), not just
// that hand-authored text in this file happens to match the regex. A
// format drift between the writer and this parser would degrade
// `<BundleNav>` SILENTLY (both parsers have a graceful fallback) — this
// test is the guard against that. De-identified: generic placeholder
// theme/concept names, never the real first-client corpus.
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const FIXTURE_PATH = resolve(
  REPO_ROOT,
  '__tests__/fixtures/okf/bundle-writer-index.md',
);

describe('parseBundleNav', () => {
  it('skips the SPEC §11 okf_version frontmatter block the writer stamps on the bundle-root index', () => {
    const text = readFileSync(FIXTURE_PATH, 'utf8');
    // The regenerated fixture opens with the §11 frontmatter stamp…
    expect(text.startsWith('---\nokf_version: "0.1"\n---\n')).toBe(true);

    // …and the nav still parses fully structured with the block present:
    // only content BELOW the closing fence contributes themes.
    const minimal = [
      '---',
      'okf_version: "0.1"',
      '---',
      '## Real Theme',
      '',
      '* [Concept](concept.md) — A concept.',
    ].join('\n');
    const themes = parseBundleNav(minimal);
    expect(themes).toHaveLength(1);
    expect(themes[0].heading).toBe('Real Theme');
  });

  it('parses the {132.10} bundle_writer.regenerate_indexes() fixture with full structure (no fallback)', () => {
    const text = readFileSync(FIXTURE_PATH, 'utf8');

    const themes = parseBundleNav(text);

    expect(themes).toHaveLength(3);
    expect(themes.map((t) => t.heading)).toEqual([
      'Company Overview',
      'Security and Compliance',
      'Products',
    ]);
    expect(themes.every((t) => t.level === 2)).toBe(true);

    const security = themes[1];
    expect(security.concepts).toHaveLength(2);
    expect(security.concepts[0]).toMatchObject({
      title: 'Data Encryption',
      path: 'topics/encryption',
      description: 'Encryption at rest and in transit.',
    });
    expect(security.children).toHaveLength(1);
    expect(security.children[0]).toMatchObject({
      heading: 'Certifications',
      level: 3,
      concepts: [
        {
          title: 'ISO 27001',
          path: 'certifications/iso-27001',
          description: 'Information security management certification.',
        },
      ],
    });

    // Every theme carries at least one concept somewhere in its subtree —
    // proof this parsed as STRUCTURED nav, not an empty/fallback shape.
    for (const theme of themes) {
      const total =
        theme.concepts.length +
        theme.children.reduce((sum, child) => sum + child.concepts.length, 0);
      expect(total).toBeGreaterThan(0);
    }
  });
  it('parses ## theme headings with concept bullets into a nav tree', () => {
    const text = [
      '## Pricing',
      '',
      '* [Standard tier](topics/pricing/standard.md) — The standard pricing tier.',
      '* [Enterprise tier](topics/pricing/enterprise.md) — The enterprise pricing tier.',
      '',
      '## Security',
      '',
      '* [SOC 2](topics/security/soc2.md) — Our SOC 2 compliance posture.',
    ].join('\n');

    const themes = parseBundleNav(text);

    expect(themes).toHaveLength(2);
    expect(themes[0]).toMatchObject({
      heading: 'Pricing',
      level: 2,
      concepts: [
        {
          title: 'Standard tier',
          path: 'topics/pricing/standard',
          description: 'The standard pricing tier.',
        },
        {
          title: 'Enterprise tier',
          path: 'topics/pricing/enterprise',
          description: 'The enterprise pricing tier.',
        },
      ],
    });
    expect(themes[1].heading).toBe('Security');
  });

  it('nests ### subtheme headings as children of the preceding ## theme', () => {
    const text = [
      '## Product',
      '',
      '### Pricing',
      '',
      '* [Standard tier](standard.md) — The standard tier.',
      '',
      '### Packaging',
      '',
      '* [Bundles](bundles.md) — How bundles work.',
    ].join('\n');

    const themes = parseBundleNav(text);

    expect(themes).toHaveLength(1);
    expect(themes[0].heading).toBe('Product');
    expect(themes[0].concepts).toEqual([]);
    expect(themes[0].children).toHaveLength(2);
    expect(themes[0].children[0]).toMatchObject({
      heading: 'Pricing',
      level: 3,
      concepts: [{ title: 'Standard tier', path: 'standard' }],
    });
    expect(themes[0].children[1].heading).toBe('Packaging');
  });

  it('accepts a bullet with no description', () => {
    const text = ['## Topics', '', '* [Bare concept](bare.md)'].join('\n');

    const themes = parseBundleNav(text);

    expect(themes[0].concepts[0]).toMatchObject({
      title: 'Bare concept',
      path: 'bare',
      description: '',
    });
  });

  it('ignores non-bullet lines and unrelated content', () => {
    const text = [
      '# Bundle index',
      '',
      'Some preamble prose that is not a theme heading.',
      '',
      '## Topics',
      '',
      'A short blurb about this theme.',
      '',
      '* [Concept one](one.md) — First concept.',
    ].join('\n');

    const themes = parseBundleNav(text);

    expect(themes).toHaveLength(1);
    expect(themes[0].concepts).toHaveLength(1);
  });

  it('returns an empty array for content with no ##/### headings', () => {
    expect(parseBundleNav('Just some prose, no structure.')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseBundleNav('')).toEqual([]);
  });
});
