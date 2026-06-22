/**
 * POST /api/items — Q&A answer-field population (§1.5 Plan WP1 / spec §4.1 H1).
 *
 * Verifies that when a new item is created via POST /api/items with
 * `content_type === 'q_a_pair'`, the handler mirrors the submitted `content`
 * into `answer_standard` (leaving `answer_advanced` as null), so the first
 * subsequent PATCH edit through the Q&A answer UI does not silently destroy
 * the original creation content (bug B2 — see spec §4.1 Option A).
 *
 * Acceptance (AC4b):
 *   - New Q&A item via POST writes `answer_standard === content`.
 *   - `answer_advanced` remains `null` (never written by the create path).
 *   - Non-Q&A types are unchanged — `answer_standard` not written.
 *
 * Spec: docs/specs/qa-contenteditor-upgrade-spec.md §4.1 (Create-content path
 * alignment, Option A selected).
 * Plan: docs/plans/qa-contenteditor-upgrade-plan.md §WP1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../../helpers/mock-supabase';
import { createTestRequest } from '../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
  };
});

vi.mock('@/lib/content/strip-markdown', () => ({
  stripMarkdown: vi.fn((text: string) => text),
}));

vi.mock('@/lib/dedup/content-dedup', () => ({
  checkForDuplicates: vi.fn().mockResolvedValue({
    has_duplicates: false,
    matches: [],
  }),
  formatDedupWarning: vi.fn().mockReturnValue(null),
  resolveDedupStamp: vi.fn().mockReturnValue({ dedup_status: 'clean' }),
}));

vi.mock('@/lib/layer-inference', () => ({
  inferLayer: vi.fn().mockReturnValue({
    suggestedLayer: 'operational',
    reason: 'test',
    confidence: 'medium',
  }),
}));

vi.mock('@/lib/topic-inference', () => ({
  suggestTopic: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/guide-section-mapping', () => ({
  suggestGuideSections: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/quality/quality-score', () => ({
  calculateAndRoundQualityScore: vi.fn().mockReturnValue(50),
}));

vi.mock('@/lib/pipeline/record-run', () => ({
  recordPipelineRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: vi.fn().mockResolvedValue(undefined),
}));

// Import route handler AFTER mocks are registered
import { POST } from '@/app/api/items/route';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

beforeEach(() => {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  const chainable = [
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
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/items — Q&A answer-field population (WP1 / spec §4.1 H1)', () => {
  it('populates answer_standard with the submitted content for q_a_pair items', async () => {
    configureRole(mockSupabase, 'editor');

    const itemContent = 'We comply with ISO 27001 and review the SoA annually.';

    // INSERT returns the new item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        title: 'How do you comply with ISO 27001?',
        content_type: 'q_a_pair',
        created_at: '2026-04-25T00:00:00Z',
      },
      error: null,
    });

    const request = createTestRequest('/api/items', {
      method: 'POST',
      body: {
        title: 'How do you comply with ISO 27001?',
        content: itemContent,
        content_type: 'q_a_pair',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    // The first .insert() call is the content_items INSERT (history insert
    // happens after and uses different shape — content_history columns).
    const insertCall = mockSupabase._chain.insert.mock.calls[0]?.[0];
    expect(insertCall).toBeDefined();

    // AC4b assertion 1: answer_standard mirrors the submitted content.
    expect(insertCall.answer_standard).toBe(itemContent);

    // The canonical content column is unchanged — Option A keeps the write
    // on both columns; the PATCH path will re-derive `content` from
    // `answer_standard` unchanged on first edit.
    expect(insertCall.content).toBe(itemContent);
    expect(insertCall.content_type).toBe('q_a_pair');

    // AC4b assertion 2: answer_advanced is NEVER written by the create path —
    // the form does not surface an Advanced field, so no splitter is needed.
    expect(insertCall.answer_advanced).toBeUndefined();
  });

  it('does not set answer_standard for non-q_a_pair item types', async () => {
    configureRole(mockSupabase, 'editor');

    // INSERT returns the new item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        title: 'A standard article',
        content_type: 'article',
        created_at: '2026-04-25T00:00:00Z',
      },
      error: null,
    });

    const request = createTestRequest('/api/items', {
      method: 'POST',
      body: {
        title: 'A standard article',
        content: 'Article body text — should not seed answer columns.',
        content_type: 'article',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const insertCall = mockSupabase._chain.insert.mock.calls[0]?.[0];
    expect(insertCall).toBeDefined();

    // AC4b assertion 3: non-Q&A types unchanged — neither answer column
    // is written.
    expect(insertCall.answer_standard).toBeUndefined();
    expect(insertCall.answer_advanced).toBeUndefined();
    expect(insertCall.content_type).toBe('article');
  });
});
