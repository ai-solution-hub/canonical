import { describe, it, expect } from 'vitest';
import { parseMarkdownFrontMatter } from '@/lib/extraction/markdown-front-matter';

describe('parseMarkdownFrontMatter', () => {
  it('parses well-formed YAML front-matter between --- markers', () => {
    const input = `---
title: Hello World
author: Alice
tags:
  - foo
  - bar
---
# Body content

This is the body.`;

    const { frontMatter, body, error } = parseMarkdownFrontMatter(input);

    expect(frontMatter).toEqual({
      title: 'Hello World',
      author: 'Alice',
      tags: ['foo', 'bar'],
    });
    expect(body).toBe('# Body content\n\nThis is the body.');
    expect(error).toBeUndefined();
  });

  it('parses TOML front-matter between +++ markers', () => {
    const input = `+++
title = "Hello TOML"
author = "Bob"
+++
# Body

Toml body content here.`;

    const { frontMatter, body, error } = parseMarkdownFrontMatter(input);

    expect(frontMatter).toEqual({
      title: 'Hello TOML',
      author: 'Bob',
    });
    expect(body).toBe('# Body\n\nToml body content here.');
    expect(error).toBeUndefined();
  });

  it('returns null front-matter and full input as body when no FM block', () => {
    const input = `# No front-matter here

Just a regular markdown file.`;

    const { frontMatter, body, error } = parseMarkdownFrontMatter(input);

    expect(frontMatter).toBeNull();
    expect(body).toBe(input);
    expect(error).toBeUndefined();
  });

  it('returns null front-matter + error string for malformed YAML, body still extracted', () => {
    const input = `---
title: Hello
not-valid: yaml: : :
   bad indentation
---
# Body content

Body still extracted.`;

    expect(() => parseMarkdownFrontMatter(input)).not.toThrow();
    const { frontMatter, body, error } = parseMarkdownFrontMatter(input);

    expect(frontMatter).toBeNull();
    expect(error).toBeDefined();
    expect(body).toBe('# Body content\n\nBody still extracted.');
  });

  it('returns null front-matter + error string for malformed TOML', () => {
    const input = `+++
this line is not key = value
+++
# Body

content`;

    const { frontMatter, body, error } = parseMarkdownFrontMatter(input);

    expect(frontMatter).toBeNull();
    expect(error).toBeDefined();
    expect(body).toBe('# Body\n\ncontent');
  });

  it('tolerates UTF-8 BOM at the start of the file', () => {
    const input = `﻿---
title: With BOM
---
# Body`;

    const { frontMatter, body } = parseMarkdownFrontMatter(input);

    expect(frontMatter).toEqual({ title: 'With BOM' });
    expect(body).toBe('# Body');
  });

  it('handles unclosed front-matter by treating entire input as body (null FM)', () => {
    const input = `---
title: Never closed

# This looks like body but FM never closed`;

    const { frontMatter, body, error } = parseMarkdownFrontMatter(input);

    expect(frontMatter).toBeNull();
    expect(body).toBe(input);
    expect(error).toBeUndefined();
  });

  it('parses simple key: value with quoted strings and numbers', () => {
    const input = `---
title: "Quoted: Value"
count: 42
draft: false
---
Body.`;

    const { frontMatter, body } = parseMarkdownFrontMatter(input);

    expect(frontMatter).toEqual({
      title: 'Quoted: Value',
      count: 42,
      draft: false,
    });
    expect(body).toBe('Body.');
  });
});
