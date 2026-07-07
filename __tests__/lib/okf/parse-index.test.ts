import { describe, it, expect } from 'vitest';
import { parseBundleNav } from '@/lib/okf/parse-index';

describe('parseBundleNav', () => {
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
