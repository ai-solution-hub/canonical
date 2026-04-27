import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type { ExtractedEntity } from '@/lib/ai/classify';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../helpers/mock-supabase';

/**
 * Cast the mock supabase client to the SupabaseClient<Database> type that
 * classifyContent() expects. The mock intentionally implements only the
 * subset of the interface exercised by these tests; the double-cast via
 * `unknown` is the standard workaround used across the test suite for this.
 */
const asClient = (m: MockSupabaseClient): SupabaseClient<Database> =>
  m as unknown as SupabaseClient<Database>;

// ──────────────────────────────────────────
// Mock dependencies
// ──────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  getAIModel: () => 'claude-sonnet-4-6',
  estimateCost: vi.fn().mockReturnValue(0.003),
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
}));

vi.mock('@/lib/content/strip-markdown', () => ({
  stripMarkdown: (text: string) => text,
}));

vi.mock('@/lib/ai/skills/loader', () => ({
  loadSkill: vi
    .fn()
    .mockResolvedValue(
      'Classify content.\n\n{TAXONOMY}\n\n{CLIENT_DISAMBIGUATION}\n\nPrefer "{CLIENT_ORGANISATION_NAME}" not "{CLIENT_ORGANISATION_SHORT}", "{CLIENT_PRODUCT_NAME}" not "{CLIENT_PRODUCT_SHORT}".',
    ),
}));

vi.mock('@/lib/entities/entity-aliases', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/entities/entity-aliases')>();
  return {
    ...actual,
    loadAliases: vi.fn().mockResolvedValue({}),
  };
});

// Import after mocks
import {
  classifyContent,
  validateEntities,
  type ValidatedEntity,
} from '@/lib/ai/classify';

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

const ITEM_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const USER_ID = 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b';

function makeEntity(
  name: string,
  type: ExtractedEntity['type'],
  canonical?: string,
): ExtractedEntity {
  return {
    name,
    type,
    canonical_name: canonical ?? name.toLowerCase(),
  };
}

function createPass1Response(entities: ExtractedEntity[]) {
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
        input: {
          primary_domain: 'security',
          primary_subtopic: 'data-protection',
          ai_keywords: ['security', 'compliance'],
          summary: 'Test summary',
          suggested_title: 'Test Title',
          classification_confidence: 0.9,
          classification_reasoning: 'Test reasoning',
          entities,
          relationships: [],
          temporal_references: [],
        },
        caller: { type: 'direct' as const },
      },
    ],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn' as const,
    stop_sequence: null,
    usage: {
      input_tokens: 5000,
      output_tokens: 800,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
  };
}

function createPass2Response(validatedEntities: ValidatedEntity[]) {
  return {
    id: 'msg_test2',
    type: 'message' as const,
    role: 'assistant' as const,
    container: null,
    content: [
      {
        type: 'tool_use' as const,
        id: 'toolu_test2',
        name: 'return_entity_validation',
        input: {
          validated_entities: validatedEntities,
        },
        caller: { type: 'direct' as const },
      },
    ],
    model: 'claude-haiku-4-5',
    stop_reason: 'end_turn' as const,
    stop_sequence: null,
    usage: {
      input_tokens: 1200,
      output_tokens: 400,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
  };
}

function setupMockSupabase(supabase: MockSupabaseClient) {
  // Content item fetch (single() terminator)
  supabase._chain.single.mockResolvedValue({
    data: {
      id: ITEM_ID,
      title: 'Test Content',
      content:
        'ISO 27001 certification for Acme Corp. Encryption is important.',
      content_type: 'q_a_pair',
      classified_at: null,
      primary_domain: null,
      primary_subtopic: null,
      secondary_domain: null,
      secondary_subtopic: null,
      ai_keywords: null,
      summary: null,
      suggested_title: null,
      classification_confidence: null,
      classification_reasoning: null,
      metadata: null,
    },
    error: null,
  });

  // Taxonomy domain/subtopic queries (then() terminator for awaitable chains)
  supabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
}

// ──────────────────────────────────────────
// Tests: validateEntities() unit tests
// ──────────────────────────────────────────

describe('validateEntities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when entities array is empty', async () => {
    const result = await validateEntities(
      [],
      'some content',
      'Title',
      'article',
    );

    expect(result).toEqual({
      validated_entities: [],
      removed_count: 0,
      retyped_count: 0,
      confirmed_count: 0,
    });
    // Should not call Claude API
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('calls Claude Haiku with correct tool schema and prompt', async () => {
    const entities = [
      makeEntity('ISO 27001', 'certification'),
      makeEntity('Acme Corp', 'organisation'),
    ];

    mockCreate.mockResolvedValueOnce(
      createPass2Response([
        {
          name: 'ISO 27001',
          type: 'certification',
          canonical_name: 'iso 27001',
          verdict: 'confirmed',
          reason: 'Valid certification with issuing body',
        },
        {
          name: 'Acme Corp',
          type: 'organisation',
          canonical_name: 'acme corp',
          verdict: 'confirmed',
          reason: 'Named organisation with legal registration',
        },
      ]),
    );

    await validateEntities(
      entities,
      'Test content about ISO 27001',
      'Test',
      'article',
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];

    // Verify model is Haiku
    expect(callArgs.model).toBe('claude-haiku-4-5');

    // Verify tool_choice forces the validation tool
    expect(callArgs.tool_choice).toEqual({
      type: 'tool',
      name: 'return_entity_validation',
    });

    // Verify tool schema is present
    expect(callArgs.tools[0].name).toBe('return_entity_validation');

    // Verify prompt contains entity list and diagnostic tests
    const userMessage = callArgs.messages[0].content;
    expect(userMessage).toContain('ISO 27001');
    expect(userMessage).toContain('Acme Corp');
    expect(userMessage).toContain('NAMED ENTITY TEST');
    expect(userMessage).toContain('EXTERNAL REFERENCE TEST');
  });

  it('correctly counts confirmed, retyped, and removed entities', async () => {
    const entities = [
      makeEntity('ISO 27001', 'certification'),
      makeEntity('encryption', 'technology'),
      makeEntity('ISMS', 'framework'),
    ];

    mockCreate.mockResolvedValueOnce(
      createPass2Response([
        {
          name: 'ISO 27001',
          type: 'certification',
          canonical_name: 'iso 27001',
          verdict: 'confirmed',
          reason: 'Valid certification',
        },
        {
          name: 'encryption',
          type: 'technology',
          canonical_name: 'encryption',
          verdict: 'removed',
          reason: 'Generic concept, not a named technology',
        },
        {
          name: 'ISMS',
          type: 'certification',
          canonical_name: 'isms',
          verdict: 'retyped',
          original_type: 'framework',
          reason: 'Management system, retyped to certification',
        },
      ]),
    );

    const result = await validateEntities(
      entities,
      'Content about ISO 27001 and encryption',
      'Test',
      'article',
    );

    expect(result.confirmed_count).toBe(1);
    expect(result.removed_count).toBe(1);
    expect(result.retyped_count).toBe(1);
    expect(result.validated_entities).toHaveLength(3);
  });

  it('logs token usage with Pass 2 prefix', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const entities = [makeEntity('ISO 27001', 'certification')];

    mockCreate.mockResolvedValueOnce(
      createPass2Response([
        {
          name: 'ISO 27001',
          type: 'certification',
          canonical_name: 'iso 27001',
          verdict: 'confirmed',
          reason: 'Valid',
        },
      ]),
    );

    await validateEntities(entities, 'content', 'Title', 'article');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Pass 2 Validation]'),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 confirmed'),
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Tokens:'));

    consoleSpy.mockRestore();
  });
});

// ──────────────────────────────────────────
// Tests: classifyContent integration with Pass 2
// ──────────────────────────────────────────

describe('classifyContent with two-pass validation', () => {
  let supabase: MockSupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    supabase = createMockSupabaseClient();
    setupMockSupabase(supabase);
  });

  it('skips Pass 2 when validate is false (default)', async () => {
    const entities = [
      makeEntity('ISO 27001', 'certification'),
      makeEntity('Acme Corp', 'organisation'),
    ];

    mockCreate.mockResolvedValueOnce(createPass1Response(entities));

    await classifyContent({
      supabase: asClient(supabase),
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
    });

    // Only Pass 1 call, no Pass 2
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].model).toBe('claude-sonnet-4-6');
  });

  it('skips Pass 2 when validate is explicitly false', async () => {
    const entities = [makeEntity('ISO 27001', 'certification')];

    mockCreate.mockResolvedValueOnce(createPass1Response(entities));

    await classifyContent({
      supabase: asClient(supabase),
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
      validate: false,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('runs Pass 2 when validate is true', async () => {
    const entities = [
      makeEntity('ISO 27001', 'certification'),
      makeEntity('Acme Corp', 'organisation'),
    ];

    // Pass 1 response
    mockCreate.mockResolvedValueOnce(createPass1Response(entities));
    // Pass 2 response
    mockCreate.mockResolvedValueOnce(
      createPass2Response([
        {
          name: 'ISO 27001',
          type: 'certification',
          canonical_name: 'iso 27001',
          verdict: 'confirmed',
          reason: 'Valid certification',
        },
        {
          name: 'Acme Corp',
          type: 'organisation',
          canonical_name: 'acme corp',
          verdict: 'confirmed',
          reason: 'Valid organisation',
        },
      ]),
    );

    await classifyContent({
      supabase: asClient(supabase),
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
      validate: true,
    });

    // Two Claude calls: Pass 1 (Sonnet) + Pass 2 (Haiku)
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[0][0].model).toBe('claude-sonnet-4-6');
    expect(mockCreate.mock.calls[1][0].model).toBe('claude-haiku-4-5');
  });

  it('removes entities with "removed" verdict from storage', async () => {
    const entities = [
      makeEntity('ISO 27001', 'certification'),
      makeEntity('data retention', 'capability'),
    ];

    mockCreate.mockResolvedValueOnce(createPass1Response(entities));
    mockCreate.mockResolvedValueOnce(
      createPass2Response([
        {
          name: 'ISO 27001',
          type: 'certification',
          canonical_name: 'iso 27001',
          verdict: 'confirmed',
          reason: 'Valid certification',
        },
        {
          name: 'data retention',
          type: 'capability',
          canonical_name: 'data retention',
          verdict: 'removed',
          reason: 'Generic concept, not a named capability',
        },
      ]),
    );

    await classifyContent({
      supabase: asClient(supabase),
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
      validate: true,
    });

    // Verify upsert was called — check the args passed to the chain
    const upsertCalls = supabase._chain.upsert.mock.calls;
    expect(upsertCalls.length).toBe(1);
    const upsertedRows = upsertCalls[0][0];
    expect(upsertedRows).toHaveLength(1);
    expect(upsertedRows[0].entity_name).toBe('ISO 27001');
  });

  it('applies retyped entity type from Pass 2', async () => {
    const entities = [
      makeEntity('Kanban', 'framework'), // Wrong type — should be methodology
    ];

    mockCreate.mockResolvedValueOnce(createPass1Response(entities));
    mockCreate.mockResolvedValueOnce(
      createPass2Response([
        {
          name: 'Kanban',
          type: 'methodology', // Retyped
          canonical_name: 'kanban',
          verdict: 'retyped',
          original_type: 'framework',
          reason: 'Named approach to work, not a framework',
        },
      ]),
    );

    await classifyContent({
      supabase: asClient(supabase),
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
      validate: true,
    });

    // The entity should be stored with the corrected type
    const upsertCalls = supabase._chain.upsert.mock.calls;
    expect(upsertCalls.length).toBe(1);
    const upsertedRows = upsertCalls[0][0];
    expect(upsertedRows[0].entity_type).toBe('methodology');
  });

  it('falls back to deterministic-filtered entities when Pass 2 fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const entities = [
      makeEntity('ISO 27001', 'certification'),
      makeEntity('Acme Corp', 'organisation'),
    ];

    mockCreate.mockResolvedValueOnce(createPass1Response(entities));
    // Pass 2 fails
    mockCreate.mockRejectedValueOnce(new Error('API timeout'));

    await classifyContent({
      supabase: asClient(supabase),
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
      validate: true,
    });

    // Entities should still be stored (graceful degradation)
    const upsertCalls = supabase._chain.upsert.mock.calls;
    expect(upsertCalls.length).toBe(1);
    const upsertedRows = upsertCalls[0][0];
    // Both entities stored since Pass 2 failed and we fell back
    expect(upsertedRows).toHaveLength(2);

    // Error was logged
    expect(consoleSpy).toHaveBeenCalledWith(
      'Entity validation (Pass 2) failed:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it('runs deterministic filters before Pass 2', async () => {
    // Include an entity that deterministic filters will catch
    // 'encryption' is in the GENERIC_CONCEPTS set
    const entities = [
      makeEntity('ISO 27001', 'certification'),
      makeEntity('encryption', 'technology', 'encryption'),
    ];

    mockCreate.mockResolvedValueOnce(createPass1Response(entities));
    // Pass 2 should only receive ISO 27001 (encryption filtered out deterministically)
    mockCreate.mockResolvedValueOnce(
      createPass2Response([
        {
          name: 'ISO 27001',
          type: 'certification',
          canonical_name: 'iso 27001',
          verdict: 'confirmed',
          reason: 'Valid certification',
        },
      ]),
    );

    await classifyContent({
      supabase: asClient(supabase),
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
      validate: true,
    });

    // Pass 2 was called (2 total calls)
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // Pass 2 prompt should only contain ISO 27001, not encryption
    const pass2Call = mockCreate.mock.calls[1][0];
    const pass2Prompt = pass2Call.messages[0].content;
    expect(pass2Prompt).toContain('ISO 27001');
    // 'encryption' as a generic concept should be filtered before reaching Pass 2
    // Check it does not appear in the entity list section of the prompt
    expect(pass2Prompt).not.toContain('"encryption" (type:');
  });

  it('skips Pass 2 when all entities are removed by deterministic filters', async () => {
    // All entities will be caught by deterministic filters
    const entities = [
      makeEntity('encryption', 'technology', 'encryption'), // Generic concept
      makeEntity('data protection', 'capability', 'data protection'), // Generic concept
    ];

    mockCreate.mockResolvedValueOnce(createPass1Response(entities));

    await classifyContent({
      supabase: asClient(supabase),
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
      validate: true,
    });

    // Only Pass 1 called -- Pass 2 skipped since no entities survived filters
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('skips Pass 2 when Pass 1 returns no entities', async () => {
    mockCreate.mockResolvedValueOnce(createPass1Response([]));

    await classifyContent({
      supabase: asClient(supabase),
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
      validate: true,
    });

    // Only Pass 1 called
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
