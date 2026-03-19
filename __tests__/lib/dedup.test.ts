import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normaliseTextForHash,
  checkForDuplicates,
  formatDedupWarning,
  DEFAULT_NEAR_DUPLICATE_THRESHOLD,
} from '@/lib/dedup';
import type { DedupResult } from '@/lib/dedup';

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------

function createMockChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainMethods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'not', 'is', 'limit',
    'single', 'maybeSingle',
  ];
  for (const m of chainMethods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Terminal method defaults
  chain.then = vi.fn().mockImplementation(
    (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
  );
  return chain;
}

function createMockSupabase() {
  const chain = createMockChain();
  return {
    from: vi.fn().mockReturnValue(chain),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    _chain: chain,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normaliseTextForHash', () => {
  it('lowercases and strips punctuation', () => {
    expect(normaliseTextForHash('Hello, World!')).toBe('hello world');
  });

  it('collapses whitespace', () => {
    expect(normaliseTextForHash('  multiple   spaces   here  ')).toBe('multiple spaces here');
  });

  it('handles empty string', () => {
    expect(normaliseTextForHash('')).toBe('');
  });

  it('preserves alphanumeric characters', () => {
    expect(normaliseTextForHash('ISO 27001 certification')).toBe('iso 27001 certification');
  });

  it('strips special characters', () => {
    expect(normaliseTextForHash("What's your approach?")).toBe('whats your approach');
  });
});

describe('checkForDuplicates', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
  });

  it('returns no duplicates when DB has no matching content', async () => {
    // Mock: from().select()...then() returns empty array
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const result = await checkForDuplicates(
      mockSupabase as unknown as Parameters<typeof checkForDuplicates>[0],
      'Some unique content that does not exist anywhere else.',
    );

    expect(result.has_duplicates).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  it('finds exact duplicates by normalised content hash', async () => {
    const contentText = 'This is some test content for deduplication.';

    // Mock: DB returns an item with identical normalised content
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({
        data: [
          {
            id: 'existing-item-id',
            title: 'Existing Article',
            content: contentText,  // Exact same content
          },
        ],
        error: null,
      }),
    );

    const result = await checkForDuplicates(
      mockSupabase as unknown as Parameters<typeof checkForDuplicates>[0],
      contentText,
    );

    expect(result.has_duplicates).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toEqual({
      id: 'existing-item-id',
      title: 'Existing Article',
      similarity: 1.0,
      match_type: 'exact',
    });
  });

  it('detects exact match even with different punctuation and casing', async () => {
    // Mock: DB returns an item whose normalised form matches
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({
        data: [
          {
            id: 'existing-id',
            title: 'Existing',
            content: 'Hello, World!  How are you?',
          },
        ],
        error: null,
      }),
    );

    const result = await checkForDuplicates(
      mockSupabase as unknown as Parameters<typeof checkForDuplicates>[0],
      'hello world how are you',  // Same after normalisation
    );

    expect(result.has_duplicates).toBe(true);
    expect(result.matches[0].match_type).toBe('exact');
  });

  it('finds near-duplicates using embedding similarity', async () => {
    // Mock: exact check returns nothing
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Mock: RPC returns similar items
    mockSupabase.rpc.mockResolvedValue({
      data: [
        {
          id: 'similar-item-id',
          title: 'Similar Article',
          similarity: 0.95,
          content: 'Similar content',
          content_type: 'article',
          platform: 'web',
          source_domain: 'example.com',
          author_name: 'Test',
        },
      ],
      error: null,
    });

    const fakeEmbedding = new Array(1024).fill(0.1);
    const result = await checkForDuplicates(
      mockSupabase as unknown as Parameters<typeof checkForDuplicates>[0],
      'Some content text',
      fakeEmbedding,
    );

    expect(result.has_duplicates).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toEqual({
      id: 'similar-item-id',
      title: 'Similar Article',
      similarity: 0.95,
      match_type: 'near_duplicate',
    });

    // Verify RPC was called with correct threshold
    expect(mockSupabase.rpc).toHaveBeenCalledWith('find_similar_content', {
      query_embedding: JSON.stringify(fakeEmbedding),
      similarity_threshold: DEFAULT_NEAR_DUPLICATE_THRESHOLD,
      limit_count: 5, // MAX_NEAR_DUPLICATE_RESULTS (no excludeId)
    });
  });

  it('excludes specified item ID from results', async () => {
    // Mock: exact check returns items including the excluded one
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({
        data: [
          { id: 'exclude-me', title: 'Self', content: 'test content' },
          { id: 'other-item', title: 'Other', content: 'test content' },
        ],
        error: null,
      }),
    );

    await checkForDuplicates(
      mockSupabase as unknown as Parameters<typeof checkForDuplicates>[0],
      'test content',
      undefined,
      { excludeId: 'exclude-me' },
    );

    // The chain should have .neq called for excludeId
    expect(mockSupabase._chain.neq).toHaveBeenCalled();
  });

  it('deduplicates exact and near matches for the same item', async () => {
    const contentText = 'Duplicate content here.';

    // Mock: exact check finds one item
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({
        data: [
          { id: 'same-item', title: 'Same Article', content: contentText },
        ],
        error: null,
      }),
    );

    // Mock: near-duplicate also returns the same item
    mockSupabase.rpc.mockResolvedValue({
      data: [
        {
          id: 'same-item',
          title: 'Same Article',
          similarity: 0.99,
          content: contentText,
          content_type: 'article',
          platform: 'web',
          source_domain: '',
          author_name: '',
        },
      ],
      error: null,
    });

    const fakeEmbedding = new Array(1024).fill(0.1);
    const result = await checkForDuplicates(
      mockSupabase as unknown as Parameters<typeof checkForDuplicates>[0],
      contentText,
      fakeEmbedding,
    );

    // Should only appear once (exact match takes precedence)
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].match_type).toBe('exact');
  });

  it('uses custom near-duplicate threshold', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const fakeEmbedding = new Array(1024).fill(0.1);
    await checkForDuplicates(
      mockSupabase as unknown as Parameters<typeof checkForDuplicates>[0],
      'content',
      fakeEmbedding,
      { nearDuplicateThreshold: 0.85 },
    );

    expect(mockSupabase.rpc).toHaveBeenCalledWith('find_similar_content', {
      query_embedding: JSON.stringify(fakeEmbedding),
      similarity_threshold: 0.85,
      limit_count: 5,
    });
  });

  it('handles exact dedup query failure gracefully', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'DB error' } }),
    );

    const result = await checkForDuplicates(
      mockSupabase as unknown as Parameters<typeof checkForDuplicates>[0],
      'Some content',
    );

    // Should not throw, just return empty
    expect(result.has_duplicates).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  it('handles near-duplicate RPC failure gracefully', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'RPC error' } });

    const fakeEmbedding = new Array(1024).fill(0.1);
    const result = await checkForDuplicates(
      mockSupabase as unknown as Parameters<typeof checkForDuplicates>[0],
      'Some content',
      fakeEmbedding,
    );

    // Should not throw
    expect(result.has_duplicates).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  it('skips near-duplicate check when no embedding provided', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    await checkForDuplicates(
      mockSupabase as unknown as Parameters<typeof checkForDuplicates>[0],
      'Some content',
      // No embedding
    );

    // RPC should not have been called
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});

describe('formatDedupWarning', () => {
  it('returns null when no duplicates', () => {
    const result: DedupResult = { has_duplicates: false, matches: [] };
    expect(formatDedupWarning(result)).toBeNull();
  });

  it('formats exact duplicate warning', () => {
    const result: DedupResult = {
      has_duplicates: true,
      matches: [
        { id: '1', title: 'Existing Article', similarity: 1.0, match_type: 'exact' },
      ],
    };
    const warning = formatDedupWarning(result);
    expect(warning).toContain('1 exact duplicate found');
    expect(warning).toContain('Existing Article');
    expect(warning).toContain('100%');
  });

  it('formats near-duplicate warning', () => {
    const result: DedupResult = {
      has_duplicates: true,
      matches: [
        { id: '1', title: 'Similar Article', similarity: 0.95, match_type: 'near_duplicate' },
      ],
    };
    const warning = formatDedupWarning(result);
    expect(warning).toContain('1 near-duplicate found');
    expect(warning).toContain('Similar Article');
    expect(warning).toContain('95%');
  });

  it('formats mixed exact and near-duplicate warnings', () => {
    const result: DedupResult = {
      has_duplicates: true,
      matches: [
        { id: '1', title: 'Exact Match', similarity: 1.0, match_type: 'exact' },
        { id: '2', title: 'Near Match', similarity: 0.93, match_type: 'near_duplicate' },
      ],
    };
    const warning = formatDedupWarning(result);
    expect(warning).toContain('1 exact duplicate found');
    expect(warning).toContain('1 near-duplicate found');
  });

  it('pluralises correctly for multiple matches', () => {
    const result: DedupResult = {
      has_duplicates: true,
      matches: [
        { id: '1', title: 'Near A', similarity: 0.95, match_type: 'near_duplicate' },
        { id: '2', title: 'Near B', similarity: 0.93, match_type: 'near_duplicate' },
      ],
    };
    const warning = formatDedupWarning(result);
    expect(warning).toContain('2 near-duplicates found');
  });

  it('limits displayed titles to 3', () => {
    const result: DedupResult = {
      has_duplicates: true,
      matches: [
        { id: '1', title: 'Article A', similarity: 0.98, match_type: 'near_duplicate' },
        { id: '2', title: 'Article B', similarity: 0.96, match_type: 'near_duplicate' },
        { id: '3', title: 'Article C', similarity: 0.94, match_type: 'near_duplicate' },
        { id: '4', title: 'Article D', similarity: 0.92, match_type: 'near_duplicate' },
      ],
    };
    const warning = formatDedupWarning(result)!;
    expect(warning).toContain('Article A');
    expect(warning).toContain('Article B');
    expect(warning).toContain('Article C');
    expect(warning).not.toContain('Article D');
  });
});
