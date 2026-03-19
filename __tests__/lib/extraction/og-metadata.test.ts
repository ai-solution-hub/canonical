/**
 * OG Metadata Extraction Tests
 *
 * Tests regex-based extraction of Open Graph and standard
 * meta tags from raw HTML strings.
 */
import { describe, it, expect } from 'vitest';
import { extractOgMetadata } from '@/lib/extraction/og-metadata';

describe('extractOgMetadata', () => {
  it('extracts og:image', () => {
    const html = '<meta property="og:image" content="https://example.com/image.jpg">';
    const result = extractOgMetadata(html);
    expect(result.ogImage).toBe('https://example.com/image.jpg');
  });

  it('extracts og:description', () => {
    const html = '<meta property="og:description" content="A description of the page.">';
    const result = extractOgMetadata(html);
    expect(result.ogDescription).toBe('A description of the page.');
  });

  it('extracts article:author', () => {
    const html = '<meta property="article:author" content="Jane Doe">';
    const result = extractOgMetadata(html);
    expect(result.ogAuthor).toBe('Jane Doe');
  });

  it('falls back to name="author" meta tag', () => {
    const html = '<meta name="author" content="John Smith">';
    const result = extractOgMetadata(html);
    expect(result.ogAuthor).toBe('John Smith');
  });

  it('prefers article:author over name="author"', () => {
    const html = `
      <meta property="article:author" content="First Author">
      <meta name="author" content="Second Author">
    `;
    const result = extractOgMetadata(html);
    expect(result.ogAuthor).toBe('First Author');
  });

  it('extracts article:published_time', () => {
    const html = '<meta property="article:published_time" content="2024-01-15T10:00:00Z">';
    const result = extractOgMetadata(html);
    expect(result.ogDate).toBe('2024-01-15T10:00:00Z');
  });

  it('returns empty strings for missing values', () => {
    const html = '<html><head><title>No OG tags</title></head></html>';
    const result = extractOgMetadata(html);
    expect(result.ogImage).toBe('');
    expect(result.ogDescription).toBe('');
    expect(result.ogAuthor).toBe('');
    expect(result.ogDate).toBe('');
  });

  it('handles single-quoted attributes', () => {
    const html = "<meta property='og:image' content='https://example.com/pic.png'>";
    const result = extractOgMetadata(html);
    expect(result.ogImage).toBe('https://example.com/pic.png');
  });

  it('handles content attribute before property attribute', () => {
    const html = '<meta content="https://example.com/img.jpg" property="og:image">';
    const result = extractOgMetadata(html);
    expect(result.ogImage).toBe('https://example.com/img.jpg');
  });
});
