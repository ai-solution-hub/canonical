/**
 * Digest Content Suggestions Integration Tests
 *
 * Tests that the digest generation integrates content suggestions
 * from the suggestion engine and includes them in the prompt and
 * stored metadata.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

// Mock content suggestions engine
const mockGenerateContentSuggestions = vi.fn();
vi.mock('@/lib/content/content-suggestions', () => ({
  generateContentSuggestions: (...args: unknown[]) =>
    mockGenerateContentSuggestions(...args),
}));

// Mock Anthropic client
const mockCreate = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: vi.fn(() => ({
    messages: { create: (...args: unknown[]) => mockCreate(...args) },
  })),
  getAIModel: vi.fn(() => 'claude-sonnet-4-6'),
}));

// Mock AI parse
vi.mock('@/lib/ai-parse', () => ({
  extractToolResult: vi.fn((_response: unknown, _toolName: string) => ({
    domain_summaries: [
      {
        domain: 'Technology',
        summary: 'A strong week for technology content.',
        key_themes: ['AI', 'Cloud'],
        top_items: [],
      },
    ],
    narrative_summary: 'You captured 3 items this week.',
    content_opportunities: [
      {
        domain: 'Compliance',
        subtopic: 'ISO 27001',
        suggestion:
          'Create a policy document covering ISO 27001 certification scope.',
        priority: 'high',
      },
    ],
  })),
}));

// Suppress console output
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------

import { generateChangeReport } from '@/lib/ai/change-reports';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

// ID-131 {131.19} G-GOV-FACET: content_items is dying — generateChangeReport
// now selects from source_documents, which has no direct `title` column;
// `filename` is fetched instead and `title` is derived in-code as
// `suggested_title ?? filename`. Fixture shape follows the real select list.
const MOCK_CONTENT_ITEMS = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    filename: 'ai-strategy-guide.pdf',
    suggested_title: 'AI Strategy Guide',
    summary: 'Overview of AI strategy',
    primary_domain: 'Technology',
    primary_subtopic: 'AI',
    content_type: 'article',
    ai_keywords: ['AI', 'strategy'],
    captured_date: '2026-03-20T10:00:00Z',
    summary_data: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    filename: 'cloud-migration-plan.pdf',
    suggested_title: 'Cloud Migration Plan',
    summary: 'Cloud migration best practices',
    primary_domain: 'Technology',
    primary_subtopic: 'Cloud',
    content_type: 'guide',
    ai_keywords: ['cloud', 'migration'],
    captured_date: '2026-03-21T10:00:00Z',
    summary_data: null,
  },
];

const MOCK_SUGGESTIONS = [
  {
    id: 'sug-1',
    suggestion_type: 'empty_subtopic',
    priority: 'critical',
    domain: 'Compliance',
    subtopic: 'ISO 27001',
    title: 'No content for ISO 27001',
    description:
      'Compliance has an active procurement but zero content for ISO 27001.',
    item_count: 0,
  },
  {
    id: 'sug-2',
    suggestion_type: 'thin_coverage',
    priority: 'medium',
    domain: 'Technology',
    subtopic: 'DevOps',
    title: 'Thin coverage for DevOps',
    description: 'Technology / DevOps has only 1 item.',
    item_count: 1,
  },
];

const MOCK_INSERT_RESULT = {
  id: 'digest-001',
  frequency: 'weekly',
  period_start: '2026-03-15T00:00:00.000Z',
  period_end: '2026-03-22T23:59:59.999Z',
  item_count: 2,
  generated_at: '2026-03-22T12:00:00.000Z',
  generated_by: 'claude-sonnet-4-6',
  tokens_used: 1500,
  created_at: '2026-03-22T12:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'ilike',
    'contains',
    'gte',
    'lte',
    'gt',
    'lt',
    'or',
    'order',
    'limit',
    'range',
  ] as const;
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  // Default chain terminator: returns content items
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: MOCK_CONTENT_ITEMS, error: null, count: 2 }),
  );

  // Single terminator for digest insert
  mockSupabase._chain.single.mockResolvedValue({
    data: MOCK_INSERT_RESULT,
    error: null,
  });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);

  // RPC returns freshness breakdown
  mockSupabase.rpc.mockResolvedValue({
    data: [
      { freshness: 'fresh', count: 10 },
      { freshness: 'aging', count: 5 },
      { freshness: 'stale', count: 2 },
      { freshness: 'expired', count: 1 },
    ],
    error: null,
  });

  // Content suggestions engine returns suggestions
  mockGenerateContentSuggestions.mockResolvedValue(MOCK_SUGGESTIONS);

  // Claude API returns a valid response
  mockCreate.mockResolvedValue({
    stop_reason: 'tool_use',
    content: [
      {
        type: 'tool_use',
        name: 'return_digest',
        input: {
          domain_summaries: [],
          narrative_summary: 'Test',
          content_opportunities: [],
        },
      },
    ],
    usage: { input_tokens: 500, output_tokens: 1000 },
  });
}

beforeEach(resetMocks);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Digest Content Suggestions Integration', () => {
  it('calls generateContentSuggestions during digest generation', async () => {
    await generateChangeReport({
      supabase: mockSupabase as unknown as SupabaseClient<Database>,
      periodDays: 7,
      digestType: 'weekly',
      userId: 'test-user-id',
    });

    expect(mockGenerateContentSuggestions).toHaveBeenCalledOnce();
    expect(mockGenerateContentSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: mockSupabase,
        maxSuggestions: 5,
      }),
    );
  });

  it('passes domain filter to suggestion engine when digest has domain filter', async () => {
    await generateChangeReport({
      supabase: mockSupabase as unknown as SupabaseClient<Database>,
      periodDays: 7,
      digestType: 'weekly',
      filterDomain: 'Technology',
      userId: 'test-user-id',
    });

    expect(mockGenerateContentSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        domainFilter: 'Technology',
      }),
    );
  });

  it('includes content suggestions in the Claude prompt', async () => {
    await generateChangeReport({
      supabase: mockSupabase as unknown as SupabaseClient<Database>,
      periodDays: 7,
      digestType: 'weekly',
      userId: 'test-user-id',
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;

    // The prompt should include the suggestions section
    expect(prompt).toContain('Content Opportunities');
    expect(prompt).toContain('ISO 27001');
    expect(prompt).toContain('DevOps');
  });

  it('includes content_opportunities in the tool schema', async () => {
    await generateChangeReport({
      supabase: mockSupabase as unknown as SupabaseClient<Database>,
      periodDays: 7,
      digestType: 'weekly',
      userId: 'test-user-id',
    });

    const callArgs = mockCreate.mock.calls[0][0];
    const toolSchema = callArgs.tools[0].input_schema;

    expect(toolSchema.properties).toHaveProperty('content_opportunities');
    expect(toolSchema.properties.content_opportunities.type).toBe('array');
  });

  it('handles suggestion engine failure gracefully', async () => {
    mockGenerateContentSuggestions.mockRejectedValue(new Error('DB error'));

    // Should not throw — suggestions failure should not block digest
    const result = await generateChangeReport({
      supabase: mockSupabase as unknown as SupabaseClient<Database>,
      periodDays: 7,
      digestType: 'weekly',
      userId: 'test-user-id',
    });

    expect(result.digest).toBeDefined();
    expect(result.digest.narrative_summary).toBeTruthy();
  });

  it('prompt includes content_opportunities instruction for standard digests', async () => {
    await generateChangeReport({
      supabase: mockSupabase as unknown as SupabaseClient<Database>,
      periodDays: 7,
      digestType: 'weekly',
      userId: 'test-user-id',
    });

    const callArgs = mockCreate.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;

    expect(prompt).toContain('content_opportunities');
    expect(prompt).toContain('actionable suggestions');
  });

  it('prompt includes content_opportunities instruction for daily digests', async () => {
    await generateChangeReport({
      supabase: mockSupabase as unknown as SupabaseClient<Database>,
      periodDays: 1,
      digestType: 'daily',
      userId: 'test-user-id',
    });

    const callArgs = mockCreate.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;

    expect(prompt).toContain('content_opportunities');
  });

  it('does not include suggestions section when engine returns empty', async () => {
    mockGenerateContentSuggestions.mockResolvedValue([]);

    await generateChangeReport({
      supabase: mockSupabase as unknown as SupabaseClient<Database>,
      periodDays: 7,
      digestType: 'weekly',
      userId: 'test-user-id',
    });

    const callArgs = mockCreate.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;

    // Should NOT include the "Content Opportunities" section header
    expect(prompt).not.toContain('Content Opportunities');
  });

  it('stores content_opportunities in digest metadata when present', async () => {
    await generateChangeReport({
      supabase: mockSupabase as unknown as SupabaseClient<Database>,
      periodDays: 7,
      digestType: 'weekly',
      userId: 'test-user-id',
    });

    // Check that the insert call includes content_opportunities in metadata
    const insertCall = mockSupabase._chain.insert.mock.calls[0];
    expect(insertCall).toBeDefined();

    const insertedRow = insertCall[0];
    // toJson() is just a type cast, so metadata is a plain object
    const metadata = insertedRow.metadata as Record<string, unknown>;

    expect(metadata).toHaveProperty('content_opportunities');
    const opportunities = metadata.content_opportunities as Array<{
      domain: string;
    }>;
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].domain).toBe('Compliance');
  });
});
