// lib/intelligence/rss-generator.ts

/**
 * RSS 2.0 XML generator for Sector Intelligence feed output.
 *
 * Pure functions — no side effects, no external dependencies.
 * Output follows RSS 2.0 spec (https://www.rssboard.org/rss-specification)
 * with a custom `kh:relevanceScore` namespace element for AI score metadata.
 */

// ── Interfaces ──

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  categories: string[];
  guid: string;
  source?: string;
  relevanceScore?: number;
}

export interface RssChannelConfig {
  title: string;
  link: string;
  description: string;
  language: string;
  lastBuildDate: string;
  ttl: number;
}

// ── Constants ──

const KH_NAMESPACE = 'https://knowledge-hub-seven-kappa.vercel.app/ns/1.0';

// ── Public API ──

/**
 * Generate RSS 2.0 XML string from channel config and items.
 *
 * Includes a `kh:relevanceScore` custom namespace element for AI score metadata.
 */
export function generateRss(
  channel: RssChannelConfig,
  items: RssItem[],
): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<rss version="2.0" xmlns:kh="${escapeXml(KH_NAMESPACE)}">`);
  lines.push('  <channel>');
  lines.push(`    <title>${escapeXml(channel.title)}</title>`);
  lines.push(`    <link>${escapeXml(channel.link)}</link>`);
  lines.push(
    `    <description>${escapeXml(channel.description)}</description>`,
  );
  lines.push(`    <language>${escapeXml(channel.language)}</language>`);
  lines.push(
    `    <lastBuildDate>${escapeXml(channel.lastBuildDate)}</lastBuildDate>`,
  );
  lines.push(`    <ttl>${channel.ttl}</ttl>`);
  lines.push('    <generator>Knowledge Hub Sector Intelligence</generator>');

  for (const item of items) {
    lines.push('    <item>');
    lines.push(`      <title>${escapeXml(item.title)}</title>`);
    lines.push(`      <link>${escapeXml(item.link)}</link>`);
    lines.push(
      `      <description><![CDATA[${item.description}]]></description>`,
    );
    lines.push(`      <pubDate>${toRfc2822(item.pubDate)}</pubDate>`);
    lines.push(
      `      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>`,
    );

    for (const category of item.categories) {
      lines.push(`      <category>${escapeXml(category)}</category>`);
    }

    if (item.source) {
      lines.push(`      <source>${escapeXml(item.source)}</source>`);
    }

    if (item.relevanceScore !== undefined) {
      lines.push(
        `      <kh:relevanceScore>${item.relevanceScore.toFixed(2)}</kh:relevanceScore>`,
      );
    }

    lines.push('    </item>');
  }

  lines.push('  </channel>');
  lines.push('</rss>');

  return lines.join('\n');
}

/**
 * Convert ISO date string to RFC 2822 format for RSS.
 *
 * Falls back to current date if the input is invalid.
 */
export function toRfc2822(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) {
    return new Date().toUTCString();
  }
  return date.toUTCString();
}

/**
 * XML-escape text content.
 *
 * Handles the five XML predefined entities:
 * & → &amp;  < → &lt;  > → &gt;  " → &quot;  ' → &apos;
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
