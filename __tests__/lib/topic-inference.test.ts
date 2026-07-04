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
//
// ID-131 {131.17} G-IMS-DELETE KEEP-list: re-pointed off content_items onto
// source_documents. `layer` has NO source_documents column (D5 — dies with
// content_items, not re-homed) — findExistingTopicGroup can therefore never
// form a non-empty layer group any more, so `suggestTopic` now ALWAYS
// returns null regardless of matching topic_id rows. These tests assert
// that new, permanent behaviour (a graceful, contract-preserving
// degradation) rather than the pre-repoint layer-coverage matching this
// suite used to exercise.
// ---------------------------------------------------------------------------

describe('suggestTopic — Pass 1: Existing topic groups', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('returns null even when matching topic_id rows exist (layer has no source_documents column, D5)', async () => {
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            id: 'item-1',
            original_filename: 'ISO Certification Guide',
            filename: 'iso-cert-guide.md',
            extraction_metadata: {
              topic_id: 'compliance-certification',
            },
          },
          {
            id: 'item-2',
            original_filename: 'Certification Policy',
            filename: 'cert-policy.md',
            extraction_metadata: {
              topic_id: 'compliance-certification',
            },
          },
        ],
        error: null,
      }),
    );

    const result = await suggestTopic(asSupabase(mockClient), baseParams());

    expect(result).toBeNull();
  });

  it('returns null when all four layers would have been present in the pre-repoint group', async () => {
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            id: 'item-1',
            original_filename: 'Brief',
            filename: 'brief.md',
            extraction_metadata: { topic_id: 'compliance-certification' },
          },
          {
            id: 'item-2',
            original_filename: 'Detail',
            filename: 'detail.md',
            extraction_metadata: { topic_id: 'compliance-certification' },
          },
        ],
        error: null,
      }),
    );

    const result = await suggestTopic(asSupabase(mockClient), baseParams());

    expect(result).toBeNull();
  });

  it('returns null across multiple candidate topic groups', async () => {
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            id: 'item-a1',
            original_filename: 'Group A Brief',
            filename: 'group-a-brief.md',
            extraction_metadata: { topic_id: 'group-a' },
          },
          {
            id: 'item-b1',
            original_filename: 'Group B Brief',
            filename: 'group-b-brief.md',
            extraction_metadata: { topic_id: 'group-b' },
          },
        ],
        error: null,
      }),
    );

    const result = await suggestTopic(asSupabase(mockClient), baseParams());

    expect(result).toBeNull();
  });

  it('no topic groups exist — returns null (Pass 2 similarity search was removed under ID-131.15)', async () => {
    // Pass 1 returns no items
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

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
            original_filename: 'No Layer Item',
            filename: 'no-layer-item.md',
            extraction_metadata: { topic_id: 'compliance-certification' },
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

  it('returns null even with multiple candidate groups of differing size (layer has no source_documents column, D5)', async () => {
    // ID-131 {131.17}: this used to test group-size preference scoring —
    // that scoring path is now unreachable (no group is ever non-empty),
    // so this asserts the new permanent-null degradation instead.
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            id: 'a1',
            original_filename: 'Group A - Brief',
            filename: 'group-a-brief.md',
            extraction_metadata: { topic_id: 'group-a' },
          },
          {
            id: 'a2',
            original_filename: 'Group A - Reference',
            filename: 'group-a-reference.md',
            extraction_metadata: { topic_id: 'group-a' },
          },
          {
            id: 'b1',
            original_filename: 'Group B - Brief',
            filename: 'group-b-brief.md',
            extraction_metadata: { topic_id: 'group-b' },
          },
        ],
        error: null,
      }),
    );

    const result = await suggestTopic(asSupabase(mockClient), baseParams());

    expect(result).toBeNull();
  });
});
