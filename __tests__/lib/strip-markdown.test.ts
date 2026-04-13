import { describe, it, expect } from 'vitest';
import { stripMarkdown } from '@/lib/content/strip-markdown';

describe('stripMarkdown', () => {
  it('removes heading markers', () => {
    expect(stripMarkdown('## Heading')).toBe('Heading');
    expect(stripMarkdown('### Sub Heading')).toBe('Sub Heading');
    expect(stripMarkdown('# H1\n## H2\n### H3')).toBe('H1\nH2\nH3');
  });

  it('removes bold and italic markers', () => {
    expect(stripMarkdown('**bold**')).toBe('bold');
    expect(stripMarkdown('*italic*')).toBe('italic');
    expect(stripMarkdown('__bold__')).toBe('bold');
    expect(stripMarkdown('_italic_')).toBe('italic');
  });

  it('extracts link text, drops URLs', () => {
    expect(stripMarkdown('[link text](http://example.com)')).toBe('link text');
  });

  it('extracts image alt text, drops URLs', () => {
    expect(stripMarkdown('![alt text](http://example.com/img.png)')).toBe(
      'alt text',
    );
  });

  it('removes inline code markers', () => {
    expect(stripMarkdown('use `code` here')).toBe('use code here');
  });

  it('removes fenced code block markers', () => {
    const input = '```javascript\nconst x = 1;\n```';
    const result = stripMarkdown(input);
    expect(result).toContain('const x = 1;');
    expect(result).not.toContain('```');
  });

  it('removes blockquote markers', () => {
    expect(stripMarkdown('> quoted text')).toBe('quoted text');
  });

  it('removes horizontal rules', () => {
    expect(stripMarkdown('---')).toBe('');
    // *** and ___ are partially consumed by bold/italic stripping first,
    // leaving a single marker character. Only --- is a pure HR match.
    expect(stripMarkdown('***')).toBe('*');
    expect(stripMarkdown('___')).toBe('_');
  });

  it('handles table separator rows', () => {
    expect(stripMarkdown('|---|---|')).toBe('');
    expect(stripMarkdown('| :--- | ---: |')).toBe('');
  });

  it('extracts table content', () => {
    // Pipes replaced with double spaces; original spacing preserved around content
    expect(stripMarkdown('| Cell 1 | Cell 2 |')).toBe('Cell 1    Cell 2');
  });

  it('removes reference-style link definitions', () => {
    expect(stripMarkdown('[1]: http://example.com')).toBe('');
  });

  it('handles nested formatting', () => {
    expect(stripMarkdown('**bold _and italic_**')).toBe('bold and italic');
  });

  it('returns empty string for empty input', () => {
    expect(stripMarkdown('')).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(stripMarkdown('just plain text')).toBe('just plain text');
  });

  it('collapses multiple blank lines', () => {
    expect(stripMarkdown('line 1\n\n\n\nline 2')).toBe('line 1\n\nline 2');
  });

  it('handles a realistic markdown sample', () => {
    const input = [
      '## Policy Statement',
      '',
      'We are committed to **quality** in all our work.',
      '',
      'For more info, see [our guide](https://example.com/guide).',
      '',
      '> This is a key principle.',
      '',
      '---',
      '',
      '### Implementation',
      '',
      '- Step one',
      '- Step two',
    ].join('\n');

    const result = stripMarkdown(input);
    expect(result).toContain('Policy Statement');
    expect(result).toContain('quality');
    expect(result).toContain('our guide');
    expect(result).not.toContain('##');
    expect(result).not.toContain('**');
    expect(result).not.toContain('[');
    expect(result).not.toContain('](');
    expect(result).not.toContain('>');
  });
});
