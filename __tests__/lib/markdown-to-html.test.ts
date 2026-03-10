import { describe, it, expect } from 'vitest';
import { responseToHtml } from '@/lib/markdown-to-html';

describe('responseToHtml', () => {
  it('returns empty paragraph for null/undefined/empty', () => {
    expect(responseToHtml(null)).toBe('<p></p>');
    expect(responseToHtml(undefined)).toBe('<p></p>');
    expect(responseToHtml('')).toBe('<p></p>');
    expect(responseToHtml('   ')).toBe('<p></p>');
  });

  it('passes through HTML content unchanged', () => {
    const html = '<p>Already <strong>formatted</strong></p>';
    expect(responseToHtml(html)).toBe(html);
  });

  it('passes through TipTap-style HTML unchanged', () => {
    const html = '<h2>Section</h2><p>Content with <em>emphasis</em></p><ul><li>Item</li></ul>';
    expect(responseToHtml(html)).toBe(html);
  });

  it('converts Markdown headings to HTML', () => {
    const result = responseToHtml('## Our Approach');
    expect(result).toContain('<h2>');
    expect(result).toContain('Our Approach');
  });

  it('converts Markdown bold and italic to HTML', () => {
    const result = responseToHtml('**bold** and *italic* text');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
  });

  it('converts Markdown lists to HTML', () => {
    const result = responseToHtml('- Item 1\n- Item 2\n- Item 3');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>Item 1</li>');
    expect(result).toContain('<li>Item 3</li>');
  });

  it('converts Markdown numbered lists to HTML', () => {
    const result = responseToHtml('1. First\n2. Second\n3. Third');
    expect(result).toContain('<ol>');
    expect(result).toContain('<li>First</li>');
  });

  it('converts multi-section Markdown response', () => {
    const markdown = `## Health and Safety Policy

Our organisation maintains a comprehensive Health and Safety policy that covers:

- Risk assessments for all projects
- Regular safety training for staff
- Incident reporting procedures

### Key Achievements

We have achieved **zero reportable incidents** in the last 12 months.`;

    const result = responseToHtml(markdown);
    expect(result).toContain('<h2>');
    expect(result).toContain('<h3>');
    expect(result).toContain('<ul>');
    expect(result).toContain('<strong>zero reportable incidents</strong>');
    expect(result).toContain('<li>Risk assessments');
  });

  it('handles plain text without Markdown syntax', () => {
    const plain = 'Just a plain sentence with no formatting.';
    const result = responseToHtml(plain);
    expect(result).toContain('<p>');
    expect(result).toContain('Just a plain sentence');
  });
});
