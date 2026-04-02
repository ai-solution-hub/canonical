/**
 * Unit tests for RSS 2.0 XML generator.
 *
 * Tests cover:
 *  - Valid RSS 2.0 structure (XML declaration, root element, channel)
 *  - Channel metadata rendering
 *  - Item rendering (title, link, description, pubDate, guid, categories, source)
 *  - Custom kh:relevanceScore namespace element
 *  - XML escaping of special characters
 *  - CDATA wrapping of descriptions
 *  - RFC 2822 date conversion
 *  - Edge cases (empty items, missing optional fields, invalid dates)
 */
import { describe, it, expect } from 'vitest';
import {
  generateRss,
  toRfc2822,
  escapeXml,
  type RssChannelConfig,
  type RssItem,
} from '@/lib/intelligence/rss-generator';

// ── Fixtures ──

const CHANNEL: RssChannelConfig = {
  title: 'example-client Design — Sector Intelligence',
  link: 'https://example.com/intelligence/ws-1',
  description: 'AI-filtered intelligence feed for example-client Design',
  language: 'en-GB',
  lastBuildDate: 'Wed, 02 Apr 2025 12:00:00 GMT',
  ttl: 15,
};

const ITEM: RssItem = {
  title: 'New Safeguarding Guidance Released',
  link: 'https://www.gov.uk/safeguarding-update',
  description:
    'The DfE has released updated safeguarding guidance for schools.',
  pubDate: '2025-04-01T10:00:00Z',
  categories: ['safeguarding', 'education'],
  guid: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  source: 'GOV.UK',
  relevanceScore: 0.87,
};

// ── generateRss ──

describe('generateRss', () => {
  it('starts with XML declaration', () => {
    const xml = generateRss(CHANNEL, []);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  });

  it('has RSS 2.0 root element with kh namespace', () => {
    const xml = generateRss(CHANNEL, []);
    expect(xml).toContain('<rss version="2.0" xmlns:kh=');
    expect(xml).toContain('</rss>');
  });

  it('renders channel metadata correctly', () => {
    const xml = generateRss(CHANNEL, []);
    expect(xml).toContain('<title>example-client Design — Sector Intelligence</title>');
    expect(xml).toContain('<link>https://example.com/intelligence/ws-1</link>');
    expect(xml).toContain(
      '<description>AI-filtered intelligence feed for example-client Design</description>',
    );
    expect(xml).toContain('<language>en-GB</language>');
    expect(xml).toContain('<ttl>15</ttl>');
    expect(xml).toContain(
      '<generator>Knowledge Hub Sector Intelligence</generator>',
    );
  });

  it('renders channel lastBuildDate', () => {
    const xml = generateRss(CHANNEL, []);
    expect(xml).toContain(
      '<lastBuildDate>Wed, 02 Apr 2025 12:00:00 GMT</lastBuildDate>',
    );
  });

  it('produces valid RSS with empty items array', () => {
    const xml = generateRss(CHANNEL, []);
    expect(xml).toContain('<channel>');
    expect(xml).toContain('</channel>');
    expect(xml).not.toContain('<item>');
  });

  it('renders item title, link, pubDate, and guid', () => {
    const xml = generateRss(CHANNEL, [ITEM]);
    expect(xml).toContain('<title>New Safeguarding Guidance Released</title>');
    expect(xml).toContain(
      '<link>https://www.gov.uk/safeguarding-update</link>',
    );
    expect(xml).toContain(
      '<guid isPermaLink="false">a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d</guid>',
    );
    // pubDate should be RFC 2822
    expect(xml).toContain('<pubDate>Tue, 01 Apr 2025 10:00:00 GMT</pubDate>');
  });

  it('wraps description in CDATA', () => {
    const xml = generateRss(CHANNEL, [ITEM]);
    expect(xml).toContain(
      '<description><![CDATA[The DfE has released updated safeguarding guidance for schools.]]></description>',
    );
  });

  it('preserves HTML in CDATA-wrapped descriptions', () => {
    const htmlItem: RssItem = {
      ...ITEM,
      description: '<p>Important <strong>update</strong> for all schools.</p>',
    };
    const xml = generateRss(CHANNEL, [htmlItem]);
    expect(xml).toContain(
      '<![CDATA[<p>Important <strong>update</strong> for all schools.</p>]]>',
    );
  });

  it('renders each category as a separate element', () => {
    const xml = generateRss(CHANNEL, [ITEM]);
    expect(xml).toContain('<category>safeguarding</category>');
    expect(xml).toContain('<category>education</category>');
  });

  it('renders source element when provided', () => {
    const xml = generateRss(CHANNEL, [ITEM]);
    expect(xml).toContain('<source>GOV.UK</source>');
  });

  it('omits source element when not provided', () => {
    const noSourceItem: RssItem = { ...ITEM, source: undefined };
    const xml = generateRss(CHANNEL, [noSourceItem]);
    expect(xml).not.toContain('<source>');
  });

  it('renders kh:relevanceScore custom element', () => {
    const xml = generateRss(CHANNEL, [ITEM]);
    expect(xml).toContain('<kh:relevanceScore>0.87</kh:relevanceScore>');
  });

  it('omits kh:relevanceScore when not provided', () => {
    const noScoreItem: RssItem = { ...ITEM, relevanceScore: undefined };
    const xml = generateRss(CHANNEL, [noScoreItem]);
    expect(xml).not.toContain('kh:relevanceScore');
  });

  it('formats relevanceScore to 2 decimal places', () => {
    const preciseItem: RssItem = { ...ITEM, relevanceScore: 0.9 };
    const xml = generateRss(CHANNEL, [preciseItem]);
    expect(xml).toContain('<kh:relevanceScore>0.90</kh:relevanceScore>');
  });

  it('escapes special characters in item titles', () => {
    const specialItem: RssItem = {
      ...ITEM,
      title: 'R&D Update: "New" <Framework> for Schools',
    };
    const xml = generateRss(CHANNEL, [specialItem]);
    expect(xml).toContain(
      '<title>R&amp;D Update: &quot;New&quot; &lt;Framework&gt; for Schools</title>',
    );
  });

  it('escapes special characters in channel title', () => {
    const specialChannel: RssChannelConfig = {
      ...CHANNEL,
      title: 'example-client & Co — "Intelligence"',
    };
    const xml = generateRss(specialChannel, []);
    expect(xml).toContain(
      '<title>example-client &amp; Co — &quot;Intelligence&quot;</title>',
    );
  });

  it('renders multiple items in order', () => {
    const items: RssItem[] = [
      { ...ITEM, title: 'First Article', guid: 'guid-1' },
      { ...ITEM, title: 'Second Article', guid: 'guid-2' },
      { ...ITEM, title: 'Third Article', guid: 'guid-3' },
    ];
    const xml = generateRss(CHANNEL, items);
    const firstIndex = xml.indexOf('First Article');
    const secondIndex = xml.indexOf('Second Article');
    const thirdIndex = xml.indexOf('Third Article');
    expect(firstIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(thirdIndex);
  });

  it('handles items with empty categories array', () => {
    const noCatItem: RssItem = { ...ITEM, categories: [] };
    const xml = generateRss(CHANNEL, [noCatItem]);
    expect(xml).not.toContain('<category>');
    expect(xml).toContain('<item>');
  });
});

// ── toRfc2822 ──

describe('toRfc2822', () => {
  it('converts ISO date to RFC 2822 format', () => {
    const result = toRfc2822('2025-04-01T10:00:00Z');
    expect(result).toBe('Tue, 01 Apr 2025 10:00:00 GMT');
  });

  it('handles ISO date with timezone offset', () => {
    const result = toRfc2822('2025-04-01T11:00:00+01:00');
    // +01:00 means 10:00 UTC
    expect(result).toBe('Tue, 01 Apr 2025 10:00:00 GMT');
  });

  it('handles full ISO date-time string', () => {
    const result = toRfc2822('2025-12-25T00:00:00.000Z');
    expect(result).toBe('Thu, 25 Dec 2025 00:00:00 GMT');
  });

  it('returns a valid date string for invalid input', () => {
    const result = toRfc2822('not-a-date');
    // Should fall back to current date — just check it is a valid UTC string
    expect(result).toMatch(/GMT$/);
  });
});

// ── escapeXml ──

describe('escapeXml', () => {
  it('escapes ampersands', () => {
    expect(escapeXml('R&D')).toBe('R&amp;D');
  });

  it('escapes less-than signs', () => {
    expect(escapeXml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater-than signs', () => {
    expect(escapeXml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeXml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes (apostrophes)', () => {
    expect(escapeXml("it's")).toBe('it&apos;s');
  });

  it('handles multiple special characters in one string', () => {
    expect(escapeXml('<a href="url?x=1&y=2">it\'s</a>')).toBe(
      '&lt;a href=&quot;url?x=1&amp;y=2&quot;&gt;it&apos;s&lt;/a&gt;',
    );
  });

  it('returns plain text unchanged', () => {
    expect(escapeXml('Hello world')).toBe('Hello world');
  });

  it('handles empty string', () => {
    expect(escapeXml('')).toBe('');
  });
});
