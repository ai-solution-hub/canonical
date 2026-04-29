import { describe, it, expect } from 'vitest';
import { cleanMdxTags } from '@/lib/extraction/clean-mdx-tags';

describe('cleanMdxTags', () => {
  it('strips self-closing MDX component tags', () => {
    const input = `# Heading

<Note title="Tip" />

Body content.`;

    const out = cleanMdxTags(input);

    expect(out).not.toContain('<Note');
    expect(out).toContain('# Heading');
    expect(out).toContain('Body content.');
  });

  it('strips paired MDX component tags but keeps inner content text', () => {
    const input = `# Heading

<CodeGroup>

\`\`\`bash
echo hello
\`\`\`

</CodeGroup>

Body.`;

    const out = cleanMdxTags(input);

    expect(out).not.toContain('<CodeGroup>');
    expect(out).not.toContain('</CodeGroup>');
    expect(out).toContain('echo hello');
    expect(out).toContain('Body.');
  });

  it('preserves top-level import and export statements (Python parity)', () => {
    const input = `import Foo from './foo';
export const bar = 1;

# Real title

Body.`;

    const out = cleanMdxTags(input);

    expect(out).toContain("import Foo from './foo';");
    expect(out).toContain('export const bar = 1;');
    expect(out).toContain('# Real title');
    expect(out).toContain('Body.');
  });

  it('preserves standard lowercase HTML tags inside markdown', () => {
    const input = `# Heading

This has a <strong>bold</strong> word and <em>emphasis</em>.

<a href="https://example.com">link</a>

<MdxCard>card</MdxCard>`;

    const out = cleanMdxTags(input);

    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>emphasis</em>');
    expect(out).toContain('<a href="https://example.com">link</a>');
    expect(out).not.toContain('<MdxCard>');
    expect(out).not.toContain('</MdxCard>');
    expect(out).toContain('card');
  });

  it('strips Documentation Index blockquote block but keeps subsequent content', () => {
    const input = `> ## Documentation Index
> - [Item one](./one.md)
> - [Item two](./two.md)

# Real Title

Body.`;

    const out = cleanMdxTags(input);

    expect(out).not.toContain('Documentation Index');
    expect(out).not.toContain('Item one');
    expect(out).toContain('# Real Title');
    expect(out).toContain('Body.');
  });

  it('preserves import/export alongside stripping MDX components in one document', () => {
    const input = `import { Card } from './card';
export const meta = { title: 'x' };

# Title

<Steps>
1. First
2. Second
</Steps>

<Tip />

Final.`;

    const out = cleanMdxTags(input);

    // Python parity — import/export passes through untouched.
    expect(out).toContain("import { Card } from './card';");
    expect(out).toContain("export const meta = { title: 'x' };");
    // PascalCase MDX tags stripped.
    expect(out).not.toContain('<Steps>');
    expect(out).not.toContain('</Steps>');
    expect(out).not.toContain('<Tip');
    expect(out).toContain('1. First');
    expect(out).toContain('2. Second');
    expect(out).toContain('# Title');
    expect(out).toContain('Final.');
  });

  it('collapses runs of 4+ newlines down to 3', () => {
    const input = '# A\n\n\n\n\n\n# B';
    const out = cleanMdxTags(input);
    expect(out).not.toMatch(/\n{4,}/);
  });
});
