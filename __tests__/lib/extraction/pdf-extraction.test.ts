import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExtractText = vi.hoisted(() => vi.fn());

vi.mock('unpdf', () => ({
  extractText: mockExtractText,
}));

import { extractPdfText } from '@/lib/extraction/pdf';

describe('extractPdfText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('joins multiple pages with markdown separators', async () => {
    mockExtractText.mockResolvedValue({
      totalPages: 2,
      text: ['Page one content', 'Page two content'],
    });

    const result = await extractPdfText(new ArrayBuffer(8));
    expect(result.text).toBe('Page one content\n\n---\n\nPage two content');
    expect(result.pageCount).toBe(2);
  });

  it('filters empty pages', async () => {
    mockExtractText.mockResolvedValue({
      totalPages: 3,
      text: ['Page one', '', 'Page three'],
    });

    const result = await extractPdfText(new ArrayBuffer(8));
    expect(result.text).toBe('Page one\n\n---\n\nPage three');
  });

  it('trims whitespace-only pages', async () => {
    mockExtractText.mockResolvedValue({
      totalPages: 3,
      text: ['Page one', '   \n\t  ', 'Page three'],
    });

    const result = await extractPdfText(new ArrayBuffer(8));
    expect(result.text).toBe('Page one\n\n---\n\nPage three');
  });

  it('handles single page without separator', async () => {
    mockExtractText.mockResolvedValue({
      totalPages: 1,
      text: ['Only page'],
    });

    const result = await extractPdfText(new ArrayBuffer(8));
    expect(result.text).toBe('Only page');
    expect(result.pageCount).toBe(1);
  });

  it('handles null totalPages', async () => {
    mockExtractText.mockResolvedValue({
      totalPages: null,
      text: ['Content'],
    });

    const result = await extractPdfText(new ArrayBuffer(8));
    expect(result.pageCount).toBe(0);
  });
});
