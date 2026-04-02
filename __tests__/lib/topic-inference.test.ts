import { describe, it, expect, beforeEach } from 'vitest';
import { suggestTopic, generateTopicId } from '@/lib/topic-inference';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SuggestTopicParams = Parameters<typeof suggestTopic>[1];

function baseParams(
  overrides: Partial<SuggestTopicParams> = {},
): SuggestTopicParams {
  return {
    primaryDomain: 'Compliance',
    primarySubtopic: 'Certification',
    title: 'ISO 27001 Overview',
    suggestedLayer: 'bid_detail',
    ...overrides,
  };
}

/** Convenience: typed cast of mock client for suggestTopic */
function asSupabase(mock: MockSupabaseClient) {
  return mock as unknown as Parameters<typeof suggestTopic>[0];
}

// ---------------------------------------------------------------------------
// generateTopicId — slug format
// ---------------------------------------------------------------------------

describe('generateTopicId', () => {
  it('lowercases and hyphenates domain + subtopic', () => {
    expect(generateTopicId('Compliance', 'Certification')).toBe(
      'compliance-certification',
    );
  });

  it('replaces non-alphanumeric characters with hyphens', () => {
    expect(generateTopicId('Data & Analytics', 'AI/ML Tools')).toBe(
      'data-analytics-ai-ml-tools',
    );
  });

  it('strips leading and trailing hyphens', () => {
    expect(generateTopicId('--domain--', '--subtopic--')).toBe(
      'domain-subtopic',
    );
  });

  it('handles already-lowercase slugs', () => {
    expect(generateTopicId('scp', 'market-overview')).toBe(
      'scp-market-overview',
    );
  });

  it('collapses multiple consecutive separators', () => {
    expect(generateTopicId('Company   Info', 'Data   Handling')).toBe(
      'company-info-data-handling',
    );
  });

  it('handles empty domain gracefully', () => {
    expect(generateTopicId('', 'subtopic')).toBe('subtopic');
  });

  it('handles empty subtopic gracefully', () => {
    expect(generateTopicId('domain', '')).toBe('domain');
  });
});

// ---------------------------------------------------------------------------
// suggestTopic — Pass 1: Existing topic groups
// ---------------------------------------------------------------------------

describe('suggestTopic — Pass 1: Existing topic groups', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('finds existing topic group with matching domain/subtopic where suggested layer is missing', async () => {
    // Configure chain to return items with topic_id set
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            id: 'item-1',
            title: 'ISO Certification Guide',
            layer: 'sales_brief',
            metadata: {
              topic_id: 'compliance-certification',
            },
          },
          {
            id: 'item-2',
            title: 'Certification Policy',
            layer: 'company_reference',
            metadata: {
              topic_id: 'compliance-certification',
            },
          },
        ],
        error: null,
      }),
    );

    const result = await suggestTopic(asSupabase(mockClient), baseParams());

    expect(result).not.toBeNull();
    expect(result!.topicId).toBe('compliance-certification');
    expect(result!.existingLayers).toHaveLength(2);
    expect(result!.existingLayers[0].layer).toBe('sales_brief');
    expect(result!.existingLayers[1].layer).toBe('company_reference');
    // bid_detail is the suggested layer and is missing — should be in missingLayers
    expect(result!.missingLayers).toContain('bid_detail');
    expect(result!.missingLayers).toContain('research');
    expect(result!.reason).toContain('missing bid_detail');
  });

  it('finds group but suggested layer already exists — still suggests if gaps remain', async () => {
    // The group has sales_brief and bid_detail, suggested is bid_detail (already present)
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            id: 'item-1',
            title: 'Brief Version',
            layer: 'sales_brief',
            metadata: {
              topic_id: 'compliance-certification',
            },
          },
          {
            id: 'item-2',
            title: 'Detail Version',
            layer: 'bid_detail',
            metadata: {
              topic_id: 'compliance-certification',
            },
          },
        ],
        error: null,
      }),
    );

    const result = await suggestTopic(asSupabase(mockClient), baseParams());

    // Should still suggest since there are missing layers (company_reference, research)
    expect(result).not.toBeNull();
    expect(result!.topicId).toBe('compliance-certification');
    expect(result!.missingLayers).toContain('company_reference');
    expect(result!.missingLayers).toContain('research');
    // Reason should indicate it covers domain/subtopic (not specifically missing)
    expect(result!.reason).toContain('compliance-certification');
  });

  it('returns null when all layers are already present in the group', async () => {
    // All four layers present — no gap to fill
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            id: 'item-1',
            title: 'Brief',
            layer: 'sales_brief',
            metadata: {
              topic_id: 'compliance-certification',
            },
          },
          {
            id: 'item-2',
            title: 'Detail',
            layer: 'bid_detail',
            metadata: {
              topic_id: 'compliance-certification',
            },
          },
          {
            id: 'item-3',
            title: 'Reference',
            layer: 'company_reference',
            metadata: {
              topic_id: 'compliance-certification',
            },
          },
          {
            id: 'item-4',
            title: 'Research',
            layer: 'research',
            metadata: {
              topic_id: 'compliance-certification',
            },
          },
        ],
        error: null,
      }),
    );

    const result = await suggestTopic(asSupabase(mockClient), baseParams());

    // All layers present — no suggestion needed
    expect(result).toBeNull();
  });

  it('selects the group where suggested layer is missing over group where it exists', async () => {
    // Two groups: group-a has bid_detail, group-b does not
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            id: 'item-a1',
            title: 'Group A Brief',
            layer: 'sales_brief',
            metadata: { topic_id: 'group-a', layer: 'sales_brief' },
          },
          {
            id: 'item-a2',
            title: 'Group A Detail',
            layer: 'bid_detail',
            metadata: { topic_id: 'group-a', layer: 'bid_detail' },
          },
          {
            id: 'item-b1',
            title: 'Group B Brief',
            layer: 'sales_brief',
            metadata: { topic_id: 'group-b', layer: 'sales_brief' },
          },
        ],
        error: null,
      }),
    );

    const result = await suggestTopic(asSupabase(mockClient), baseParams());

    // group-b is preferred because it's missing bid_detail (the suggested layer)
    expect(result).not.toBeNull();
    expect(result!.topicId).toBe('group-b');
  });

  it('no topic groups exist — falls through to Pass 2', async () => {
    // Pass 1 returns no items
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    // No embedding provided — so Pass 2 also skips
    const result = await suggestTopic(
      asSupabase(mockClient),
      baseParams({ embeddingArray: undefined }),
    );

    expect(result).toBeNull();
  });

  it('handles items with topic_id but no layer gracefully', async () => {
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            id: 'item-1',
            title: 'No Layer Item',
            metadata: { topic_id: 'compliance-certification' },
            // No layer key in metadata
          },
        ],
        error: null,
      }),
    );

    const result = await suggestTopic(asSupabase(mockClient), baseParams());

    // Item has topic_id but no layer — should be skipped in grouping
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// suggestTopic — Pass 2: Similarity search for ungrouped items
// ---------------------------------------------------------------------------

describe('suggestTopic — Pass 2: Similarity search', () => {
  let mockClient: MockSupabaseClient;
  const fakeEmbedding = Array.from({ length: 1024 }, () => 0.1);

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('finds similar item without topic_id and suggests new group', async () => {
    // Pass 1: no items with topic_id (mockImplementationOnce so it's consumed)
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Pass 2 — RPC returns similar items
    mockClient.rpc.mockResolvedValueOnce({
      data: [
        {
          id: 'similar-1',
          title: 'ISO Compliance Checklist',
          similarity: 0.85,
          content_type: 'article',
          content: 'Some content...',
          platform: 'web',
          author_name: 'Author',
          source_domain: 'example.com',
        },
      ],
      error: null,
    });

    // Pass 2 — detail fetch for matched IDs (second .then() call)
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'similar-1',
              title: 'ISO Compliance Checklist',
              primary_domain: 'Compliance',
              primary_subtopic: 'Certification',
              layer: 'sales_brief',
              metadata: { layer: 'sales_brief' },
            },
          ],
          error: null,
        }),
    );

    const result = await suggestTopic(
      asSupabase(mockClient),
      baseParams({ embeddingArray: fakeEmbedding }),
    );

    expect(result).not.toBeNull();
    expect(result!.topicId).toBe('compliance-certification');
    expect(result!.existingLayers).toHaveLength(1);
    expect(result!.existingLayers[0].id).toBe('similar-1');
    expect(result!.existingLayers[0].layer).toBe('sales_brief');
    expect(result!.reason).toContain('Similar item');
    expect(result!.reason).toContain('ISO Compliance Checklist');

    // Verify RPC was called with correct parameters
    expect(mockClient.rpc).toHaveBeenCalledWith('find_similar_content', {
      query_embedding: JSON.stringify(fakeEmbedding),
      similarity_threshold: 0.75,
      limit_count: 5,
    });
  });

  it('returns null when similar items are in a different domain', async () => {
    // Pass 1: empty (mockImplementationOnce so it's consumed first)
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Pass 2 — RPC returns a similar item
    mockClient.rpc.mockResolvedValueOnce({
      data: [
        {
          id: 'diff-domain',
          title: 'Different Domain Item',
          similarity: 0.88,
          content_type: 'article',
          content: 'Some content...',
          platform: 'web',
          author_name: 'Author',
          source_domain: 'example.com',
        },
      ],
      error: null,
    });

    // Detail fetch — item is in a different domain (second .then() call)
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'diff-domain',
              title: 'Different Domain Item',
              primary_domain: 'Technology',
              primary_subtopic: 'Infrastructure',
              layer: 'research',
              metadata: { layer: 'research' },
            },
          ],
          error: null,
        }),
    );

    const result = await suggestTopic(
      asSupabase(mockClient),
      baseParams({ embeddingArray: fakeEmbedding }),
    );

    expect(result).toBeNull();
  });

  it('returns null when no similar items exist', async () => {
    // Pass 1: empty (mockImplementationOnce so it's consumed first)
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Pass 2 — RPC returns nothing
    mockClient.rpc.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const result = await suggestTopic(
      asSupabase(mockClient),
      baseParams({ embeddingArray: fakeEmbedding }),
    );

    expect(result).toBeNull();
  });

  it('skips similar items that already have a topic_id', async () => {
    // Pass 1: empty (mockImplementationOnce so it's consumed first)
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Pass 2 — RPC returns a similar item
    mockClient.rpc.mockResolvedValueOnce({
      data: [
        {
          id: 'has-topic',
          title: 'Already Grouped',
          similarity: 0.9,
          content_type: 'article',
          content: 'Some content...',
          platform: 'web',
          author_name: 'Author',
          source_domain: 'example.com',
        },
      ],
      error: null,
    });

    // Detail fetch — item already has topic_id (should be skipped)
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'has-topic',
              title: 'Already Grouped',
              primary_domain: 'Compliance',
              primary_subtopic: 'Certification',
              layer: 'sales_brief',
              metadata: { topic_id: 'existing-group', layer: 'sales_brief' },
            },
          ],
          error: null,
        }),
    );

    const result = await suggestTopic(
      asSupabase(mockClient),
      baseParams({ embeddingArray: fakeEmbedding }),
    );

    // Should return null — the similar item already has a topic_id
    expect(result).toBeNull();
  });

  it('handles similar item without a layer (unassigned)', async () => {
    // Pass 1: empty (mockImplementationOnce so it's consumed first)
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    // Pass 2 — RPC returns a similar item
    mockClient.rpc.mockResolvedValueOnce({
      data: [
        {
          id: 'no-layer',
          title: 'Unassigned Layer Item',
          similarity: 0.82,
          content_type: 'article',
          content: 'Some content...',
          platform: 'web',
          author_name: 'Author',
          source_domain: 'example.com',
        },
      ],
      error: null,
    });

    // Detail fetch — item has no layer (second .then() call)
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'no-layer',
              title: 'Unassigned Layer Item',
              primary_domain: 'Compliance',
              primary_subtopic: 'Certification',
              metadata: {},
            },
          ],
          error: null,
        }),
    );

    const result = await suggestTopic(
      asSupabase(mockClient),
      baseParams({ embeddingArray: fakeEmbedding }),
    );

    expect(result).not.toBeNull();
    expect(result!.topicId).toBe('compliance-certification');
    // No existing layers since the match has no layer assigned
    expect(result!.existingLayers).toHaveLength(0);
    expect(result!.reason).toContain('Similar item');
  });

  it('skips Pass 2 when no embedding is provided', async () => {
    // Pass 1: empty
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const result = await suggestTopic(
      asSupabase(mockClient),
      baseParams({ embeddingArray: undefined }),
    );

    expect(result).toBeNull();
    // RPC should not have been called
    expect(mockClient.rpc).not.toHaveBeenCalled();
  });

  it('skips Pass 2 when embedding array is empty', async () => {
    // Pass 1: empty
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const result = await suggestTopic(
      asSupabase(mockClient),
      baseParams({ embeddingArray: [] }),
    );

    expect(result).toBeNull();
    expect(mockClient.rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// suggestTopic — Edge cases
// ---------------------------------------------------------------------------

describe('suggestTopic — Edge cases', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('returns null when primaryDomain is empty', async () => {
    const result = await suggestTopic(
      asSupabase(mockClient),
      baseParams({ primaryDomain: '' }),
    );

    expect(result).toBeNull();
    // Should not even query the database
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('returns null when primarySubtopic is empty', async () => {
    const result = await suggestTopic(
      asSupabase(mockClient),
      baseParams({ primarySubtopic: '' }),
    );

    expect(result).toBeNull();
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('handles database error in Pass 1 gracefully', async () => {
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: null,
        error: { message: 'Connection failed' },
      }),
    );

    const result = await suggestTopic(
      asSupabase(mockClient),
      baseParams({ embeddingArray: undefined }),
    );

    // Should not throw — returns null
    expect(result).toBeNull();
  });

  it('handles RPC error in Pass 2 gracefully', async () => {
    // Pass 1: empty
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    // Pass 2 — RPC fails
    mockClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC failed' },
    });

    const result = await suggestTopic(
      asSupabase(mockClient),
      baseParams({ embeddingArray: [0.1, 0.2, 0.3] }),
    );

    expect(result).toBeNull();
  });

  it('prefers group with more existing layers when both are missing the suggested layer', async () => {
    // Two groups both missing bid_detail, but group-a has 2 items vs group-b has 1
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            id: 'a1',
            title: 'Group A - Brief',
            layer: 'sales_brief',
            metadata: { topic_id: 'group-a', layer: 'sales_brief' },
          },
          {
            id: 'a2',
            title: 'Group A - Reference',
            layer: 'company_reference',
            metadata: { topic_id: 'group-a', layer: 'company_reference' },
          },
          {
            id: 'b1',
            title: 'Group B - Brief',
            layer: 'sales_brief',
            metadata: { topic_id: 'group-b', layer: 'sales_brief' },
          },
        ],
        error: null,
      }),
    );

    const result = await suggestTopic(asSupabase(mockClient), baseParams());

    // group-a should be preferred (2 items > 1 item, both missing bid_detail)
    expect(result).not.toBeNull();
    expect(result!.topicId).toBe('group-a');
    expect(result!.existingLayers).toHaveLength(2);
  });
});
