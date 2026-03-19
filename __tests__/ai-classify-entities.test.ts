import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtractedEntity, ExtractedRelationship } from '@/lib/ai/classify';
import { createMockSupabaseClient, type MockSupabaseClient } from './helpers/mock-supabase';

// ──────────────────────────────────────────
// Mock dependencies
// ──────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  getAIModel: () => 'claude-sonnet-4-6',
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
}));

vi.mock('@/lib/editor-utils', () => ({
  htmlToPlainText: (html: string) => html,
}));

vi.mock('@/lib/ai/skills/loader', () => ({
  loadSkill: vi.fn().mockResolvedValue(''),
}));

vi.mock('@/lib/entity-aliases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/entity-aliases')>();
  return {
    ...actual,
    loadAliases: vi.fn().mockResolvedValue({}),
  };
});

// Import after mocks
import { classifyContent } from '@/lib/ai/classify';
import { CLIENT_CONFIG } from '@/lib/client-config';

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function createToolUseResponse(input: Record<string, unknown>) {
  return {
    id: 'msg_test',
    type: 'message' as const,
    role: 'assistant' as const,
    container: null,
    content: [
      {
        type: 'tool_use' as const,
        id: 'toolu_test',
        name: 'return_classification',
        input,
        caller: { type: 'direct' as const },
      },
    ],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn' as const,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
  };
}

const baseClassificationInput = {
  primary_domain: 'SECURITY & COMPLIANCE',
  primary_subtopic: 'Certifications',
  secondary_domain: null,
  secondary_subtopic: null,
  ai_keywords: ['ISO 27001', 'Cyber Essentials', 'information security'],
  ai_summary: 'Overview of security certifications held by the organisation.',
  suggested_title: 'Security Certifications Overview',
  classification_confidence: 0.92,
  classification_reasoning: 'Content explicitly discusses security certifications.',
};

const sampleEntities: ExtractedEntity[] = [
  {
    name: 'ISO27001',
    type: 'certification',
    canonical_name: 'ISO 27001',
  },
  {
    name: 'Cyber Essentials Plus',
    type: 'certification',
    canonical_name: 'Cyber Essentials Plus',
  },
  {
    name: 'Acme Ltd',
    type: 'organisation',
    canonical_name: 'Acme Ltd',
  },
];

const sampleRelationships: ExtractedRelationship[] = [
  {
    source: 'Acme Ltd',
    relationship: 'holds',
    target: 'ISO 27001',
  },
  {
    source: 'Acme Ltd',
    relationship: 'holds',
    target: 'Cyber Essentials Plus',
  },
];

const ITEM_ID = 'item-001';
const USER_ID = 'user-001';

// ──────────────────────────────────────────
// Tests
// ──────────────────────────────────────────

describe('classifyContent — entity extraction', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabaseClient();

    // Default: item exists and has content
    mockSupabase._chain.single.mockResolvedValue({
      data: {
        id: ITEM_ID,
        title: 'Security Certs',
        content: '<p>Acme Ltd holds ISO27001 and Cyber Essentials Plus.</p>',
        content_type: 'article',
        classified_at: null,
        primary_domain: null,
        primary_subtopic: null,
        secondary_domain: null,
        secondary_subtopic: null,
        ai_keywords: null,
        ai_summary: null,
        suggested_title: null,
        classification_confidence: null,
        classification_reasoning: null,
      },
      error: null,
    });

    // Default: taxonomy queries return empty
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );

    // Default: update succeeds
    mockSupabase._chain.eq.mockReturnValue({
      ...mockSupabase._chain,
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null }),
      ),
    });
  });

  describe('tool schema includes entity fields', () => {
    it('sends entities array in the tool schema to Claude', async () => {
      mockCreate.mockResolvedValueOnce(
        createToolUseResponse(baseClassificationInput),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockCreate.mock.calls[0][0];
      const tool = callArgs.tools[0];

      // Verify entities array exists in schema
      expect(tool.input_schema.properties).toHaveProperty('entities');
      expect(tool.input_schema.properties.entities.type).toBe('array');
      expect(tool.input_schema.properties.entities.items.properties).toHaveProperty('name');
      expect(tool.input_schema.properties.entities.items.properties).toHaveProperty('type');
      expect(tool.input_schema.properties.entities.items.properties).toHaveProperty('canonical_name');
    });

    it('sends relationships array in the tool schema to Claude', async () => {
      mockCreate.mockResolvedValueOnce(
        createToolUseResponse(baseClassificationInput),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      const callArgs = mockCreate.mock.calls[0][0];
      const tool = callArgs.tools[0];

      // Verify relationships array exists in schema
      expect(tool.input_schema.properties).toHaveProperty('relationships');
      expect(tool.input_schema.properties.relationships.type).toBe('array');
      expect(tool.input_schema.properties.relationships.items.properties).toHaveProperty('source');
      expect(tool.input_schema.properties.relationships.items.properties).toHaveProperty('relationship');
      expect(tool.input_schema.properties.relationships.items.properties).toHaveProperty('target');
    });

    it('does not require entities or relationships in the tool schema', async () => {
      mockCreate.mockResolvedValueOnce(
        createToolUseResponse(baseClassificationInput),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      const callArgs = mockCreate.mock.calls[0][0];
      const tool = callArgs.tools[0];

      // entities and relationships should NOT be in the required array
      expect(tool.input_schema.required).not.toContain('entities');
      expect(tool.input_schema.required).not.toContain('relationships');
    });

    it('includes entity type enum with all expected values', async () => {
      mockCreate.mockResolvedValueOnce(
        createToolUseResponse(baseClassificationInput),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      const callArgs = mockCreate.mock.calls[0][0];
      const entityTypeEnum =
        callArgs.tools[0].input_schema.properties.entities.items.properties.type.enum;

      expect(entityTypeEnum).toEqual([
        'organisation',
        'certification',
        'regulation',
        'framework',
        'capability',
        'person',
        'technology',
        'project',
        'sector',
      ]);
    });

    it('includes relationship type enum with all expected values', async () => {
      mockCreate.mockResolvedValueOnce(
        createToolUseResponse(baseClassificationInput),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      const callArgs = mockCreate.mock.calls[0][0];
      const relTypeEnum =
        callArgs.tools[0].input_schema.properties.relationships.items.properties.relationship.enum;

      expect(relTypeEnum).toEqual([
        'holds',
        'complies_with',
        'delivers_to',
        'uses',
        'demonstrated_by',
        'requires',
        'part_of',
        'supersedes',
        'references',
        'evidences',
      ]);
    });
  });

  describe('prompt uses config-driven entity examples', () => {
    it('uses entity_examples from CLIENT_CONFIG in the prompt', async () => {
      mockCreate.mockResolvedValueOnce(
        createToolUseResponse(baseClassificationInput),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      const callArgs = mockCreate.mock.calls[0][0];
      const promptText = callArgs.messages[0].content;

      // Verify the prompt contains the configured entity examples
      expect(promptText).toContain(CLIENT_CONFIG.entity_examples.organisation_name);
      expect(promptText).toContain(CLIENT_CONFIG.entity_examples.product_name);
      expect(promptText).toContain(CLIENT_CONFIG.entity_examples.organisation_short);
      expect(promptText).toContain(CLIENT_CONFIG.entity_examples.product_short);
    });
  });

  describe('classification results include entities', () => {
    it('returns entities and relationships when Claude provides them', async () => {
      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: sampleEntities,
          relationships: sampleRelationships,
        }),
      );

      const result = await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(result.entities).toHaveLength(3);
      expect(result.entities![0]).toEqual(sampleEntities[0]);
      expect(result.relationships).toHaveLength(2);
      expect(result.relationships![0]).toEqual(sampleRelationships[0]);
    });

    it('returns undefined entities when Claude omits them', async () => {
      mockCreate.mockResolvedValueOnce(
        createToolUseResponse(baseClassificationInput),
      );

      const result = await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(result.entities).toBeUndefined();
      expect(result.relationships).toBeUndefined();
    });

    it('returns empty arrays when Claude provides empty entity arrays', async () => {
      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: [],
          relationships: [],
        }),
      );

      const result = await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(result.entities).toEqual([]);
      expect(result.relationships).toEqual([]);
    });
  });

  describe('entity storage is non-blocking', () => {
    it('stores entity mentions via upsert when entities are present', async () => {
      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: sampleEntities,
          relationships: sampleRelationships,
        }),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      // Verify entity_mentions upsert was called
      expect(mockSupabase.from).toHaveBeenCalledWith('entity_mentions');
      expect(mockSupabase._chain.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            content_item_id: ITEM_ID,
            entity_type: 'certification',
            entity_name: 'ISO27001',
            canonical_name: 'ISO 27001', // canonicalised
            confidence: 1.0,
          }),
        ]),
        {
          onConflict: 'canonical_name,entity_type,content_item_id',
          ignoreDuplicates: true,
        },
      );
    });

    it('stores entity relationships via insert when relationships are present', async () => {
      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: sampleEntities,
          relationships: sampleRelationships,
        }),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      // Verify entity_relationships insert was called
      expect(mockSupabase.from).toHaveBeenCalledWith('entity_relationships');
      expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            source_entity: 'Acme Limited',
            relationship_type: 'holds',
            target_entity: 'ISO 27001',
            source_item_id: ITEM_ID,
            confidence: 1.0,
          }),
        ]),
      );
    });

    it('does not break classification when entity storage fails', async () => {
      // Configure the upsert chain to return an error
      mockSupabase._chain.upsert.mockReturnValueOnce({
        ...mockSupabase._chain,
        then: vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'entity_mentions table not found' } }),
        ),
      });

      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: sampleEntities,
          relationships: [],
        }),
      );

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Classification should still succeed
      const result = await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(result.primary_domain).toBe('SECURITY & COMPLIANCE');
      expect(result.entities).toHaveLength(3);

      // Should have logged the error
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to store entity mentions:',
        expect.anything(),
      );

      consoleSpy.mockRestore();
    });

    it('does not break classification when relationship storage throws', async () => {
      // Configure insert to throw an exception
      mockSupabase._chain.insert.mockImplementationOnce(() => {
        throw new Error('Database connection lost');
      });

      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: sampleEntities,
          relationships: sampleRelationships,
        }),
      );

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Classification should still succeed
      const result = await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(result.primary_domain).toBe('SECURITY & COMPLIANCE');
      expect(result.relationships).toHaveLength(2);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Entity relationship storage failed:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it('skips entity storage when entities array is empty', async () => {
      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: [],
          relationships: [],
        }),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      // entity_mentions should not be called (empty array is falsy for .length)
      const fromCalls = mockSupabase.from.mock.calls.map((c: unknown[]) => c[0]);
      expect(fromCalls).not.toContain('entity_mentions');
      expect(fromCalls).not.toContain('entity_relationships');
    });

    it('applies canonicalise() to entity canonical_name values', async () => {
      const entitiesWithRawNames: ExtractedEntity[] = [
        { name: 'ISO27001', type: 'certification', canonical_name: 'ISO27001' },
        { name: 'cyber essentials', type: 'certification', canonical_name: 'cyber essentials' },
      ];

      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: entitiesWithRawNames,
        }),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(mockSupabase._chain.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ canonical_name: 'ISO 27001' }),
          expect.objectContaining({ canonical_name: 'Cyber Essentials' }),
        ]),
        expect.anything(),
      );
    });

    it('applies canonicalise() to relationship source and target values', async () => {
      const rawRelationships: ExtractedRelationship[] = [
        { source: 'Acme Ltd', relationship: 'holds', target: 'ISO27001' },
      ];

      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: sampleEntities,
          relationships: rawRelationships,
        }),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            source_entity: 'Acme Limited',
            target_entity: 'ISO 27001', // canonicalised
          }),
        ]),
      );
    });
  });

  describe('cached classification does not include entities', () => {
    it('returns cached result without entities when item is already classified', async () => {
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: ITEM_ID,
          title: 'Security Certs',
          content: '<p>Some content</p>',
          content_type: 'article',
          classified_at: '2026-03-01T00:00:00Z',
          primary_domain: 'SECURITY & COMPLIANCE',
          primary_subtopic: 'Certifications',
          secondary_domain: null,
          secondary_subtopic: null,
          ai_keywords: ['security'],
          ai_summary: 'Summary',
          suggested_title: 'Security Certifications',
          classification_confidence: 0.9,
          classification_reasoning: 'Reason',
        },
        error: null,
      });

      const result = await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: false,
        userId: USER_ID,
      });

      expect(result.cached).toBe(true);
      // Cached results do not include entities
      expect(result.entities).toBeUndefined();
      expect(result.relationships).toBeUndefined();
      // Claude should not have been called
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
