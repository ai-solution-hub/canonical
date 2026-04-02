/**
 * HTML Extraction Tests
 *
 * Tests the Readability-based text extraction from HTML pages.
 * jsdom and Readability are mocked to avoid heavy dependency
 * loading in unit tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock setup — must use vi.hoisted for Vitest v4 factory hoisting
// ---------------------------------------------------------------------------

const { mockParse, MockReadability } = vi.hoisted(() => {
  const mockParse = vi.fn();
  // Use function keyword (not arrow) so it can be used with `new`
  function MockReadability() {
    return { parse: mockParse };
  }
  return { mockParse, MockReadability };
});

vi.mock('jsdom', () => ({
  JSDOM: function JSDOM(html: string) {
    // Create a minimal window.document mock
    return {
      window: {
        document: { body: { textContent: html } },
      },
    };
  },
}));

vi.mock('@mozilla/readability', () => ({
  Readability: MockReadability,
}));

import { extractFromHtml } from '@/lib/extraction/html';

describe('extractFromHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts title from HTML', async () => {
    mockParse.mockReturnValue({
      title: 'Test Article Title',
      textContent: 'This is the article body content.',
      byline: 'Jane Doe',
      excerpt: 'A short excerpt.',
    });

    const result = await extractFromHtml(
      '<html><body>...</body></html>',
      'https://example.com',
    );
    expect(result.title).toBe('Test Article Title');
  });

  it('extracts text content', async () => {
    mockParse.mockReturnValue({
      title: 'Title',
      textContent: 'Full article body text with multiple paragraphs.',
      byline: '',
      excerpt: '',
    });

    const result = await extractFromHtml(
      '<html><body>...</body></html>',
      'https://example.com',
    );
    expect(result.content).toBe(
      'Full article body text with multiple paragraphs.',
    );
  });

  it('extracts byline as author', async () => {
    mockParse.mockReturnValue({
      title: 'Title',
      textContent: 'Content here.',
      byline: 'John Smith',
      excerpt: '',
    });

    const result = await extractFromHtml(
      '<html><body>...</body></html>',
      'https://example.com',
    );
    expect(result.author).toBe('John Smith');
  });

  it('extracts excerpt', async () => {
    mockParse.mockReturnValue({
      title: 'Title',
      textContent: 'Content here.',
      byline: '',
      excerpt: 'A brief summary of the article.',
    });

    const result = await extractFromHtml(
      '<html><body>...</body></html>',
      'https://example.com',
    );
    expect(result.excerpt).toBe('A brief summary of the article.');
  });

  it('throws on empty/unparseable content', async () => {
    mockParse.mockReturnValue(null);

    await expect(
      extractFromHtml('<html><body></body></html>', 'https://example.com'),
    ).rejects.toThrow('Could not extract readable content');
  });

  it('throws on content with only whitespace', async () => {
    mockParse.mockReturnValue({
      title: 'Title',
      textContent: '   \n\t  ',
      byline: '',
      excerpt: '',
    });

    await expect(
      extractFromHtml('<html><body>   </body></html>', 'https://example.com'),
    ).rejects.toThrow('Could not extract readable content');
  });

  it('handles missing byline gracefully', async () => {
    mockParse.mockReturnValue({
      title: 'Title',
      textContent: 'Content.',
      byline: null,
      excerpt: '',
    });

    const result = await extractFromHtml(
      '<html><body>...</body></html>',
      'https://example.com',
    );
    expect(result.author).toBe('');
  });

  it('handles missing title gracefully', async () => {
    mockParse.mockReturnValue({
      title: null,
      textContent: 'Some content.',
      byline: '',
      excerpt: '',
    });

    const result = await extractFromHtml(
      '<html><body>...</body></html>',
      'https://example.com',
    );
    expect(result.title).toBe('');
  });
});
