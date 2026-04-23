/**
 * PATCH /api/items/[id] — Q&A content rebuild shape assertions.
 *
 * Verifies the canonical content shape per P0-BM Phase 3 spec ss4.1:
 *   Q: {question}\n\n{answer_standard}\n\n{answer_advanced}
 *
 * Covers 5 combinations:
 *   1. Both answers present
 *   2. Only answer_standard
 *   3. Only answer_advanced
 *   4. Both null
 *   5. Full question extracted from existing content with Q: prefix
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies, mockGenerateSingleFieldChangeSummary } = vi.hoisted(
  () => ({
    mockCookies: vi.fn(),
    mockGenerateSingleFieldChangeSummary: vi.fn(),
  }),
);

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/change-summary', () => ({
  generateSingleFieldChangeSummary: mockGenerateSingleFieldChangeSummary,
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
}));

vi.mock('@/lib/content/strip-markdown', () => ({
  stripMarkdown: vi.fn((text: string) => text),
}));

vi.mock('@/lib/content/chunk-store', () => ({
  regenerateChunks: vi.fn().mockResolvedValue({ errors: [] }),
}));

// Import route AFTER mocks are registered
import { PATCH } from '@/app/api/items/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

/**
 * Build a currentItem shape that mirrors the PATCH handler's .select() columns.
 * Defaults to a q_a_pair with the given overrides.
 */
function qaCurrentItem(overrides: Record<string, unknown> = {}) {
  return {
    title: 'What is ISO 27001?',
    content: 'Q: What is ISO 27001?\n\nISO 27001 is an information security standard.',
    brief: null,
    detail: null,
    reference: null,
    suggested_title: 'What is ISO 27001?',
    ai_keywords: null,
    primary_domain: null,
    primary_subtopic: null,
    secondary_domain: null,
    secondary_subtopic: null,
    priority: null,
    summary: null,
    content_type: 'q_a_pair',
    platform: 'manual',
    author_name: null,
    user_tags: null,
    answer_standard: 'ISO 27001 is an information security standard.',
    answer_advanced: null,
    governance_review_status: null,
    expiry_date: null,
    lifecycle_type: null,
    classified_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

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
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
  );

  mockGenerateSingleFieldChangeSummary.mockReturnValue('Field updated');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/items/[id] — Q&A content rebuild', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('rebuilds content with both answers: "Q: q\\n\\na_s\\n\\na_a"', async () => {
    configureRole(mockSupabase, 'editor');

    // currentItem fetch
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: qaCurrentItem({
        content: 'Q: What is ISO 27001?\n\nOld standard answer.',
        answer_standard: 'Old standard answer.',
        answer_advanced: 'Advanced details here.',
      }),
      error: null,
    });
    // version history maybeSingle
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { version: 1 },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'answer_standard', value: 'Updated standard.' },
    });

    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    // Find the update call that writes content
    const updateCall = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateCall.content).toBe(
      'Q: What is ISO 27001?\n\nUpdated standard.\n\nAdvanced details here.',
    );
  });

  it('rebuilds content with only answer_standard: "Q: q\\n\\na_s"', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: qaCurrentItem({
        content: 'Q: What is ISO 27001?\n\nOld answer.',
        answer_standard: 'Old answer.',
        answer_advanced: null,
      }),
      error: null,
    });
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { version: 1 },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'answer_standard', value: 'New standard only.' },
    });

    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    const updateCall = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateCall.content).toBe(
      'Q: What is ISO 27001?\n\nNew standard only.',
    );
  });

  it('rebuilds content with only answer_advanced: "Q: q\\n\\na_a"', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: qaCurrentItem({
        content: 'Q: What is ISO 27001?\n\nSome answer.',
        answer_standard: null,
        answer_advanced: null,
      }),
      error: null,
    });
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { version: 1 },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'answer_advanced', value: 'New advanced only.' },
    });

    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    const updateCall = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateCall.content).toBe(
      'Q: What is ISO 27001?\n\nNew advanced only.',
    );
  });

  it('rebuilds content with both null: "Q: q"', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: qaCurrentItem({
        content: 'Q: What is ISO 27001?\n\nOld answer.',
        answer_standard: 'Old answer.',
        answer_advanced: null,
      }),
      error: null,
    });
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { version: 1 },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'answer_standard', value: null },
    });

    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    const updateCall = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateCall.content).toBe('Q: What is ISO 27001?');
  });

  it('extracts full question from content Q: prefix, not truncated title', async () => {
    configureRole(mockSupabase, 'editor');

    const longQuestion =
      'What are the key requirements for achieving ISO 27001 certification and maintaining ongoing compliance with the standard across multiple business units?';

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: qaCurrentItem({
        // Title is truncated but content has the full question
        title: 'What are the key requirements for achieving ISO 27001 certification and maintaining ongoing compliance with the',
        content: `Q: ${longQuestion}\n\nOld answer.`,
        answer_standard: 'Old answer.',
        answer_advanced: null,
      }),
      error: null,
    });
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { version: 1 },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'answer_standard', value: 'Updated answer.' },
    });

    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    const updateCall = mockSupabase._chain.update.mock.calls[0][0];
    // Should use the FULL question from content, not the truncated title
    expect(updateCall.content).toBe(
      `Q: ${longQuestion}\n\nUpdated answer.`,
    );
    // Verify the full question is preserved (not truncated)
    expect(updateCall.content).toContain('multiple business units?');
  });
});
