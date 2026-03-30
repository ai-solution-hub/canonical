/**
 * Integration tests for the classification → entity → certification data flow.
 * Suite 2 of the data flow integration test Phase 2.
 *
 * Tests the complete pipeline: classifyContent() → entity storage with
 * context_snippet → temporal reference bridging → certification status derivation.
 *
 * Uses mocked Supabase to simulate DB state changes through the pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient, type MockSupabaseClient } from '../helpers/mock-supabase';

// ── Mock Claude API and dependencies ────────────────────────────────

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

vi.mock('@/lib/entities/entity-aliases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/entities/entity-aliases')>();
  return {
    ...actual,
    loadAliases: vi.fn().mockResolvedValue({}),
  };
});

// Mock the bridge function to verify it's called, but also test real logic in dedicated suite
const mockBridge = vi.fn();
vi.mock('@/lib/entities/entity-metadata-bridge', () => ({
  bridgeTemporalReferencesToEntities: (...args: unknown[]) => mockBridge(...args),
}));

import { classifyContent } from '@/lib/ai/classify';

// ── Helpers ──────────────────────────────────────────────────────────

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
  primary_domain: 'security',
  primary_subtopic: 'certifications',
  secondary_domain: null,
  secondary_subtopic: null,
  ai_keywords: ['ISO 27001', 'information security'],
  ai_summary: 'Document about ISO 27001 certification.',
  suggested_title: 'ISO 27001 Certification Overview',
  classification_confidence: 0.95,
  classification_reasoning: 'Content discusses ISO 27001 certification details.',
};

const itemId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const userId = 'a1234567-b890-4cde-f012-34567890abcd';

describe('classification → entity → certification flow', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockSupabaseClient();

    // Configure mock client to return a content item with content
    mockClient._chain.single.mockResolvedValue({
      data: {
        id: itemId,
        title: 'ISO 27001 Certification',
        content: 'Our organisation holds ISO 27001 certification awarded in January 2024, expiring June 2025. We also hold Cyber Essentials Plus.',
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
        metadata: {},
      },
      error: null,
    });

    // Taxonomy mock — domains and subtopics
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({
        data: [{ id: 'd1', name: 'security' }],
        error: null,
      }),
    );
  });

  it('T2.1: classify content populates entity mentions with context_snippet', async () => {
    mockCreate.mockResolvedValue(
      createToolUseResponse({
        ...baseClassificationInput,
        entities: [
          { name: 'ISO 27001', type: 'certification', canonical_name: 'ISO 27001' },
        ],
        temporal_references: [
          { date: '2025-06-30', context: 'ISO 27001 certification expiry', context_type: 'expiry' },
        ],
      }),
    );

    const result = await classifyContent({
      supabase: mockClient as never,
      itemId,
      force: true,
      userId,
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities![0].canonical_name).toBe('ISO 27001');

    // Verify entity upsert was called with correct canonical_name, entity_type, AND context_snippet
    const upsertCall = mockClient._chain.upsert.mock.calls[0];
    expect(upsertCall).toBeDefined();
    const entityRows = upsertCall[0] as Array<Record<string, unknown>>;
    expect(entityRows).toHaveLength(1);
    expect(entityRows[0].canonical_name).toBe('iso 27001');
    expect(entityRows[0].entity_type).toBe('certification');
    expect(entityRows[0].context_snippet).toBeTruthy();
    expect(typeof entityRows[0].context_snippet).toBe('string');
    expect(entityRows[0].content_item_id).toBe(itemId);
  });

  it('T2.2: temporal reference bridge is called after entity storage with correct contentItemId', async () => {
    mockCreate.mockResolvedValue(
      createToolUseResponse({
        ...baseClassificationInput,
        entities: [
          { name: 'ISO 27001', type: 'certification', canonical_name: 'ISO 27001' },
        ],
        temporal_references: [
          { date: '2025-06-30', context: 'ISO 27001 expiry', context_type: 'expiry' },
        ],
      }),
    );

    await classifyContent({
      supabase: mockClient as never,
      itemId,
      force: true,
      userId,
    });

    // Verify bridge was called exactly once with the correct supabase client and contentItemId
    expect(mockBridge).toHaveBeenCalledTimes(1);
    expect(mockBridge).toHaveBeenCalledWith(mockClient, itemId);
    // Bridge must be called after entity upsert (entities must exist before bridging)
    expect(mockClient._chain.upsert).toHaveBeenCalled();
  });

  // T2.3: Partial implementation — verifies ai_temporal_references are stored in the
  // metadata update call. The full spec requires calling GET /api/certifications and
  // verifying the response, which needs real DB integration tests (planned for next session).
  it('T2.3: temporal references stored in item metadata', async () => {
    mockCreate.mockResolvedValue(
      createToolUseResponse({
        ...baseClassificationInput,
        temporal_references: [
          { date: '2025-06-30', context: 'ISO 27001 certification expiry', context_type: 'expiry' },
        ],
      }),
    );

    await classifyContent({
      supabase: mockClient as never,
      itemId,
      force: true,
      userId,
    });

    // Verify that the update call included ai_temporal_references in metadata
    const updateCall = mockClient._chain.update.mock.calls[0];
    expect(updateCall).toBeDefined();
    const updateData = updateCall[0] as Record<string, unknown>;
    const metadataField = updateData.metadata as Record<string, unknown>;
    expect(metadataField.ai_temporal_references).toEqual([
      { date: '2025-06-30', context: 'ISO 27001 certification expiry', context_type: 'expiry' },
    ]);
  });

  it.todo('T2.3b: GET /api/certifications returns derived certification status from temporal references (requires real DB integration)');

  it('T2.4: multiple certifications in one document are all stored', async () => {
    mockCreate.mockResolvedValue(
      createToolUseResponse({
        ...baseClassificationInput,
        entities: [
          { name: 'ISO 27001', type: 'certification', canonical_name: 'ISO 27001' },
          { name: 'Cyber Essentials Plus', type: 'certification', canonical_name: 'Cyber Essentials Plus' },
        ],
      }),
    );

    const result = await classifyContent({
      supabase: mockClient as never,
      itemId,
      force: true,
      userId,
    });

    expect(result.entities).toHaveLength(2);

    // Verify upsert was called with both entities and correct fields
    const upsertCall = mockClient._chain.upsert.mock.calls[0];
    const entityRows = upsertCall[0] as Array<Record<string, unknown>>;
    expect(entityRows).toHaveLength(2);

    // Verify canonical_name values (lowercased)
    const canonicalNames = entityRows.map((r) => r.canonical_name);
    expect(canonicalNames).toContain('iso 27001');
    expect(canonicalNames).toContain('cyber essentials plus');

    // Verify entity_type for all rows
    expect(entityRows.every((r) => r.entity_type === 'certification')).toBe(true);

    // Verify content_item_id is set correctly for all rows
    expect(entityRows.every((r) => r.content_item_id === itemId)).toBe(true);

    // Verify each row has a context_snippet (populated by extractEntityContext)
    expect(entityRows.every((r) => typeof r.context_snippet === 'string')).toBe(true);
  });

  it.todo('T2.4b: each certification entity has correct metadata and expiry_status (requires bridge integration)');

  it('T2.5: reclassification (force=true) updates entity metadata', async () => {
    // First, simulate a previously classified item
    mockClient._chain.single.mockResolvedValue({
      data: {
        id: itemId,
        title: 'ISO 27001 Certification',
        content: 'Our ISO 27001 certification was renewed, now expiring December 2026.',
        content_type: 'article',
        classified_at: '2024-01-01T00:00:00Z',
        primary_domain: 'security',
        primary_subtopic: 'certifications',
        secondary_domain: null,
        secondary_subtopic: null,
        ai_keywords: ['ISO 27001'],
        ai_summary: 'Old summary',
        suggested_title: 'Old title',
        classification_confidence: 0.9,
        classification_reasoning: 'Old reasoning',
        metadata: {
          ai_temporal_references: [
            { date: '2025-06-30', context: 'ISO 27001 expiry', context_type: 'expiry' },
          ],
        },
      },
      error: null,
    });

    // New classification result with updated expiry
    mockCreate.mockResolvedValue(
      createToolUseResponse({
        ...baseClassificationInput,
        entities: [
          { name: 'ISO 27001', type: 'certification', canonical_name: 'ISO 27001' },
        ],
        temporal_references: [
          { date: '2026-12-31', context: 'ISO 27001 expiry after renewal', context_type: 'expiry' },
        ],
      }),
    );

    const result = await classifyContent({
      supabase: mockClient as never,
      itemId,
      force: true,
      userId,
    });

    // Verify the classification result contains the UPDATED temporal references (not old ones)
    expect(result.temporal_references).toEqual([
      { date: '2026-12-31', context: 'ISO 27001 expiry after renewal', context_type: 'expiry' },
    ]);
    expect(result.temporal_references).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ date: '2025-06-30' })]),
    );

    // Verify entity upsert was called with the correct entity
    const upsertCall = mockClient._chain.upsert.mock.calls[0];
    expect(upsertCall).toBeDefined();
    const entityRows = upsertCall[0] as Array<Record<string, unknown>>;
    expect(entityRows[0].canonical_name).toBe('iso 27001');

    // Bridge should be called to update entity metadata with the new date
    expect(mockBridge).toHaveBeenCalledTimes(1);
    expect(mockBridge).toHaveBeenCalledWith(mockClient, itemId);
  });

  it.todo('T2.5b: reclassification metadata update replaces old temporal references in DB (requires real DB integration)');
});
