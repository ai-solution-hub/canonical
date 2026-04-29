import { describe, it, expect } from 'vitest';
import { extractMarkdownTitle } from '@/lib/extraction/markdown-title';

describe('extractMarkdownTitle', () => {
  it('prefers front-matter title over body H1 and filename', () => {
    const result = extractMarkdownTitle({
      frontMatter: { title: 'FM Title' },
      body: '# Body H1\n\ncontent',
      filename: 'fallback-name.md',
    });

    expect(result.title).toBe('FM Title');
    expect(result.provenance).toBe('front-matter');
  });

  it('falls back to first H1 when front-matter has no title', () => {
    const result = extractMarkdownTitle({
      frontMatter: {},
      body: '# Body Heading\n\nsome content',
      filename: 'whatever.md',
    });

    expect(result.title).toBe('Body Heading');
    expect(result.provenance).toBe('h1');
  });

  it('falls back to filename when no front-matter and no H1', () => {
    const result = extractMarkdownTitle({
      frontMatter: {},
      body: 'No heading here, just paragraph text.',
      filename: 'my-cool-article.md',
    });

    expect(result.title).toBe('My Cool Article');
    expect(result.provenance).toBe('filename');
  });

  it('returns the front-matter title even when an H1 also exists', () => {
    const result = extractMarkdownTitle({
      frontMatter: { title: 'Front Wins' },
      body: '# H1 Loses\n\nbody',
      filename: 'name.md',
    });

    expect(result.title).toBe('Front Wins');
    expect(result.provenance).toBe('front-matter');
  });

  it('extracts bold-after-Article-N pattern (Python parity)', () => {
    const result = extractMarkdownTitle({
      frontMatter: {},
      body: '# Article 5\n\n**The Real Title Goes Here**\n\nBody.',
      filename: 'article-5.md',
    });

    expect(result.title).toBe('The Real Title Goes Here');
    expect(result.provenance).toBe('bold-after-article-n');
  });

  it('skips H1s that match generic "Article N" and continues to filename fallback', () => {
    const result = extractMarkdownTitle({
      frontMatter: {},
      body: '# Article 3\n\nNo bold title line follows.',
      filename: 'article-3.md',
    });

    expect(result.title).toBe('Article 3');
    expect(result.provenance).toBe('filename');
  });

  it('strips trailing whitespace from front-matter title', () => {
    const result = extractMarkdownTitle({
      frontMatter: { title: '  Padded Title   ' },
      body: '',
      filename: 'x.md',
    });

    expect(result.title).toBe('Padded Title');
    expect(result.provenance).toBe('front-matter');
  });

  it('handles filename without extension and underscores', () => {
    const result = extractMarkdownTitle({
      frontMatter: {},
      body: 'No headings.',
      filename: 'snake_case_file_name',
    });

    expect(result.title).toBe('Snake Case File Name');
    expect(result.provenance).toBe('filename');
  });

  it('ignores non-string front-matter title and falls back', () => {
    const result = extractMarkdownTitle({
      frontMatter: { title: 42 },
      body: '# Real H1',
      filename: 'name.md',
    });

    expect(result.title).toBe('Real H1');
    expect(result.provenance).toBe('h1');
  });
});
