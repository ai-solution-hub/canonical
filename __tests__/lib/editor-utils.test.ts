import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  htmlToPlainText,
  countWords,
  countWordsFromHtml,
  wordCountPercentage,
} from '@/lib/editor-utils';

/**
 * Note: vitest is configured with jsdom environment, so htmlToPlainText
 * uses the DOMParser path (not the server-side regex fallback).
 * DOMParser.textContent strips all tags and decodes entities but does
 * NOT convert <br> or </p> to newlines.
 */

describe('htmlToPlainText', () => {
  it('strips simple HTML tags', () => {
    expect(htmlToPlainText('<p>Hello world</p>')).toBe('Hello world');
  });

  it('handles nested tags', () => {
    const result = htmlToPlainText(
      '<p><strong>Bold</strong> and <em>italic</em></p>',
    );
    expect(result).toContain('Bold');
    expect(result).toContain('and');
    expect(result).toContain('italic');
  });

  it('strips br tags (DOMParser textContent path)', () => {
    // In jsdom, DOMParser.textContent does not convert <br> to newlines
    const result = htmlToPlainText('Line 1<br>Line 2');
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 2');
  });

  it('strips closing p tags (DOMParser textContent path)', () => {
    const result = htmlToPlainText('<p>Para 1</p><p>Para 2</p>');
    expect(result).toContain('Para 1');
    expect(result).toContain('Para 2');
  });

  it('decodes HTML entities', () => {
    expect(htmlToPlainText('&amp; &lt; &gt; &quot; &#39;')).toBe('& < > " \'');
  });

  it('handles &nbsp;', () => {
    // DOMParser decodes &nbsp; to \u00A0 (non-breaking space), not regular space
    const result = htmlToPlainText('Hello&nbsp;world');
    expect(result).toContain('Hello');
    expect(result).toContain('world');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToPlainText('')).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(htmlToPlainText('')).toBe('');
  });

  it('handles list items', () => {
    const result = htmlToPlainText('<ul><li>Item 1</li><li>Item 2</li></ul>');
    expect(result).toContain('Item 1');
    expect(result).toContain('Item 2');
  });

  it('handles deeply nested HTML', () => {
    const html =
      '<div><section><p><span>Deep <strong>nesting</strong></span></p></section></div>';
    const result = htmlToPlainText(html);
    expect(result).toContain('Deep');
    expect(result).toContain('nesting');
  });

  it('handles HTML with only whitespace text', () => {
    // DOMParser preserves whitespace in textContent — downstream consumers trim
    expect(htmlToPlainText('<p>   </p>').trim()).toBe('');
  });
});

describe('htmlToPlainText (server-side regex fallback)', () => {
  // Force the non-window branch so the regex fallback runs (jsdom otherwise
  // takes the DOMParser path). Guards CodeQL alert #8
  // (js/incomplete-multi-character-sanitization).
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function serverHtmlToPlainText(html: string): string {
    vi.stubGlobal('window', undefined);
    return htmlToPlainText(html);
  }

  it('strips tags that would recombine after a single pass', () => {
    // Single-pass /<[^>]*>/g leaves a fresh tag; the loop must fully strip.
    expect(serverHtmlToPlainText('<scr<script>ipt>alert(1)')).not.toContain(
      '<script',
    );
  });

  it('drops an unclosed tag fragment with no closing bracket', () => {
    // "<script src=x" has no ">" so the tag regex cannot match it.
    expect(serverHtmlToPlainText('hello <script src=x')).toBe('hello');
    expect(serverHtmlToPlainText('<img onerror=alert(1)')).toBe('');
  });

  it('converts block tags to newlines and decodes entities', () => {
    expect(serverHtmlToPlainText('<p>a</p><p>b</p>')).toBe('a\nb');
    expect(serverHtmlToPlainText('x &amp; y &lt;ok&gt;')).toBe('x & y <ok>');
  });
});

describe('countWords', () => {
  it('counts simple words', () => {
    expect(countWords('hello world foo')).toBe(3);
  });

  it('handles multiple spaces', () => {
    expect(countWords('hello   world')).toBe(2);
  });

  it('handles tabs and newlines', () => {
    expect(countWords('hello\tworld\nfoo')).toBe(3);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for whitespace only', () => {
    expect(countWords('   \n\t  ')).toBe(0);
  });

  it('counts a single word', () => {
    expect(countWords('hello')).toBe(1);
  });

  it('handles leading and trailing whitespace', () => {
    expect(countWords('  hello world  ')).toBe(2);
  });

  it('handles mixed whitespace types', () => {
    expect(countWords('one\ttwo\nthree  four')).toBe(4);
  });
});

describe('countWordsFromHtml', () => {
  it('counts words from HTML content', () => {
    expect(
      countWordsFromHtml('<p>Hello <strong>beautiful</strong> world</p>'),
    ).toBe(3);
  });

  it('returns 0 for empty HTML', () => {
    expect(countWordsFromHtml('<p></p>')).toBe(0);
  });

  it('counts words from complex HTML', () => {
    const html =
      '<div><h1>Title</h1><p>First paragraph with <em>five</em> words.</p></div>';
    const result = countWordsFromHtml(html);
    expect(result).toBeGreaterThan(0);
  });

  it('returns 0 for empty string', () => {
    expect(countWordsFromHtml('')).toBe(0);
  });
});

describe('wordCountPercentage', () => {
  it('calculates percentage correctly', () => {
    expect(wordCountPercentage(450, 500)).toBe(90);
  });

  it('handles over limit', () => {
    expect(wordCountPercentage(550, 500)).toBe(110);
  });

  it('returns 100 when limit is 0', () => {
    expect(wordCountPercentage(100, 0)).toBe(100);
  });

  it('returns 0 for 0 words', () => {
    expect(wordCountPercentage(0, 500)).toBe(0);
  });

  it('returns 100 for negative limit', () => {
    expect(wordCountPercentage(100, -1)).toBe(100);
  });

  it('rounds to nearest integer', () => {
    // 333 / 1000 = 33.3 -> rounds to 33
    expect(wordCountPercentage(333, 1000)).toBe(33);
  });

  it('handles exact match', () => {
    expect(wordCountPercentage(500, 500)).toBe(100);
  });
});
