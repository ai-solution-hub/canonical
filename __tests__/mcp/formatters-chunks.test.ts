import { describe, it, expect } from 'vitest';
import {
  formatChunkSearchResults,
  formatContentItemChunks,
  type ChunkSearchResult,
  type ContentItemChunk,
} from '@/lib/mcp/formatters';

// ──────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────

function makeChunkResult(
  overrides: Partial<ChunkSearchResult> = {},
): ChunkSearchResult {
  return {
    chunk_id: 'chunk-001',
    content_item_id: 'item-001',
    item_title: 'Health & Safety Policy',
    item_suggested_title: null,
    item_content_type: 'policy',
    item_primary_domain: 'Compliance & Governance',
    item_primary_subtopic: 'Workplace Safety',
    heading_text: 'Risk Assessment',
    heading_level: 2,
    heading_path: ['Health & Safety Policy', 'Risk Assessment'],
    content:
      'This section describes how the organisation identifies, evaluates and mitigates workplace risks.',
    position: 1,
    char_count: 98,
    word_count: 15,
    similarity: 0.82,
    ...overrides,
  };
}

function makeItemChunk(overrides: Partial<ContentItemChunk> = {}): ContentItemChunk {
  return {
    id: 'chunk-001',
    heading_text: 'Overview',
    heading_level: 2,
    heading_path: ['Overview'],
    position: 1,
    char_count: 100,
    word_count: 15,
    ...overrides,
  };
}

// ──────────────────────────────────────────
// formatChunkSearchResults
// ──────────────────────────────────────────

describe('formatChunkSearchResults', () => {
  it('returns empty-state message when there are no results', () => {
    const result = formatChunkSearchResults('risk assessment', []);

    expect(result).toContain('# Chunk Search Results for "risk assessment"');
    expect(result).toContain('No matching sections found');
  });

  it('formats a single result with heading_text, item title, similarity, ids and word_count', () => {
    const chunk = makeChunkResult({
      heading_text: 'Risk Assessment',
      item_title: 'Health & Safety Policy',
      item_suggested_title: null,
      similarity: 0.825,
      word_count: 15,
      chunk_id: 'chunk-001',
      content_item_id: 'item-001',
    });
    const result = formatChunkSearchResults('risk', [chunk]);

    expect(result).toContain('## 1. Risk Assessment');
    expect(result).toContain('**Document:** Health & Safety Policy');
    expect(result).toContain('**Relevance:** 83%');
    expect(result).toContain('**Size:** 15 words');
    expect(result).toContain('**Chunk ID:** chunk-001');
    expect(result).toContain('**Item ID:** item-001');
  });

  it('prefers item_suggested_title over item_title when present', () => {
    const chunk = makeChunkResult({
      item_title: 'raw-title',
      item_suggested_title: 'Suggested Title',
    });
    const result = formatChunkSearchResults('q', [chunk]);

    expect(result).toContain('**Document:** Suggested Title');
  });

  it('joins heading_path with " > "', () => {
    const chunk = makeChunkResult({
      heading_path: ['Section 1', 'Subsection A', 'Detail'],
    });
    const result = formatChunkSearchResults('q', [chunk]);

    expect(result).toContain('**Path:** Section 1 > Subsection A > Detail');
  });

  it('renders "(preamble)" as section title when heading_text is null', () => {
    const chunk = makeChunkResult({ heading_text: null });
    const result = formatChunkSearchResults('q', [chunk]);

    expect(result).toContain('## 1. (preamble)');
  });

  it('renders "(document root)" when heading_path is null', () => {
    const chunk = makeChunkResult({ heading_path: null });
    const result = formatChunkSearchResults('q', [chunk]);

    expect(result).toContain('**Path:** (document root)');
  });

  it('renders "(document root)" when heading_path is an empty array', () => {
    const chunk = makeChunkResult({ heading_path: [] });
    const result = formatChunkSearchResults('q', [chunk]);

    expect(result).toContain('**Path:** (document root)');
  });

  it('truncates long content preserving the first 500 chars (approx, allowing ellipsis)', () => {
    const longContent = 'x'.repeat(1200);
    const chunk = makeChunkResult({ content: longContent });
    const result = formatChunkSearchResults('q', [chunk]);

    // The truncate helper emits (maxLength - 3) chars + '...' for long text,
    // so a 500-char limit yields 497 x's followed by '...'.
    expect(result).toContain('x'.repeat(497) + '...');
    // Full 1200-char payload should not appear verbatim
    expect(result).not.toContain('x'.repeat(1200));
  });

  it('includes plural "sections" heading when multiple results returned', () => {
    const chunks = [
      makeChunkResult({ chunk_id: 'c1' }),
      makeChunkResult({ chunk_id: 'c2' }),
    ];
    const result = formatChunkSearchResults('q', chunks);

    expect(result).toContain('Found 2 matching sections');
  });

  it('uses singular "section" when exactly one result returned', () => {
    const result = formatChunkSearchResults('q', [makeChunkResult()]);

    expect(result).toContain('Found 1 matching section:');
    expect(result).not.toContain('matching sections');
  });

  it('omits the Domain line when item_primary_domain is null', () => {
    const chunk = makeChunkResult({
      item_primary_domain: null,
      item_primary_subtopic: null,
    });
    const result = formatChunkSearchResults('q', [chunk]);

    expect(result).not.toContain('**Domain:**');
  });

  it('includes domain > subtopic when both present', () => {
    const chunk = makeChunkResult({
      item_primary_domain: 'Security',
      item_primary_subtopic: 'Access Control',
    });
    const result = formatChunkSearchResults('q', [chunk]);

    expect(result).toContain('**Domain:** Security > Access Control');
  });
});

// ──────────────────────────────────────────
// formatContentItemChunks
// ──────────────────────────────────────────

describe('formatContentItemChunks', () => {
  it('returns an empty string when the chunks array is empty', () => {
    expect(formatContentItemChunks([])).toBe('');
  });

  it('renders the "## Document Sections" header and each chunk title', () => {
    const chunks: ContentItemChunk[] = [
      makeItemChunk({ id: 'c-1', heading_text: 'Introduction', heading_level: 2 }),
      makeItemChunk({ id: 'c-2', heading_text: 'Scope', heading_level: 2 }),
    ];
    const result = formatContentItemChunks(chunks);

    expect(result).toContain('## Document Sections');
    expect(result).toContain('Introduction');
    expect(result).toContain('Scope');
  });

  it('includes word count and chunk id for each chunk', () => {
    const chunks: ContentItemChunk[] = [
      makeItemChunk({ id: 'c-99', heading_text: 'Overview', word_count: 42 }),
    ];
    const result = formatContentItemChunks(chunks);

    expect(result).toContain('**Overview** (42 words)');
    expect(result).toContain('[chunk:c-99]');
  });

  it('indents H2 with 2 spaces and H3 with 4 spaces', () => {
    const chunks: ContentItemChunk[] = [
      makeItemChunk({ id: 'c-h2', heading_text: 'H2 Section', heading_level: 2 }),
      makeItemChunk({ id: 'c-h3', heading_text: 'H3 Section', heading_level: 3 }),
    ];
    const result = formatContentItemChunks(chunks);

    // H2 (level 2) = 2-space indent via `'  '.repeat(1)`
    expect(result).toContain('  - **H2 Section**');
    // H3 (level 3) = 4-space indent via `'  '.repeat(2)`
    expect(result).toContain('    - **H3 Section**');
  });

  it('renders preamble chunk (null heading_text, null heading_level) with "(preamble)" label and no indent', () => {
    const chunks: ContentItemChunk[] = [
      makeItemChunk({
        id: 'c-pre',
        heading_text: null,
        heading_level: null,
        heading_path: [],
      }),
    ];
    const result = formatContentItemChunks(chunks);

    // No leading indent — line starts with "- "
    expect(result).toContain('\n- **(preamble)**');
    expect(result).toContain('[chunk:c-pre]');
  });

  it('orders chunks in the array order provided by caller', () => {
    const chunks: ContentItemChunk[] = [
      makeItemChunk({ id: 'c-a', heading_text: 'Alpha' }),
      makeItemChunk({ id: 'c-b', heading_text: 'Beta' }),
      makeItemChunk({ id: 'c-c', heading_text: 'Gamma' }),
    ];
    const result = formatContentItemChunks(chunks);
    const alphaIdx = result.indexOf('Alpha');
    const betaIdx = result.indexOf('Beta');
    const gammaIdx = result.indexOf('Gamma');

    expect(alphaIdx).toBeGreaterThan(-1);
    expect(betaIdx).toBeGreaterThan(alphaIdx);
    expect(gammaIdx).toBeGreaterThan(betaIdx);
  });
});
