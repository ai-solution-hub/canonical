import { describe, it, expect } from 'vitest';
import {
  chunkByHeadings,
  MIN_CHUNK_CHARS,
  MIN_DOCUMENT_CHARS,
} from '@/lib/content/chunking';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produce a filler paragraph of at least `chars` characters. Uses real words
 * so `word_count` assertions remain meaningful.
 */
function filler(chars: number): string {
  const word = 'lorem ipsum dolor sit amet consectetur adipiscing elit ';
  let out = '';
  while (out.length < chars) out += word;
  return out.slice(0, chars).trim();
}

// ---------------------------------------------------------------------------
// Basic cases
// ---------------------------------------------------------------------------

describe('chunkByHeadings — basic cases', () => {
  it('returns empty array for empty string', () => {
    expect(chunkByHeadings('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(chunkByHeadings('   \n\n\t  \n')).toEqual([]);
  });

  it('short document (<500 chars) becomes a single chunk without splitting', () => {
    const md = '## Heading\n\nSome body text.\n\n## Another\n\nMore text.';
    expect(md.length).toBeLessThan(MIN_DOCUMENT_CHARS);
    const chunks = chunkByHeadings(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading_text).toBeNull();
    expect(chunks[0].heading_level).toBeNull();
    expect(chunks[0].heading_path).toEqual([]);
    expect(chunks[0].position).toBe(0);
    expect(chunks[0].parent_position).toBeNull();
  });

  it('long document with no headings becomes a single chunk', () => {
    const md = filler(MIN_DOCUMENT_CHARS + 200);
    const chunks = chunkByHeadings(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading_text).toBeNull();
    expect(chunks[0].heading_level).toBeNull();
    expect(chunks[0].heading_path).toEqual([]);
  });

  it('only H3+ headings in a long document => single chunk (no split level)', () => {
    const body1 = filler(250);
    const body2 = filler(250);
    const md = `### First\n\n${body1}\n\n### Second\n\n${body2}`;
    expect(md.length).toBeGreaterThan(MIN_DOCUMENT_CHARS);
    const chunks = chunkByHeadings(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading_text).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Splitting behaviour
// ---------------------------------------------------------------------------

describe('chunkByHeadings — heading splitting', () => {
  it('splits at H2 by default, including preamble before first H2', () => {
    const preamble = filler(200);
    const section1 = filler(200);
    const section2 = filler(200);
    const md = `${preamble}\n\n## Alpha\n\n${section1}\n\n## Beta\n\n${section2}`;
    const chunks = chunkByHeadings(md);

    // Preamble + Alpha + Beta = 3 chunks
    expect(chunks).toHaveLength(3);

    // Preamble chunk
    expect(chunks[0].heading_text).toBeNull();
    expect(chunks[0].heading_level).toBeNull();
    expect(chunks[0].heading_path).toEqual([]);
    expect(chunks[0].content).toContain(preamble.slice(0, 50));

    // Alpha
    expect(chunks[1].heading_text).toBe('Alpha');
    expect(chunks[1].heading_level).toBe(2);
    expect(chunks[1].heading_path).toEqual(['Alpha']);
    expect(chunks[1].content.startsWith('## Alpha')).toBe(true);

    // Beta
    expect(chunks[2].heading_text).toBe('Beta');
    expect(chunks[2].heading_level).toBe(2);
    expect(chunks[2].heading_path).toEqual(['Beta']);
    expect(chunks[2].content.startsWith('## Beta')).toBe(true);
  });

  it('falls back to H1 when no H2 exists', () => {
    const a = filler(250);
    const b = filler(250);
    const md = `# Alpha\n\n${a}\n\n# Beta\n\n${b}`;
    const chunks = chunkByHeadings(md);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].heading_text).toBe('Alpha');
    expect(chunks[0].heading_level).toBe(1);
    expect(chunks[1].heading_text).toBe('Beta');
    expect(chunks[1].heading_level).toBe(1);
  });

  it('H3 inside H2 stays within the H2 chunk (no split at H3)', () => {
    const lead = filler(150);
    const h3Body = filler(200);
    const md =
      `## Outer\n\n${lead}\n\n### Nested\n\n${h3Body}\n\n` +
      `## Next\n\n${filler(200)}`;
    const chunks = chunkByHeadings(md);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].heading_text).toBe('Outer');
    // The H3 heading and its body must live inside the Outer chunk
    expect(chunks[0].content).toContain('### Nested');
    expect(chunks[0].content).toContain(h3Body.slice(0, 50));
    expect(chunks[1].heading_text).toBe('Next');
  });

  it('heading_path breadcrumbs reflect nested structure', () => {
    // With an H1 + H2 document, H1 is a separator AND appears in breadcrumbs
    // for nested H2 sections.
    const md =
      `# Root\n\n${filler(200)}\n\n` +
      `## Child One\n\n${filler(200)}\n\n` +
      `## Child Two\n\n${filler(200)}`;
    const chunks = chunkByHeadings(md);

    // Split level is H2 (since H2 exists). H1 "Root" acts as parent context.
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    const root = chunks.find((c) => c.heading_text === 'Root');
    const child1 = chunks.find((c) => c.heading_text === 'Child One');
    const child2 = chunks.find((c) => c.heading_text === 'Child Two');

    expect(root).toBeDefined();
    expect(root!.heading_path).toEqual(['Root']);
    expect(child1).toBeDefined();
    expect(child1!.heading_path).toEqual(['Root', 'Child One']);
    expect(child2).toBeDefined();
    expect(child2!.heading_path).toEqual(['Root', 'Child Two']);
  });
});

// ---------------------------------------------------------------------------
// Merging small chunks
// ---------------------------------------------------------------------------

describe('chunkByHeadings — small chunk merging', () => {
  it('merges a small chunk with the next sibling', () => {
    // preamble (big) + Small (tiny, under MIN_CHUNK_CHARS) + Big (normal).
    // Small is pending on its own pass; Big absorbs it, and per the algorithm
    // the merged chunk retains the *pending* (Small) heading/path, while its
    // body contains both sections. The standalone Small chunk therefore
    // disappears from the final output: exactly one section carries the
    // combined text, but only two chunks are emitted in total.
    const small = 'tiny'; // ~22 chars with heading
    const big = filler(400);
    const preamble = filler(300);
    const md = `${preamble}\n\n## Small\n\n${small}\n\n## Big\n\n${big}`;
    const chunks = chunkByHeadings(md);

    // preamble + merged(Small+Big) = 2 chunks
    expect(chunks).toHaveLength(2);

    // The merged chunk keeps Small's identity (pending-first) but contains
    // both Small and Big section bodies.
    const second = chunks[1];
    expect(second.heading_text).toBe('Small');
    expect(second.heading_level).toBe(2);
    expect(second.heading_path).toEqual(['Small']);
    expect(second.content).toContain('## Small');
    expect(second.content).toContain('## Big');
    expect(second.content).toContain(big.slice(0, 50));
    expect(second.char_count).toBe(second.content.length);
  });

  it('merges a final small chunk with the previous chunk', () => {
    // Ensure the document crosses MIN_DOCUMENT_CHARS so the chunker actually
    // runs the splitting path; otherwise a short doc collapses to one chunk
    // regardless of small/big ordering.
    const big = filler(600);
    const small = 'end.'; // very short trailing section
    const md = `## Big\n\n${big}\n\n## Small\n\n${small}`;
    expect(md.length).toBeGreaterThan(MIN_DOCUMENT_CHARS);

    const chunks = chunkByHeadings(md);

    // Big stays; Small is too small to stand alone AND there is no next
    // sibling to merge into, so it falls back to being appended onto Big.
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading_text).toBe('Big');
    expect(chunks[0].content).toContain('## Small');
    expect(chunks[0].content).toContain(small);
  });

  it('MIN_CHUNK_CHARS threshold is 100 and MIN_DOCUMENT_CHARS is 500', () => {
    // Guard against accidental changes to the tuning constants.
    expect(MIN_CHUNK_CHARS).toBe(100);
    expect(MIN_DOCUMENT_CHARS).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Code-block safety
// ---------------------------------------------------------------------------

describe('chunkByHeadings — code block safety', () => {
  it('treats a `#` line inside a fenced code block as code, not a heading', () => {
    // Bodies large enough to cross MIN_DOCUMENT_CHARS and above MIN_CHUNK_CHARS
    // so neither section is collapsed or merged away by size rules.
    const body1 = filler(300);
    const body2 = filler(300);
    const md = [
      `## Real`,
      ``,
      body1,
      ``,
      '```python',
      `# Not a heading`,
      `print('hello')`,
      '```',
      ``,
      `## Another`,
      ``,
      body2,
    ].join('\n');

    const chunks = chunkByHeadings(md);

    // Two H2 sections only. If the `# Not a heading` line were picked up as
    // a heading we would see a third chunk.
    expect(chunks).toHaveLength(2);
    expect(chunks[0].heading_text).toBe('Real');
    expect(chunks[1].heading_text).toBe('Another');
    // The code block must live inside the first chunk intact.
    expect(chunks[0].content).toContain('# Not a heading');
    expect(chunks[0].content).toContain("print('hello')");
  });
});

// ---------------------------------------------------------------------------
// Counts and metadata
// ---------------------------------------------------------------------------

describe('chunkByHeadings — counts and metadata', () => {
  it('word_count matches whitespace-split word tokens', () => {
    const md = `${filler(200)}\n\n## Alpha\n\nOne two three four five.\n\n${filler(
      300,
    )}`;
    const chunks = chunkByHeadings(md);
    for (const chunk of chunks) {
      const manual = chunk.content.split(/\s+/).filter(Boolean).length;
      expect(chunk.word_count).toBe(manual);
    }
  });

  it('char_count matches content.length', () => {
    const md = `${filler(200)}\n\n## Alpha\n\n${filler(
      200,
    )}\n\n## Beta\n\n${filler(200)}`;
    const chunks = chunkByHeadings(md);
    for (const chunk of chunks) {
      expect(chunk.char_count).toBe(chunk.content.length);
    }
  });

  it('preamble before the first heading has heading_text: null', () => {
    const preamble = filler(200);
    const md = `${preamble}\n\n## First\n\n${filler(250)}`;
    const chunks = chunkByHeadings(md);

    expect(chunks[0].heading_text).toBeNull();
    expect(chunks[0].heading_level).toBeNull();
    expect(chunks[0].heading_path).toEqual([]);
    expect(chunks[0].parent_position).toBeNull();
    expect(chunks[0].position).toBe(0);
  });

  it('position is a contiguous 0-based ordinal across returned chunks', () => {
    const md = [
      filler(200),
      `## A\n\n${filler(200)}`,
      `## B\n\n${filler(200)}`,
      `## C\n\n${filler(200)}`,
    ].join('\n\n');
    const chunks = chunkByHeadings(md);
    chunks.forEach((c, idx) => {
      expect(c.position).toBe(idx);
    });
  });
});
