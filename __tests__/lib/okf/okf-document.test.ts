import { describe, it, expect } from 'vitest';
import { parseOkfDocument, OkfDocumentError } from '@/lib/okf/okf-document';

describe('parseOkfDocument', () => {
  it('splits YAML frontmatter from the markdown body', () => {
    const text = [
      '---',
      'type: BigQuery Table',
      'title: Orders',
      'description: One row per order.',
      '---',
      '',
      'Orders table body.',
    ].join('\n');

    const doc = parseOkfDocument(text);

    expect(doc.frontmatter).toEqual({
      type: 'BigQuery Table',
      title: 'Orders',
      description: 'One row per order.',
    });
    expect(doc.body).toBe('Orders table body.');
  });

  it('treats content with no leading frontmatter delimiter as body-only', () => {
    const text = 'Just a plain markdown document.\n\nNo frontmatter here.';

    const doc = parseOkfDocument(text);

    expect(doc.frontmatter).toEqual({});
    expect(doc.body).toBe(text);
  });

  it('throws OkfDocumentError when the frontmatter block is unterminated', () => {
    const text =
      '---\ntype: Reference\ntitle: Orphaned\n\nBody without a closing delimiter.';

    expect(() => parseOkfDocument(text)).toThrow(OkfDocumentError);
  });

  it('throws OkfDocumentError when frontmatter is not a YAML mapping', () => {
    const text = '---\n- one\n- two\n---\n\nBody.';

    expect(() => parseOkfDocument(text)).toThrow(OkfDocumentError);
  });

  it('throws OkfDocumentError on malformed YAML', () => {
    const text = '---\ntitle: "unterminated\n---\n\nBody.';

    expect(() => parseOkfDocument(text)).toThrow(OkfDocumentError);
  });

  it('handles an empty frontmatter block as an empty mapping', () => {
    const text = '---\n---\n\nBody only.';

    const doc = parseOkfDocument(text);

    expect(doc.frontmatter).toEqual({});
    expect(doc.body).toBe('Body only.');
  });

  it('does not strip more than one leading blank line from the body', () => {
    const text = '---\ntype: Reference\n---\n\n\nTwo blank lines above this.';

    const doc = parseOkfDocument(text);

    expect(doc.body).toBe('\nTwo blank lines above this.');
  });
});
