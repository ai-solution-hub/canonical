import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtractedEntity, ExtractedRelationship } from '@/lib/ai/classify';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../helpers/mock-supabase';

// ──────────────────────────────────────────
// Mock dependencies
// ──────────────────────────────────────────

const mockCreate = vi.fn();

// W4 Logging Phase 3: classify.ts now routes errors through the
// structured logger (@/lib/logger) instead of console.error. Mock the
// logger surface so we can assert error-path observability without
// spinning up Pino + Sentry in tests.
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMocks,
  getRequestContext: () => undefined,
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T) => fn(),
  updateRequestContext: vi.fn(),
  withRequestContext: <T>(handler: T) => handler,
  withRequestContextBare: <T>(handler: T) => handler,
  applyRequestContextToSentry: vi.fn(),
}));

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  getAIModel: () => 'claude-sonnet-4-6',
  estimateCost: () => 0.031,
}));

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
  };
});

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
  shouldExcludeEntity,
  isGenericConcept,
  isProtocolOrFormat,
  isFrameworkLot,
  isCompoundEntity,
  stripPersonDescriptors,
} from '@/lib/ai/classify';
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
  summary: 'Overview of security certifications held by the organisation.',
  suggested_title: 'Security Certifications Overview',
  classification_confidence: 0.92,
  classification_reasoning:
    'Content explicitly discusses security certifications.',
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
  /**
   * Rows persisted by each `from(<table>).upsert(rows, …)` call, paired with
   * the table they landed in. Lets tests read the persisted entity_mentions /
   * entity_relationships rows back instead of only asserting the upsert mock
   * was invoked. `whereUpserted(table)` returns the flattened rows for a table.
   */
  let persistedUpserts: Array<{
    table: string;
    rows: unknown[];
    options: unknown;
  }>;
  let lastFromTable: string | null;

  function whereUpserted(table: string): unknown[] {
    return persistedUpserts
      .filter((u) => u.table === table)
      .flatMap((u) => u.rows);
  }

  function upsertOptions(table: string): unknown {
    return persistedUpserts.find((u) => u.table === table)?.options;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    persistedUpserts = [];
    lastFromTable = null;

    // Track which table the chain is operating on so captured upserts can be
    // attributed to entity_mentions vs entity_relationships.
    mockSupabase.from.mockImplementation((table: string) => {
      lastFromTable = table;
      return mockSupabase._chain;
    });
    // Record persisted rows so tests can read the row set back.
    mockSupabase._chain.upsert.mockImplementation(
      (rows: unknown, options: unknown) => {
        persistedUpserts.push({
          table: lastFromTable ?? 'unknown',
          rows: Array.isArray(rows) ? rows : [rows],
          options,
        });
        return mockSupabase._chain;
      },
    );

    // Default: item exists and has content. ID-131 {131.17} G-IMS-DELETE
    // KEEP-list: classifyContent re-pointed off content_items onto
    // source_documents — `ITEM_ID` (the fetch key) IS the source_documents
    // id directly (no separate source_document_id FK column — entity_mentions/
    // entity_relationships storage keys off this same id post-repoint).
    mockSupabase._chain.single.mockResolvedValue({
      data: {
        id: ITEM_ID,
        original_filename: 'Security Certs',
        filename: 'security-certs.md',
        extracted_text:
          '<p>Acme Ltd holds ISO27001 and Cyber Essentials Plus.</p>',
        content_type: 'article',
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
      },
      error: null,
    });

    // Default: taxonomy queries return empty
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
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
      expect(
        tool.input_schema.properties.entities.items.properties,
      ).toHaveProperty('name');
      expect(
        tool.input_schema.properties.entities.items.properties,
      ).toHaveProperty('type');
      expect(
        tool.input_schema.properties.entities.items.properties,
      ).toHaveProperty('canonical_name');
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
      expect(
        tool.input_schema.properties.relationships.items.properties,
      ).toHaveProperty('source');
      expect(
        tool.input_schema.properties.relationships.items.properties,
      ).toHaveProperty('relationship');
      expect(
        tool.input_schema.properties.relationships.items.properties,
      ).toHaveProperty('target');
    });

    it('grounds the classification tool as forced_tool_strict (B-INV-35)', async () => {
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

      // Strict grounding: the tool is strict and its object schema is closed.
      // Under strict mode every property is required (the model still emits
      // empty arrays for entities/relationships when none are found), so the
      // schema documents required keys, not mandatory content.
      expect(tool.strict).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(tool.input_schema.required).toContain('entities');
      expect(tool.input_schema.required).toContain('relationships');
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
        callArgs.tools[0].input_schema.properties.entities.items.properties.type
          .enum;

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
        'product',
        'standard',
        'methodology',
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
        callArgs.tools[0].input_schema.properties.relationships.items.properties
          .relationship.enum;

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
    it('includes the configured entity_examples in the prompt sent to Claude', async () => {
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
      expect(promptText).toContain(
        CLIENT_CONFIG.entity_examples.organisation_name,
      );
      expect(promptText).toContain(CLIENT_CONFIG.entity_examples.product_name);
      expect(promptText).toContain(
        CLIENT_CONFIG.entity_examples.organisation_short,
      );
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
      // Post-S157 WP2: also verify delete-before-insert fires on
      // re-classification. The classify.ts Step 13a clears any stale
      // rows for this source_document_id before the filtered upsert so
      // that entity_mentions always reflects the CURRENT classifier
      // state, not an accumulation of prior filter-rule drafts.
      expect(mockSupabase._chain.delete).toHaveBeenCalled();
      // Read the persisted entity_mentions rows back and assert the ISO 27001
      // mention landed canonicalised + lowercased with full confidence.
      // ID-131 {131.17}: source_document_id IS ITEM_ID directly post-repoint
      // (itemId is a source_documents id, no separate FK column).
      expect(whereUpserted('entity_mentions')).toContainEqual(
        expect.objectContaining({
          source_document_id: ITEM_ID,
          entity_type: 'certification',
          entity_name: 'ISO27001',
          canonical_name: 'iso 27001', // canonicalised + lowercased for case-insensitive index
          confidence: 1.0,
        }),
      );
      // Conflict-resolution semantics: upsert-merge on the dedup key.
      expect(upsertOptions('entity_mentions')).toEqual({
        onConflict: 'canonical_name,entity_type,source_document_id',
        ignoreDuplicates: false,
      });
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

      // Verify entity_relationships upsert was called (S183 WP1 G1
      // switched from insert to upsert with ignoreDuplicates: true).
      expect(mockSupabase.from).toHaveBeenCalledWith('entity_relationships');
      // Read the persisted entity_relationships rows back: the holds edge
      // landed canonicalised + lowercased with full confidence.
      // ID-131 {131.17}: source_document_id IS ITEM_ID directly post-repoint
      // (itemId is a source_documents id, no separate FK column).
      expect(whereUpserted('entity_relationships')).toContainEqual(
        expect.objectContaining({
          source_entity: 'acme limited', // canonicalised + lowercased
          relationship_type: 'holds',
          target_entity: 'iso 27001', // canonicalised + lowercased
          source_document_id: ITEM_ID,
          confidence: 1.0,
        }),
      );
      // S183 WP1 G1 — insert switched to upsert; dedup ignores duplicates.
      expect(upsertOptions('entity_relationships')).toEqual(
        expect.objectContaining({
          onConflict:
            'source_entity,relationship_type,target_entity,source_document_id',
          ignoreDuplicates: true,
        }),
      );
    });

    it('does not break classification when entity storage fails', async () => {
      // Configure the upsert chain to return an error
      // ID-131 {131.17}: classifyContent now ALSO upserts the regenerated
      // embedding into record_embeddings BEFORE the entity_mentions upsert
      // (both share this chain mock) — so the entity_mentions failure must
      // be injected on the SECOND upsert call, not the first.
      let upsertCallCount = 0;
      mockSupabase._chain.upsert.mockImplementation(() => {
        upsertCallCount += 1;
        if (upsertCallCount === 2) {
          return {
            ...mockSupabase._chain,
            then: vi.fn((resolve: (v: unknown) => void) =>
              resolve({
                data: null,
                error: { message: 'entity_mentions table not found' },
              }),
            ),
          };
        }
        return mockSupabase._chain;
      });

      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: sampleEntities,
          relationships: [],
        }),
      );

      loggerMocks.error.mockClear();

      // Classification should still succeed
      const result = await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(result.primary_domain).toBe('SECURITY & COMPLIANCE');
      expect(result.entities).toHaveLength(3);

      // Should have logged the error via the structured logger.
      // W4 Phase 3: replaces former `console.error('Failed to store entity mentions:', ...)`.
      expect(loggerMocks.error).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'classify.entity.upsert',
          itemId: ITEM_ID,
          err: expect.anything(),
        }),
        'Failed to store entity mentions',
      );
    });

    it('does not break classification when relationship storage throws', async () => {
      // Configure upsert to throw an exception — record_embeddings,
      // entity_mentions, and entity_relationships share the same chain mock,
      // so we restore the no-throw behaviour on the other calls. The upsert
      // call order in classifyContent is: record_embeddings (ID-131
      // {131.17} regenerated-embedding store), entity_mentions, then
      // entity_relationships — so we need to throw on the THIRD upsert
      // invocation, not the first or second.
      let upsertCallCount = 0;
      mockSupabase._chain.upsert.mockImplementation(() => {
        upsertCallCount += 1;
        if (upsertCallCount === 3) {
          throw new Error('Database connection lost');
        }
        return {
          ...mockSupabase._chain,
          then: vi.fn((resolve: (v: unknown) => void) =>
            resolve({ data: null, error: null }),
          ),
        };
      });

      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: sampleEntities,
          relationships: sampleRelationships,
        }),
      );

      loggerMocks.error.mockClear();

      // Classification should still succeed
      const result = await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(result.primary_domain).toBe('SECURITY & COMPLIANCE');
      expect(result.relationships).toHaveLength(2);

      // W4 Phase 3: replaces former `console.error('Entity relationship storage failed:', ...)`.
      expect(loggerMocks.error).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'classify.relationship.storage',
          itemId: ITEM_ID,
          err: expect.any(Error),
        }),
        'Entity relationship storage failed',
      );
    });

    it('wipes stale entity_mentions even when new entities array is empty', async () => {
      // Post-S157 WP2: when re-classification produces 0 entities, any
      // stale rows from prior runs must still be deleted — the correct
      // state for "classifier extracted nothing now" is "zero rows",
      // not "whatever was there before". Entity_relationships follows
      // the old skip-on-empty rule since there is no equivalent stale-
      // data accumulation vector (relationships key off `source_document_id`
      // and are inserted, not upserted).
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

      const fromCalls = mockSupabase.from.mock.calls.map(
        (c: unknown[]) => c[0],
      );
      // entity_mentions IS called for the delete path.
      expect(fromCalls).toContain('entity_mentions');
      expect(mockSupabase._chain.delete).toHaveBeenCalled();
      // No entity_mentions upsert (no rows to insert) — entity rows are
      // ARRAY-shaped. ID-131 {131.17}: the record_embeddings upsert (a
      // single-object payload) still fires unconditionally per
      // classification run, so `_chain.upsert` itself IS called once; only
      // the array-shaped (entity) call is asserted absent here.
      const arrayShapedUpsertCalls =
        mockSupabase._chain.upsert.mock.calls.filter((call: unknown[]) =>
          Array.isArray(call[0]),
        );
      expect(arrayShapedUpsertCalls).toHaveLength(0);
      // entity_relationships is skipped entirely when the relationships
      // array is empty.
      expect(fromCalls).not.toContain('entity_relationships');
    });

    it('persists entity canonical_name values canonicalised and lowercased', async () => {
      const entitiesWithRawNames: ExtractedEntity[] = [
        { name: 'ISO27001', type: 'certification', canonical_name: 'ISO27001' },
        {
          name: 'cyber essentials',
          type: 'certification',
          canonical_name: 'cyber essentials',
        },
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

      const persisted = whereUpserted('entity_mentions');
      expect(persisted).toContainEqual(
        expect.objectContaining({ canonical_name: 'iso 27001' }), // lowercased for case-insensitive index
      );
      expect(persisted).toContainEqual(
        expect.objectContaining({ canonical_name: 'cyber essentials' }), // lowercased for case-insensitive index
      );
    });

    it('persists relationship source and target values canonicalised and lowercased', async () => {
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

      // S183 WP1 G1 — insert switched to upsert with ignoreDuplicates.
      expect(whereUpserted('entity_relationships')).toContainEqual(
        expect.objectContaining({
          source_entity: 'acme limited', // canonicalised + lowercased
          target_entity: 'iso 27001', // canonicalised + lowercased
        }),
      );
      expect(upsertOptions('entity_relationships')).toEqual(
        expect.objectContaining({
          onConflict:
            'source_entity,relationship_type,target_entity,source_document_id',
          ignoreDuplicates: true,
        }),
      );
    });

    // ── S158A Iteration 4 — ISO certification family type override ──
    //
    // Forces the six common ISO certification families to `certification`
    // uniformly at the storage layer, after canonicalise/alias/filter but
    // before the upsert. Aligned with taxonomy spec §3.1 "if ambiguous,
    // prefer certification" and the continuation prompt's deterministic
    // override recommendation. See `_ISO_CERTIFICATION_OVERRIDE` at module
    // top of lib/ai/classify.ts for the list and rationale.

    it.each([
      ['ISO 9001', 'iso 9001'],
      ['ISO 14001', 'iso 14001'],
      ['ISO 22301', 'iso 22301'],
      ['ISO 27001', 'iso 27001'],
      ['ISO 45001', 'iso 45001'],
      ['ISO 50001', 'iso 50001'],
    ])(
      'overrides %s typed as standard to certification',
      async (displayName, expectedCanonical) => {
        const misTyped: ExtractedEntity[] = [
          {
            name: displayName,
            type: 'standard',
            canonical_name: displayName,
          },
        ];

        mockCreate.mockResolvedValueOnce(
          createToolUseResponse({
            ...baseClassificationInput,
            entities: misTyped,
          }),
        );

        await classifyContent({
          supabase: mockSupabase as never,
          itemId: ITEM_ID,
          force: true,
          userId: USER_ID,
        });

        expect(whereUpserted('entity_mentions')).toContainEqual(
          expect.objectContaining({
            canonical_name: expectedCanonical,
            entity_type: 'certification',
          }),
        );
      },
    );

    it('leaves ISO 27001 unchanged when already typed as certification (no-op)', async () => {
      const correctlyTyped: ExtractedEntity[] = [
        {
          name: 'ISO 27001',
          type: 'certification',
          canonical_name: 'ISO 27001',
        },
      ];

      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: correctlyTyped,
        }),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(whereUpserted('entity_mentions')).toContainEqual(
        expect.objectContaining({
          canonical_name: 'iso 27001',
          entity_type: 'certification',
        }),
      );
    });

    it('does NOT override ISO 13485 (not in the certification override list)', async () => {
      const iso13485: ExtractedEntity[] = [
        {
          name: 'ISO 13485',
          type: 'standard',
          canonical_name: 'ISO 13485',
        },
      ];

      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: iso13485,
        }),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(whereUpserted('entity_mentions')).toContainEqual(
        expect.objectContaining({
          canonical_name: 'iso 13485',
          entity_type: 'standard', // NOT overridden
        }),
      );
    });

    it('does NOT override CREST (explicit exclusion — ambiguous body/credential)', async () => {
      const crest: ExtractedEntity[] = [
        { name: 'CREST', type: 'organisation', canonical_name: 'CREST' },
      ];

      mockCreate.mockResolvedValueOnce(
        createToolUseResponse({
          ...baseClassificationInput,
          entities: crest,
        }),
      );

      await classifyContent({
        supabase: mockSupabase as never,
        itemId: ITEM_ID,
        force: true,
        userId: USER_ID,
      });

      expect(whereUpserted('entity_mentions')).toContainEqual(
        expect.objectContaining({
          canonical_name: 'crest',
          entity_type: 'organisation', // NOT overridden
        }),
      );
    });
  });

  describe('cached classification does not include entities', () => {
    it('returns cached result without entities when item is already classified', async () => {
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: ITEM_ID,
          original_filename: 'Security Certs',
          filename: 'security-certs.md',
          extracted_text: '<p>Some content</p>',
          content_type: 'article',
          classified_at: '2026-03-01T00:00:00Z',
          primary_domain: 'SECURITY & COMPLIANCE',
          primary_subtopic: 'Certifications',
          secondary_domain: null,
          secondary_subtopic: null,
          ai_keywords: ['security'],
          summary: 'Summary',
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

// ──────────────────────────────────────────
// Call-site integration: coerceSubtopic wiring
// ──────────────────────────────────────────
// S161 follow-up from S159 WP4a adversarial verification finding §2.
// The existing coerceSubtopic tests exercise the helper in isolation.
// These tests prove the coercion is actually wired into classifyContent
// by mocking the Claude API to return empty subtopics and asserting the
// DB update payload normalises them to null.

describe('classifyContent — coerceSubtopic call-site wiring', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabaseClient();

    mockSupabase._chain.single.mockResolvedValue({
      data: {
        id: ITEM_ID,
        original_filename: 'Test Item',
        filename: 'test-item.md',
        extracted_text: '<p>Some content about security.</p>',
        content_type: 'article',
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
      },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    mockSupabase._chain.eq.mockReturnValue({
      ...mockSupabase._chain,
      then: vi.fn((resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null }),
      ),
    });
  });

  it('coerces empty primary_subtopic from classifier to null in DB update', async () => {
    mockCreate.mockResolvedValueOnce(
      createToolUseResponse({
        ...baseClassificationInput,
        primary_subtopic: '',
      }),
    );

    const result = await classifyContent({
      supabase: mockSupabase as never,
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
    });

    // The returned result should have null, not empty string
    expect(result.primary_subtopic).toBeNull();
  });

  it('coerces whitespace-only secondary_subtopic from classifier to null', async () => {
    mockCreate.mockResolvedValueOnce(
      createToolUseResponse({
        ...baseClassificationInput,
        secondary_subtopic: '   ',
      }),
    );

    const result = await classifyContent({
      supabase: mockSupabase as never,
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
    });

    expect(result.secondary_subtopic).toBeNull();
  });

  it('preserves valid subtopic values through the pipeline', async () => {
    mockCreate.mockResolvedValueOnce(
      createToolUseResponse({
        ...baseClassificationInput,
        primary_subtopic: 'Certifications',
      }),
    );

    const result = await classifyContent({
      supabase: mockSupabase as never,
      itemId: ITEM_ID,
      force: true,
      userId: USER_ID,
    });

    expect(result.primary_subtopic).toBe('Certifications');
  });
});

// ──────────────────────────────────────────
// Post-extraction entity quality filters
// ──────────────────────────────────────────

describe('entity quality filters', () => {
  describe('role title filter scope', () => {
    it('excludes role titles typed as person', () => {
      expect(
        shouldExcludeEntity({
          name: 'Managing Director',
          type: 'person',
          canonical_name: 'Managing Director',
        }),
      ).toBe(true);
    });

    it('excludes role titles typed as organisation', () => {
      expect(
        shouldExcludeEntity({
          name: 'Chief Technology Officer',
          type: 'organisation',
          canonical_name: 'Chief Technology Officer',
        }),
      ).toBe(true);
    });

    it('excludes role title acronyms regardless of entity type', () => {
      expect(
        shouldExcludeEntity({
          name: 'CEO',
          type: 'person',
          canonical_name: 'CEO',
        }),
      ).toBe(true);
      expect(
        shouldExcludeEntity({
          name: 'DPO',
          type: 'organisation',
          canonical_name: 'DPO',
        }),
      ).toBe(true);
    });

    it('does not exclude actual person names', () => {
      expect(
        shouldExcludeEntity({
          name: 'John Smith',
          type: 'person',
          canonical_name: 'John Smith',
        }),
      ).toBe(false);
    });
  });

  describe('social issues excluded as generic concepts', () => {
    const socialIssues = [
      'county lines',
      'county lines criminal exploitation',
      'female genital mutilation',
      'child sexual exploitation',
      'child criminal exploitation',
      'domestic abuse',
      'modern slavery',
      'radicalisation',
      'forced marriage',
      'honour-based violence',
    ];

    for (const issue of socialIssues) {
      it(`excludes "${issue}" as generic concept`, () => {
        expect(isGenericConcept(issue)).toBe(true);
      });
    }
  });

  describe('generic methodology approaches excluded', () => {
    const approaches = [
      'risk-based approach',
      'iterative development',
      'best practice',
      'best practices',
      'agile approach',
    ];

    for (const approach of approaches) {
      it(`excludes "${approach}" as generic concept`, () => {
        expect(isGenericConcept(approach)).toBe(true);
      });
    }
  });

  describe('SAML not excluded from protocol formats', () => {
    it('does not treat SAML as a protocol/format', () => {
      expect(isProtocolOrFormat('saml')).toBe(false);
      expect(isProtocolOrFormat('SAML')).toBe(false);
    });

    it('still excludes actual protocols', () => {
      expect(isProtocolOrFormat('https')).toBe(true);
      expect(isProtocolOrFormat('oauth')).toBe(true);
    });
  });

  describe('person descriptive string stripping', () => {
    it('strips parenthetical role/company from person names', () => {
      expect(
        stripPersonDescriptors('Matthew (MD, Example Client Limited)'),
      ).toBe('Matthew');
    });

    it('strips parenthetical role only', () => {
      expect(stripPersonDescriptors('Sarah (Director)')).toBe('Sarah');
    });

    it('leaves names without parentheticals unchanged', () => {
      expect(stripPersonDescriptors('John Smith')).toBe('John Smith');
    });

    it('only strips trailing parentheticals', () => {
      expect(stripPersonDescriptors('Smith (John) Williams')).toBe(
        'Smith (John) Williams',
      );
    });
  });

  describe('framework lot numbers excluded as projects', () => {
    it('excludes G-Cloud lot numbers', () => {
      expect(isFrameworkLot('G-Cloud Lot 1')).toBe(true);
      expect(isFrameworkLot('G-Cloud Lot 2')).toBe(true);
      expect(isFrameworkLot('g-cloud lot 3')).toBe(true);
    });

    it('excludes DOS lot numbers', () => {
      expect(isFrameworkLot('DOS Lot 1')).toBe(true);
      expect(isFrameworkLot('Digital Outcomes Lot 2')).toBe(true);
      expect(isFrameworkLot('Digital Specialists 1')).toBe(true);
    });

    it('only filters when entity type is project', () => {
      // Framework lot filter is type-gated to project in shouldExcludeEntity
      expect(
        shouldExcludeEntity({
          name: 'G-Cloud Lot 1',
          type: 'project',
          canonical_name: 'G-Cloud Lot 1',
        }),
      ).toBe(true);
      expect(
        shouldExcludeEntity({
          name: 'G-Cloud Lot 1',
          type: 'framework',
          canonical_name: 'G-Cloud Lot 1',
        }),
      ).toBe(false);
    });

    it('does not exclude real project names', () => {
      expect(isFrameworkLot('Cloud Migration Project')).toBe(false);
    });
  });

  describe('compound entities excluded', () => {
    it('excludes slash-separated compound entities', () => {
      expect(isCompoundEntity('ISO 27001/ISO 9001')).toBe(true);
      expect(isCompoundEntity('ISO 27001/ISO 9001/ISO 14001')).toBe(true);
    });

    it('does not exclude names with very short parts', () => {
      expect(isCompoundEntity('A/B')).toBe(false);
    });

    it('does not exclude names without slashes', () => {
      expect(isCompoundEntity('ISO 27001')).toBe(false);
    });

    it('excludes via shouldExcludeEntity', () => {
      expect(
        shouldExcludeEntity({
          name: 'ISO 27001/ISO 9001',
          type: 'certification',
          canonical_name: 'ISO 27001/ISO 9001',
        }),
      ).toBe(true);
    });
  });
});
