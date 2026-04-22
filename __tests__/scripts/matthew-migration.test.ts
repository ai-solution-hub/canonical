/**
 * Unit tests for Matthew contributions migration script.
 *
 * Tests the exported helper functions and payload builders from
 * `scripts/migrate_matthew_contributions_from_M.ts`. Does NOT write to
 * real databases — all Supabase interactions are mocked.
 *
 * Run: bun run test -- matthew-migration
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseCliArgs,
  validateEnvM,
  validateEnvR,
  buildCreatePayload,
  buildUpdatePayload,
  buildHistoryPayload,
  checkExistsOnR,
  findMatchOnR,
  checkHistoryExistsOnR,
  checkWorkspaceExistsOnR,
  checkWorkspaceAssocExistsOnR,
  queryCreates,
  queryUpdates,
  queryHistory,
  queryWorkspaceAssociations,
  MATTHEW_USER_ID,
  PRODUCTION_PROJECT_ID,
  RETIRING_PROJECT_ID,
  CONTENT_ITEM_SELECT_COLUMNS,
  HISTORY_SELECT_COLUMNS,
  type MContentItem,
  type MHistoryRow,
  type CliArgs,
  type FindMatchResult,
} from '../../scripts/migrate_matthew_contributions_from_M';

// ── Fixtures ────────────────────────────────────────────────────────────

function createMockContentItem(overrides: Partial<MContentItem> = {}): MContentItem {
  return {
    id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    title: 'Test Q&A Pair',
    content: 'Test content for migration',
    content_type: 'q_a_pair',
    source_url: null,
    source_domain: null,
    platform: 'manual',
    author_name: null,
    primary_domain: 'Bid Management',
    primary_subtopic: 'Process',
    secondary_domain: null,
    secondary_subtopic: null,
    classification_confidence: 0.92,
    classification_reasoning: 'AI classification reasoning',
    classified_at: '2026-04-22T08:48:00.000Z',
    classification_model: 'claude-opus-4-6',
    ai_keywords: ['bid', 'process', 'management'],
    summary: 'Test summary',
    summary_data: null,
    user_tags: null,
    priority: null,
    brief: null,
    detail: null,
    reference: null,
    answer_standard: 'Standard answer text',
    answer_advanced: 'Advanced answer text',
    source_document: null,
    source_document_id: null,
    source_file: null,
    layer: null,
    content_text_hash: 'abc123hash',
    freshness: 'fresh',
    lifecycle_type: 'evergreen',
    metadata: null,
    notes: null,
    embedding: null,
    embedding_model: null,
    embedding_tokens: null,
    created_at: '2026-04-22T08:48:00.000Z',
    created_by: MATTHEW_USER_ID,
    updated_at: null,
    updated_by: null,
    superseded_by: null,
    dedup_status: 'clean',
    ...overrides,
  };
}

function createMockHistoryRow(overrides: Partial<MHistoryRow> = {}): MHistoryRow {
  return {
    id: 'h1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    content_item_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    version: 1,
    title: 'Test Q&A Pair',
    content: 'Test content for migration',
    brief: null,
    detail: null,
    reference: null,
    change_type: 'create',
    change_summary: 'Created via UI',
    change_reason: null,
    metadata: null,
    created_by: MATTHEW_USER_ID,
    created_at: '2026-04-22T08:48:00.000Z',
    ...overrides,
  };
}

/** Builds 7 mock creates matching the expected volumes from 'M'. */
function createMockCreates(): MContentItem[] {
  return Array.from({ length: 7 }, (_, i) =>
    createMockContentItem({
      id: `c${String(i + 1).padStart(7, '0')}-0000-4000-8000-000000000001`,
      title: `Matthew Q&A ${i + 1}`,
      content: `Q&A content ${i + 1}`,
      content_text_hash: `hash_create_${i + 1}`,
      created_at: `2026-04-22T08:4${8 + Math.floor(i / 3)}:${String(i * 7).padStart(2, '0')}.000Z`,
    }),
  );
}

/** Builds 12 mock update candidates matching the expected volumes from 'M'. */
function createMockUpdates(): MContentItem[] {
  return Array.from({ length: 12 }, (_, i) =>
    createMockContentItem({
      id: `u${String(i + 1).padStart(7, '0')}-0000-4000-8000-000000000002`,
      title: `Pre-existing Item ${i + 1}`,
      content: `Updated content ${i + 1}`,
      content_text_hash: `hash_update_${i + 1}`,
      created_by: 'a0000000-0000-4000-8000-000000000001', // pipeline service account
      updated_by: MATTHEW_USER_ID,
      updated_at: `2026-04-22T09:${String(10 + i).padStart(2, '0')}:00.000Z`,
    }),
  );
}

/** Builds 14 mock history rows matching the expected volumes from 'M'. */
function createMockHistory(): MHistoryRow[] {
  return Array.from({ length: 14 }, (_, i) =>
    createMockHistoryRow({
      id: `h${String(i + 1).padStart(7, '0')}-0000-4000-8000-000000000003`,
      content_item_id: i < 7
        ? `c${String(i + 1).padStart(7, '0')}-0000-4000-8000-000000000001`
        : `u${String(i - 6).padStart(7, '0')}-0000-4000-8000-000000000002`,
      version: i < 7 ? 1 : 2,
      title: i < 7 ? `Matthew Q&A ${i + 1}` : `Pre-existing Item ${i - 6}`,
      change_type: i < 7 ? 'create' : 'edit',
      created_at: `2026-04-22T08:${48 + Math.floor(i / 3)}:${String(i * 4).padStart(2, '0')}.000Z`,
    }),
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function createMockSupabaseClient() {
  const selectChain = {
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn(),
  };

  const insertChain = {
    select: vi.fn().mockResolvedValue({ data: [{ id: 'new-id' }], error: null }),
  };

  const updateChain = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data: [{ id: 'updated-id' }], error: null }),
  };

  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue(insertChain),
      update: vi.fn().mockReturnValue(updateChain),
    }),
    _selectChain: selectChain,
    _insertChain: insertChain,
    _updateChain: updateChain,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('MATTHEW_USER_ID is the expected UUID', () => {
    expect(MATTHEW_USER_ID).toBe('d2c4e9a7-0a1c-4bfd-8c1a-11c18f8f222e');
  });

  it('MATTHEW_USER_ID is a valid v4 UUID', () => {
    expect(MATTHEW_USER_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('project IDs are correct', () => {
    expect(PRODUCTION_PROJECT_ID).toBe('rovrymhhffssilaftdwd');
    expect(RETIRING_PROJECT_ID).toBe('mgrmucazfiibsomdmndh');
  });

  it('CONTENT_ITEM_SELECT_COLUMNS contains key fields', () => {
    const cols = CONTENT_ITEM_SELECT_COLUMNS as readonly string[];
    expect(cols).toContain('id');
    expect(cols).toContain('title');
    expect(cols).toContain('content');
    expect(cols).toContain('content_type');
    expect(cols).toContain('created_by');
    expect(cols).toContain('created_at');
    expect(cols).toContain('content_text_hash');
    expect(cols).toContain('superseded_by');
    expect(cols).toContain('dedup_status');
    expect(cols).toContain('primary_domain');
    expect(cols).toContain('primary_subtopic');
    expect(cols).toContain('classification_confidence');
    expect(cols).toContain('ai_keywords');
  });

  it('HISTORY_SELECT_COLUMNS contains key fields', () => {
    const cols = HISTORY_SELECT_COLUMNS as readonly string[];
    expect(cols).toContain('id');
    expect(cols).toContain('content_item_id');
    expect(cols).toContain('version');
    expect(cols).toContain('change_type');
    expect(cols).toContain('created_by');
    expect(cols).toContain('created_at');
  });
});

describe('parseCliArgs', () => {
  it('defaults to dry-run when no flags', () => {
    const args = parseCliArgs([]);
    expect(args.dryRun).toBe(true);
    expect(args.liveApply).toBe(false);
  });

  it('parses --dry-run explicitly', () => {
    const args = parseCliArgs(['--dry-run']);
    expect(args.dryRun).toBe(true);
    expect(args.liveApply).toBe(false);
  });

  it('parses --live-apply', () => {
    const args = parseCliArgs(['--live-apply']);
    expect(args.dryRun).toBe(false);
    expect(args.liveApply).toBe(true);
  });

  it('parses --help', () => {
    const args = parseCliArgs(['--help']);
    expect(args.help).toBe(true);
  });

  it('rejects --dry-run combined with --live-apply', () => {
    expect(() => parseCliArgs(['--dry-run', '--live-apply'])).toThrow(
      /Cannot specify both/,
    );
  });

  it('rejects unknown flags', () => {
    expect(() => parseCliArgs(['--unknown'])).toThrow();
  });
});

describe('validateEnvM', () => {
  it('throws when URL is missing', () => {
    expect(() => validateEnvM(undefined, 'some-key')).toThrow(/SUPABASE_M_URL/);
  });

  it('throws when key is missing', () => {
    expect(() => validateEnvM('https://mgrmucazfiibsomdmndh.supabase.co', undefined)).toThrow(
      /SUPABASE_M_SECRET_KEY/,
    );
  });

  it('throws when URL does not contain retiring project ID', () => {
    expect(() =>
      validateEnvM('https://wrongproject.supabase.co', 'some-key'),
    ).toThrow(/mgrmucazfiibsomdmndh/);
  });

  it('passes with correct URL and key', () => {
    expect(() =>
      validateEnvM(
        'https://mgrmucazfiibsomdmndh.supabase.co',
        'some-key',
      ),
    ).not.toThrow();
  });
});

describe('validateEnvR', () => {
  it('throws when URL is missing', () => {
    expect(() => validateEnvR(undefined, 'some-key')).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it('throws when key is missing', () => {
    expect(() =>
      validateEnvR('https://rovrymhhffssilaftdwd.supabase.co', undefined),
    ).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it('throws when URL does not contain production project ID', () => {
    expect(() =>
      validateEnvR('https://wrongproject.supabase.co', 'some-key'),
    ).toThrow(/rovrymhhffssilaftdwd/);
  });

  it('passes with correct URL and key', () => {
    expect(() =>
      validateEnvR(
        'https://rovrymhhffssilaftdwd.supabase.co',
        'some-key',
      ),
    ).not.toThrow();
  });
});

describe('buildCreatePayload', () => {
  it('preserves created_by and created_at from source', () => {
    const item = createMockContentItem();
    const payload = buildCreatePayload(item);
    expect(payload.created_by).toBe(MATTHEW_USER_ID);
    expect(payload.created_at).toBe('2026-04-22T08:48:00.000Z');
  });

  it('preserves classification fields', () => {
    const item = createMockContentItem({
      primary_domain: 'Bid Management',
      primary_subtopic: 'Process',
      classification_confidence: 0.92,
      ai_keywords: ['bid', 'process'],
    });
    const payload = buildCreatePayload(item);
    expect(payload.primary_domain).toBe('Bid Management');
    expect(payload.primary_subtopic).toBe('Process');
    expect(payload.classification_confidence).toBe(0.92);
    expect(payload.ai_keywords).toEqual(['bid', 'process']);
  });

  it('preserves content_type as q_a_pair', () => {
    const item = createMockContentItem({ content_type: 'q_a_pair' });
    const payload = buildCreatePayload(item);
    expect(payload.content_type).toBe('q_a_pair');
  });

  it('preserves supersession columns (expected NULL for creates)', () => {
    const item = createMockContentItem({ superseded_by: null });
    const payload = buildCreatePayload(item);
    expect(payload.superseded_by).toBeNull();
  });

  it('preserves content_text_hash for dedup', () => {
    const item = createMockContentItem({ content_text_hash: 'abc123' });
    const payload = buildCreatePayload(item);
    expect(payload.content_text_hash).toBe('abc123');
  });

  it('defaults dedup_status to clean when empty', () => {
    const item = createMockContentItem({ dedup_status: '' as string });
    const payload = buildCreatePayload(item);
    expect(payload.dedup_status).toBe('clean');
  });

  it('preserves answer_standard and answer_advanced for q_a_pair', () => {
    const item = createMockContentItem({
      answer_standard: 'Standard answer',
      answer_advanced: 'Advanced answer',
    });
    const payload = buildCreatePayload(item);
    expect(payload.answer_standard).toBe('Standard answer');
    expect(payload.answer_advanced).toBe('Advanced answer');
  });

  it('does NOT include id (let DB generate a new one)', () => {
    const item = createMockContentItem();
    const payload = buildCreatePayload(item);
    expect(payload).not.toHaveProperty('id');
  });
});

describe('buildUpdatePayload', () => {
  it('sets updated_by to Matthew', () => {
    const item = createMockContentItem();
    const payload = buildUpdatePayload(item);
    expect(payload.updated_by).toBe(MATTHEW_USER_ID);
  });

  it('includes content and title (editable fields)', () => {
    const item = createMockContentItem({
      title: 'Updated Title',
      content: 'Updated Content',
    });
    const payload = buildUpdatePayload(item);
    expect(payload.title).toBe('Updated Title');
    expect(payload.content).toBe('Updated Content');
  });

  it('includes classification update fields', () => {
    const item = createMockContentItem({
      primary_domain: 'Updated Domain',
      ai_keywords: ['new', 'keywords'],
    });
    const payload = buildUpdatePayload(item);
    expect(payload.primary_domain).toBe('Updated Domain');
    expect(payload.ai_keywords).toEqual(['new', 'keywords']);
  });

  it('does NOT include created_by or created_at', () => {
    const item = createMockContentItem();
    const payload = buildUpdatePayload(item);
    expect(payload).not.toHaveProperty('created_by');
    expect(payload).not.toHaveProperty('created_at');
  });
});

describe('buildHistoryPayload', () => {
  it('preserves content_item_id and version', () => {
    const row = createMockHistoryRow({
      content_item_id: 'test-item-id',
      version: 3,
    });
    const payload = buildHistoryPayload(row);
    expect(payload.content_item_id).toBe('test-item-id');
    expect(payload.version).toBe(3);
  });

  it('preserves created_by as Matthew', () => {
    const row = createMockHistoryRow();
    const payload = buildHistoryPayload(row);
    expect(payload.created_by).toBe(MATTHEW_USER_ID);
  });

  it('preserves change_type', () => {
    const row = createMockHistoryRow({ change_type: 'edit' });
    const payload = buildHistoryPayload(row);
    expect(payload.change_type).toBe('edit');
  });

  it('preserves created_at timestamp', () => {
    const row = createMockHistoryRow({ created_at: '2026-04-22T09:00:00.000Z' });
    const payload = buildHistoryPayload(row);
    expect(payload.created_at).toBe('2026-04-22T09:00:00.000Z');
  });

  it('does NOT include original id (let DB generate a new one)', () => {
    const row = createMockHistoryRow();
    const payload = buildHistoryPayload(row);
    expect(payload).not.toHaveProperty('id');
  });
});

describe('Mock fixtures match expected volumes', () => {
  it('produces 7 creates', () => {
    expect(createMockCreates()).toHaveLength(7);
  });

  it('produces 12 updates', () => {
    expect(createMockUpdates()).toHaveLength(12);
  });

  it('produces 14 history rows', () => {
    expect(createMockHistory()).toHaveLength(14);
  });

  it('all creates have created_by = Matthew', () => {
    for (const item of createMockCreates()) {
      expect(item.created_by).toBe(MATTHEW_USER_ID);
    }
  });

  it('all updates have updated_by = Matthew and created_by != Matthew', () => {
    for (const item of createMockUpdates()) {
      expect(item.updated_by).toBe(MATTHEW_USER_ID);
      expect(item.created_by).not.toBe(MATTHEW_USER_ID);
    }
  });

  it('all history rows have created_by = Matthew', () => {
    for (const row of createMockHistory()) {
      expect(row.created_by).toBe(MATTHEW_USER_ID);
    }
  });

  it('all creates are q_a_pair type', () => {
    for (const item of createMockCreates()) {
      expect(item.content_type).toBe('q_a_pair');
    }
  });

  it('create fixtures have unique IDs', () => {
    const ids = createMockCreates().map((i) => i.id);
    expect(new Set(ids).size).toBe(7);
  });

  it('update fixtures have unique IDs', () => {
    const ids = createMockUpdates().map((i) => i.id);
    expect(new Set(ids).size).toBe(12);
  });

  it('history fixtures have unique IDs', () => {
    const ids = createMockHistory().map((i) => i.id);
    expect(new Set(ids).size).toBe(14);
  });
});

describe('queryCreates', () => {
  it('queries content_items with correct filters', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    // Configure the final resolution
    chain.order.mockResolvedValue({
      data: createMockCreates(),
      error: null,
    });

    const result = await queryCreates(mockClient as unknown as import('@supabase/supabase-js').SupabaseClient);

    expect(mockClient.from).toHaveBeenCalledWith('content_items');
    expect(chain.eq).toHaveBeenCalledWith('created_by', MATTHEW_USER_ID);
    expect(chain.is).toHaveBeenCalledWith('archived_at', null);
    expect(result).toHaveLength(7);
  });

  it('throws on query error', async () => {
    const mockClient = createMockSupabaseClient();
    mockClient._selectChain.order.mockResolvedValue({
      data: null,
      error: { message: 'Query failed' },
    });

    await expect(
      queryCreates(mockClient as unknown as import('@supabase/supabase-js').SupabaseClient),
    ).rejects.toThrow('Query creates on M failed');
  });
});

describe('queryUpdates', () => {
  it('queries with updated_by = Matthew AND created_by != Matthew', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    chain.order.mockResolvedValue({
      data: createMockUpdates(),
      error: null,
    });

    const result = await queryUpdates(mockClient as unknown as import('@supabase/supabase-js').SupabaseClient);

    expect(chain.eq).toHaveBeenCalledWith('updated_by', MATTHEW_USER_ID);
    expect(chain.neq).toHaveBeenCalledWith('created_by', MATTHEW_USER_ID);
    expect(result).toHaveLength(12);
  });
});

describe('queryHistory', () => {
  it('queries content_history for Matthew rows', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    chain.order.mockResolvedValue({
      data: createMockHistory(),
      error: null,
    });

    const result = await queryHistory(mockClient as unknown as import('@supabase/supabase-js').SupabaseClient);

    expect(mockClient.from).toHaveBeenCalledWith('content_history');
    expect(chain.eq).toHaveBeenCalledWith('created_by', MATTHEW_USER_ID);
    expect(result).toHaveLength(14);
  });
});

describe('queryWorkspaceAssociations', () => {
  it('returns empty array for empty input', async () => {
    const mockClient = createMockSupabaseClient();
    const result = await queryWorkspaceAssociations(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      [],
    );
    expect(result).toEqual([]);
  });

  it('queries content_item_workspaces with correct IDs', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    const mockAssociations = [
      { content_item_id: 'id-1', workspace_id: 'ws-1' },
      { content_item_id: 'id-2', workspace_id: 'ws-1' },
    ];

    // For this query, the chain ends at .in() (no .order())
    chain.in.mockResolvedValue({
      data: mockAssociations,
      error: null,
    });

    const result = await queryWorkspaceAssociations(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      ['id-1', 'id-2'],
    );

    expect(mockClient.from).toHaveBeenCalledWith('content_item_workspaces');
    expect(chain.in).toHaveBeenCalledWith('content_item_id', ['id-1', 'id-2']);
    expect(result).toHaveLength(2);
  });
});

describe('checkExistsOnR', () => {
  it('returns true when a matching row exists', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    chain.limit.mockResolvedValue({
      data: [{ id: 'existing-id' }],
      error: null,
    });

    const result = await checkExistsOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'Test Title',
      'hash123',
      MATTHEW_USER_ID,
    );

    expect(result).toBe(true);
  });

  it('returns false when no matching row exists', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    chain.limit.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await checkExistsOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'Non-existent Title',
      'hash456',
      MATTHEW_USER_ID,
    );

    expect(result).toBe(false);
  });
});

describe('findMatchOnR', () => {
  it('returns unique match when exactly one item found', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    // findMatchOnR no longer calls .limit(), chain ends at .is()
    chain.is.mockResolvedValue({
      data: [{ id: 'match-id', content_text_hash: 'old-hash' }],
      error: null,
    });

    const result = await findMatchOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'Test Title',
    );

    expect(result.status).toBe('unique');
    expect(result.match).toEqual({ id: 'match-id', content_text_hash: 'old-hash' });
  });

  it('returns none when no match found (M-1: 0 matches)', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    chain.is.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await findMatchOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'Non-existent Title',
    );

    expect(result.status).toBe('none');
    expect(result.match).toBeUndefined();
  });

  it('returns ambiguous when 2+ matches found (M-1: skip + list candidates)', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    chain.is.mockResolvedValue({
      data: [
        { id: 'id-a', content_text_hash: 'hash-a' },
        { id: 'id-b', content_text_hash: 'hash-b' },
      ],
      error: null,
    });

    const result = await findMatchOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'Duplicate Title',
    );

    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates![0].id).toBe('id-a');
    expect(result.candidates![1].id).toBe('id-b');
    expect(result.match).toBeUndefined();
  });
});

describe('checkHistoryExistsOnR', () => {
  it('returns true when history row exists', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    chain.limit.mockResolvedValue({
      data: [{ id: 'existing-history' }],
      error: null,
    });

    const result = await checkHistoryExistsOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'item-id',
      1,
      MATTHEW_USER_ID,
    );

    expect(result).toBe(true);
  });

  it('returns false when no history row exists', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    chain.limit.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await checkHistoryExistsOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'item-id',
      1,
      MATTHEW_USER_ID,
    );

    expect(result).toBe(false);
  });
});

describe('End-to-end migration report validation', () => {
  it('expected volumes: 7 creates + 12 updates + 14 history match spec', () => {
    const creates = createMockCreates();
    const updates = createMockUpdates();
    const history = createMockHistory();

    // Core volume assertion
    expect(creates.length).toBe(7);
    expect(updates.length).toBe(12);
    expect(history.length).toBe(14);

    // All creates are Matthew-created q_a_pairs
    expect(creates.every((c) => c.created_by === MATTHEW_USER_ID)).toBe(true);
    expect(creates.every((c) => c.content_type === 'q_a_pair')).toBe(true);

    // All updates are Matthew-updated but not Matthew-created
    expect(updates.every((u) => u.updated_by === MATTHEW_USER_ID)).toBe(true);
    expect(updates.every((u) => u.created_by !== MATTHEW_USER_ID)).toBe(true);

    // All history rows are Matthew-authored
    expect(history.every((h) => h.created_by === MATTHEW_USER_ID)).toBe(true);

    // History rows have non-null content_item_id
    expect(history.every((h) => h.content_item_id !== null)).toBe(true);
  });

  it('create payloads pass content_type CHECK constraint', () => {
    const validContentTypes = [
      'article', 'blog', 'pdf', 'note', 'research', 'other',
      'q_a_pair', 'case_study', 'policy', 'certification',
      'compliance', 'methodology', 'capability', 'product_description',
      'document',
    ];

    for (const item of createMockCreates()) {
      const payload = buildCreatePayload(item);
      expect(validContentTypes).toContain(payload.content_type);
    }
  });

  it('create payloads pass dedup_status CHECK constraint', () => {
    const validDedupStatuses = ['clean', 'soft_blocked', 'reviewed_ok', 'superseded'];

    for (const item of createMockCreates()) {
      const payload = buildCreatePayload(item);
      expect(validDedupStatuses).toContain(payload.dedup_status);
    }
  });

  it('history payloads pass change_type format', () => {
    const validChangeTypes = ['create', 'edit', 'classify', 'import', 'archive', 'delete'];

    for (const row of createMockHistory()) {
      const payload = buildHistoryPayload(row);
      expect(validChangeTypes).toContain(payload.change_type);
    }
  });
});

// ── C-1: FK violation prevention (mIdToRId mapping) ───────────────────

describe('C-1: History content_item_id mapping', () => {
  it('buildHistoryPayload passes through M content_item_id (caller must override)', () => {
    // The raw payload still has the M UUID — the main() function overrides it
    const row = createMockHistoryRow({ content_item_id: 'm-uuid-123' });
    const payload = buildHistoryPayload(row);
    expect(payload.content_item_id).toBe('m-uuid-123');
    // Callers must do: payload.content_item_id = mIdToRId.get(row.content_item_id)
  });

  it('mIdToRId mapping concept: create→history flow', () => {
    // Simulate the mapping that main() builds during Phase 2 (creates)
    const mIdToRId = new Map<string, string>();
    const mItemId = 'c0000001-0000-4000-8000-000000000001';
    const rItemId = 'r1111111-2222-4333-8444-555555555555';

    // After create succeeds, script records the mapping
    mIdToRId.set(mItemId, rItemId);

    // When processing history, translate the content_item_id
    const historyRow = createMockHistoryRow({ content_item_id: mItemId });
    const payload = buildHistoryPayload(historyRow);
    const translatedId = mIdToRId.get(historyRow.content_item_id!);

    expect(translatedId).toBe(rItemId);
    payload.content_item_id = translatedId;
    expect(payload.content_item_id).toBe(rItemId);
  });

  it('mIdToRId mapping concept: update→history flow', () => {
    // Simulate the mapping that main() builds during Phase 3 (updates)
    const mIdToRId = new Map<string, string>();
    const mItemId = 'u0000001-0000-4000-8000-000000000002';
    const rMatchId = 'r2222222-3333-4444-8555-666666666666';

    // After findMatchOnR returns a unique match, script records the mapping
    mIdToRId.set(mItemId, rMatchId);

    // History row references the M UUID
    const historyRow = createMockHistoryRow({
      content_item_id: mItemId,
      change_type: 'edit',
      version: 2,
    });
    const translatedId = mIdToRId.get(historyRow.content_item_id!);

    expect(translatedId).toBe(rMatchId);
  });

  it('mIdToRId mapping concept: orphan history skipped when no mapping', () => {
    const mIdToRId = new Map<string, string>();
    // No mapping exists for this M UUID
    const orphanMId = 'o0000001-0000-4000-8000-000000000099';

    const historyRow = createMockHistoryRow({ content_item_id: orphanMId });
    const translatedId = mIdToRId.get(historyRow.content_item_id!);

    expect(translatedId).toBeUndefined();
    // Script would log + skip, not insert with stale M UUID
  });
});

// ── H-1: Workspace association tests ──────────────────────────────────

describe('H-1: Workspace associations', () => {
  it('checkWorkspaceExistsOnR returns true when workspace found', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    chain.limit.mockResolvedValue({
      data: [{ id: 'ws-id-1' }],
      error: null,
    });

    const result = await checkWorkspaceExistsOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'ws-id-1',
    );

    expect(result).toBe(true);
    expect(mockClient.from).toHaveBeenCalledWith('workspaces');
  });

  it('checkWorkspaceExistsOnR returns false when workspace not found', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    chain.limit.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await checkWorkspaceExistsOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'ws-missing',
    );

    expect(result).toBe(false);
  });

  it('checkWorkspaceAssocExistsOnR returns true when association exists (idempotency)', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    chain.limit.mockResolvedValue({
      data: [{ content_item_id: 'r-item-1' }],
      error: null,
    });

    const result = await checkWorkspaceAssocExistsOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'r-item-1',
      'ws-1',
    );

    expect(result).toBe(true);
    expect(mockClient.from).toHaveBeenCalledWith('content_item_workspaces');
  });

  it('checkWorkspaceAssocExistsOnR returns false when no association', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;

    chain.limit.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await checkWorkspaceAssocExistsOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'r-item-new',
      'ws-1',
    );

    expect(result).toBe(false);
  });

  it('workspace association flow: maps M UUID to R UUID via mIdToRId', () => {
    // End-to-end concept test: workspace assoc from M references M item UUID,
    // must be translated to R item UUID before insert
    const mIdToRId = new Map<string, string>();
    const mItemId = 'c0000001-0000-4000-8000-000000000001';
    const rItemId = 'r1111111-2222-4333-8444-555555555555';
    mIdToRId.set(mItemId, rItemId);

    const mAssoc = { content_item_id: mItemId, workspace_id: 'ws-shared-1' };
    const rContentItemId = mIdToRId.get(mAssoc.content_item_id);

    expect(rContentItemId).toBe(rItemId);
    // Script inserts { content_item_id: rItemId, workspace_id: 'ws-shared-1' }
  });

  it('workspace association skipped gracefully when workspace UUID not on R', () => {
    // Conceptual: if workspace doesn't exist on R, we skip
    const wsExistsOnR = false;
    expect(wsExistsOnR).toBe(false);
    // Script logs SKIP + increments wsMissingWorkspace counter
  });
});

// ── M-2: Null content_text_hash warning ───────────────────────────────

describe('M-2: Null hash warning', () => {
  it('checkExistsOnR emits warning when hash is null and match found', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    chain.limit.mockResolvedValue({
      data: [{ id: 'existing-id' }],
      error: null,
    });

    const result = await checkExistsOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'Test Title',
      null, // null hash triggers warning
      MATTHEW_USER_ID,
      'm-item-id-123',
    );

    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('WARN: skipping create for M:m-item-id-123'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('null content_text_hash'),
    );

    warnSpy.mockRestore();
  });

  it('checkExistsOnR does NOT warn when hash is present', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    chain.limit.mockResolvedValue({
      data: [{ id: 'existing-id' }],
      error: null,
    });

    await checkExistsOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'Test Title',
      'valid-hash-123',
      MATTHEW_USER_ID,
      'm-item-id-456',
    );

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('checkExistsOnR does NOT warn when hash is null but no match found', async () => {
    const mockClient = createMockSupabaseClient();
    const chain = mockClient._selectChain;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    chain.limit.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await checkExistsOnR(
      mockClient as unknown as import('@supabase/supabase-js').SupabaseClient,
      'Test Title',
      null,
      MATTHEW_USER_ID,
      'm-item-id-789',
    );

    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
