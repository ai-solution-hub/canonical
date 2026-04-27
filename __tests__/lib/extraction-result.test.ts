import { describe, it, expect } from 'vitest';
import { createPipelineExtractionResult } from '@/lib/extraction/extraction-result';

describe('createPipelineExtractionResult', () => {
  it('computes content_plain from content_markdown', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: '## Heading\n\nSome **bold** text.',
      extraction_method: 'readability',
      extraction_confidence: 'high',
    });
    expect(result.content_plain).toBe('Heading\n\nSome bold text.');
  });

  it('extracts headings', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: '# H1\n\n## H2\n\n### H3',
      extraction_method: 'readability',
      extraction_confidence: 'high',
    });
    expect(result.headings).toHaveLength(3);
    expect(result.headings[0]).toEqual(
      expect.objectContaining({ level: 1, text: 'H1' }),
    );
    expect(result.headings[1]).toEqual(
      expect.objectContaining({ level: 2, text: 'H2' }),
    );
    expect(result.headings[2]).toEqual(
      expect.objectContaining({ level: 3, text: 'H3' }),
    );
  });

  it('counts words correctly', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: 'One two three four five',
      extraction_method: 'test',
      extraction_confidence: 'high',
    });
    expect(result.word_count).toBe(5);
  });

  it('detects tables', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: '| A | B |\n| --- | --- |\n| 1 | 2 |',
      extraction_method: 'test',
      extraction_confidence: 'high',
    });
    expect(result.has_tables).toBe(true);
  });

  it('detects code blocks', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: '```\nconst x = 1;\n```',
      extraction_method: 'test',
      extraction_confidence: 'high',
    });
    expect(result.has_code_blocks).toBe(true);
  });

  it('warns on very short content (< 50 words)', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: 'Short piece with fewer than fifty words overall.',
      extraction_method: 'test',
      extraction_confidence: 'low',
    });
    expect(result.quality_warnings).toContain('very short content');
  });

  it('does not warn "very short" when word_count >= 50', () => {
    const fifty = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: fifty,
      extraction_method: 'test',
      extraction_confidence: 'high',
    });
    expect(result.quality_warnings).not.toContain('very short content');
  });

  it('warns on no headings only when word_count > 200', () => {
    const longBody = Array.from({ length: 220 }, (_, i) => `word${i}`).join(
      ' ',
    );
    const withLongBody = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: longBody,
      extraction_method: 'test',
      extraction_confidence: 'high',
    });
    expect(withLongBody.quality_warnings).toContain('no headings detected');

    const shortBody = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: 'Just plain text without any headings.',
      extraction_method: 'test',
      extraction_confidence: 'high',
    });
    expect(shortBody.quality_warnings).not.toContain('no headings detected');
  });

  it('warns on PDFs with no tables detected', () => {
    const body = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const result = createPipelineExtractionResult({
      source_format: 'pdf',
      title: 'Policy PDF',
      content_markdown: `# Heading\n\n${body}`,
      extraction_method: 'pdfplumber',
      extraction_confidence: 'medium',
    });
    expect(result.quality_warnings).toContain('no tables detected in PDF');
  });

  it('does not warn "no tables in PDF" when tables are present', () => {
    const result = createPipelineExtractionResult({
      source_format: 'pdf',
      title: 'Policy PDF',
      content_markdown:
        '# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nBody text.',
      extraction_method: 'pdfplumber',
      extraction_confidence: 'medium',
    });
    expect(result.quality_warnings).not.toContain('no tables detected in PDF');
  });

  it('warns on high markdown-to-plain ratio (> 1.25)', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown:
        '[link text](https://example.com) [link text](https://example.com) [link text](https://example.com)',
      extraction_method: 'test',
      extraction_confidence: 'high',
    });
    expect(result.quality_warnings).toContain('high markdown-to-plain ratio');
  });

  it('does not warn high-ratio when syntax is modest', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: 'Plain prose with no decoration at all.',
      extraction_method: 'test',
      extraction_confidence: 'high',
    });
    expect(result.quality_warnings).not.toContain(
      'high markdown-to-plain ratio',
    );
  });

  // "empty title" is kept as a defensible extension of the Plan D spec:
  // the spec enumerates 4 warnings but does not forbid additional ones,
  // and empty titles are a real pipeline defect worth flagging.
  it('warns on empty title', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: '',
      content_markdown: 'Content here.',
      extraction_method: 'test',
      extraction_confidence: 'high',
    });
    expect(result.quality_warnings).toContain('empty title');
  });

  it('sets extractor_version and extracted_at', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: 'Content.',
      extraction_method: 'test',
      extraction_confidence: 'high',
    });
    expect(result.extractor_version).toBe('1.0.0');
    expect(result.extracted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('passes through optional source fields', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: 'Content.',
      extraction_method: 'test',
      extraction_confidence: 'high',
      source_url: 'https://example.com',
    });
    expect(result.source_url).toBe('https://example.com');
  });

  it('handles empty content_markdown without throwing', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: '',
      extraction_method: 'test',
      extraction_confidence: 'low',
    });
    expect(result.content_plain).toBe('');
    expect(result.word_count).toBe(0);
    expect(result.headings).toEqual([]);
    expect(result.has_tables).toBe(false);
    expect(result.has_code_blocks).toBe(false);
    expect(result.quality_warnings).toContain('very short content');
    expect(result.quality_warnings).not.toContain(
      'high markdown-to-plain ratio',
    );
  });
});
