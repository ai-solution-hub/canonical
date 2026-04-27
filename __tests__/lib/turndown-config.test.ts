import { describe, it, expect } from 'vitest';
import { turndown } from '@/lib/extraction/turndown';

describe('Turndown configuration', () => {
  it('converts headings to ATX style', () => {
    expect(turndown.turndown('<h2>Title</h2>')).toBe('## Title');
    expect(turndown.turndown('<h3>Sub</h3>')).toBe('### Sub');
  });

  it('converts paragraphs', () => {
    expect(turndown.turndown('<p>Hello world</p>')).toBe('Hello world');
  });

  it('converts unordered lists with dash markers', () => {
    const html = '<ul><li>Item 1</li><li>Item 2</li></ul>';
    const result = turndown.turndown(html);
    expect(result).toContain('-   Item 1');
    expect(result).toContain('-   Item 2');
  });

  it('converts bold and italic', () => {
    expect(turndown.turndown('<strong>bold</strong>')).toBe('**bold**');
    expect(turndown.turndown('<em>italic</em>')).toBe('*italic*');
  });

  it('converts links', () => {
    expect(turndown.turndown('<a href="http://example.com">text</a>')).toBe(
      '[text](http://example.com)',
    );
  });

  it('removes empty links', () => {
    expect(turndown.turndown('<a href="http://example.com"></a>')).toBe('');
  });

  it('removes script tags', () => {
    expect(turndown.turndown('<p>Hello</p><script>alert("xss")</script>')).toBe(
      'Hello',
    );
  });

  it('removes style tags', () => {
    expect(
      turndown.turndown('<style>.foo { color: red }</style><p>Content</p>'),
    ).toBe('Content');
  });

  it('removes noscript tags', () => {
    expect(turndown.turndown('<noscript>No JS</noscript><p>Content</p>')).toBe(
      'Content',
    );
  });

  it('converts horizontal rules', () => {
    expect(turndown.turndown('<hr>')).toBe('---');
  });

  it('converts fenced code blocks', () => {
    const result = turndown.turndown('<pre><code>const x = 1;</code></pre>');
    expect(result).toContain('```');
    expect(result).toContain('const x = 1;');
  });

  it('converts tables via GFM plugin', () => {
    const html =
      '<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>A</td><td>1</td></tr></tbody></table>';
    const result = turndown.turndown(html);
    expect(result).toContain('| Name | Value |');
    expect(result).toContain('| A | 1 |');
    expect(result).toContain('---');
  });
});
