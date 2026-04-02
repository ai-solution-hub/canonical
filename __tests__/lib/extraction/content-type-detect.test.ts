/**
 * Content Type Detection Tests
 *
 * Tests URL-based content type auto-detection from path
 * and hostname patterns.
 */
import { describe, it, expect } from 'vitest';
import { detectContentType } from '@/lib/extraction/content-type-detect';

describe('detectContentType', () => {
  it('detects PDF from file extension', () => {
    expect(detectContentType('https://example.com/report.pdf')).toBe('pdf');
  });

  it('detects PDF with query parameters', () => {
    expect(detectContentType('https://example.com/report.pdf?dl=1')).toBe(
      'pdf',
    );
  });

  it('detects blog from /blog/ path', () => {
    expect(detectContentType('https://example.com/blog/my-post')).toBe('blog');
  });

  it('detects blog from /posts/ path', () => {
    expect(detectContentType('https://example.com/posts/2024/article')).toBe(
      'blog',
    );
  });

  it('detects research from /research/ path', () => {
    expect(
      detectContentType('https://example.com/research/quantum-computing'),
    ).toBe('research');
  });

  it('detects research from /whitepaper/ path', () => {
    expect(
      detectContentType('https://example.com/whitepaper/security-overview'),
    ).toBe('research');
  });

  it('detects policy from /policy/ path', () => {
    expect(
      detectContentType('https://example.com/policy/data-protection'),
    ).toBe('policy');
  });

  it('detects product_description from /pricing/ path', () => {
    expect(detectContentType('https://example.com/pricing/')).toBe(
      'product_description',
    );
  });

  it('detects product_description from /features/ path', () => {
    expect(detectContentType('https://example.com/features/integrations')).toBe(
      'product_description',
    );
  });

  it('detects product_description from root domain', () => {
    expect(detectContentType('https://example.com/')).toBe(
      'product_description',
    );
    expect(detectContentType('https://example.com')).toBe(
      'product_description',
    );
  });

  it('returns article as default', () => {
    expect(detectContentType('https://example.com/about/team')).toBe('article');
  });

  it('handles case-insensitive patterns', () => {
    expect(detectContentType('https://example.com/Blog/My-Post')).toBe('blog');
    expect(detectContentType('https://example.com/RESEARCH/paper-1')).toBe(
      'research',
    );
  });

  it('handles URLs with query parameters correctly', () => {
    expect(
      detectContentType('https://example.com/blog/post?utm_source=twitter'),
    ).toBe('blog');
  });

  it('returns article for invalid URL', () => {
    expect(detectContentType('not-a-url')).toBe('article');
  });
});
