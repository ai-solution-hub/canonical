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

  it('warns on short content', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: 'Short.',
      extraction_method: 'test',
      extraction_confidence: 'low',
    });
    expect(result.quality_warnings).toContain(
      'Very short content (under 100 words)',
    );
  });

  it('warns on missing headings', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: 'Test',
      content_markdown: 'Just plain text without any headings.',
      extraction_method: 'test',
      extraction_confidence: 'high',
    });
    expect(result.quality_warnings).toContain('No headings detected');
  });

  it('warns on empty title', () => {
    const result = createPipelineExtractionResult({
      source_format: 'html',
      title: '',
      content_markdown: 'Content here.',
      extraction_method: 'test',
      extraction_confidence: 'high',
    });
    expect(result.quality_warnings).toContain('Empty title');
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
});
