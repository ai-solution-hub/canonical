/**
 * API route tests for intelligence prompt performance endpoint.
 *
 * Route tested:
 *   GET /api/intelligence/workspaces/:id/metrics/prompt-performance
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

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

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/intelligence/workspaces/[id]/metrics/prompt-performance/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PROMPT_UUID_1 = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

const MOCK_PROMPT = {
  id: PROMPT_UUID_1,
  version: 2,
  is_active: true,
  change_notes: 'Tightened relevance threshold',
  created_at: '2026-03-15T10:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/intelligence/workspaces/:id/metrics/prompt-performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain defaults
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );
    mockSupabase._chain.single.mockResolvedValue({
      data: null,
      error: null,
    });
  });

  it('returns per-prompt performance metrics', async () => {
    configureRole(mockSupabase, 'admin');

    // Fetch prompts — single prompt to keep mock ordering deterministic
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [MOCK_PROMPT], error: null, count: 1 }),
    );

    // Total articles = 10
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 10 }),
    );
    // Passed articles = 3
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 3 }),
    );
    // Flags
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { id: 'f1', flag_type: 'false_positive', feed_articles: {} },
            { id: 'f2', flag_type: 'false_negative', feed_articles: {} },
          ],
          error: null,
          count: 2,
        }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/prompt-performance`,
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(1);

    expect(data[0].version).toBe(2);
    expect(data[0].prompt_id).toBe(PROMPT_UUID_1);
    expect(data[0].is_active).toBe(true);
    expect(data[0].articles_scored).toBe(10);
    expect(data[0].articles_passed).toBe(3);
    expect(data[0].pass_rate).toBe(30); // 3/10 * 100
    expect(data[0].false_positive_flags).toBe(1);
    expect(data[0].false_negative_flags).toBe(1);
    expect(data[0].total_flags).toBe(2);
    expect(data[0].flag_rate).toBe(20); // 2/10 * 100
  });

  it('handles prompt with zero articles (no division by zero)', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [MOCK_PROMPT], error: null, count: 1 }),
    );
    // Total articles = 0
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 0 }),
    );
    // Passed articles = 0
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 0 }),
    );
    // Flags = empty
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/prompt-performance`,
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data[0].articles_scored).toBe(0);
    expect(data[0].pass_rate).toBe(0);
    expect(data[0].flag_rate).toBe(0);
  });

  it('returns empty array when no prompts exist', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/prompt-performance`,
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([]);
  });

  it('returns rows sorted by version DESC (newest first)', async () => {
    configureRole(mockSupabase, 'admin');

    const prompts = [
      { ...MOCK_PROMPT, id: PROMPT_UUID_1, version: 3 },
      {
        ...MOCK_PROMPT,
        id: 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f',
        version: 1,
      },
    ];

    // Supabase returns them pre-sorted by our ORDER BY (desc)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: prompts, error: null, count: 2 }),
    );

    // For prompt 1 (v3): total, passed, flags
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 5 }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 2 }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    // For prompt 2 (v1): total, passed, flags
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 3 }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 1 }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/prompt-performance`,
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    // Version ordering comes from the Supabase ORDER BY, verified by checking
    // the order matches what was returned
    expect(data[0].version).toBe(3);
    expect(data[1].version).toBe(1);
  });

  it('includes all required fields in response', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [MOCK_PROMPT], error: null, count: 1 }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 1 }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 1 }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/prompt-performance`,
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    const row = data[0];
    expect(row).toEqual(
      expect.objectContaining({
        version: expect.any(Number),
        prompt_id: expect.any(String),
        is_active: expect.any(Boolean),
        created_at: expect.any(String),
        articles_scored: expect.any(Number),
        articles_passed: expect.any(Number),
        pass_rate: expect.any(Number),
        false_positive_flags: expect.any(Number),
        false_negative_flags: expect.any(Number),
        total_flags: expect.any(Number),
        flag_rate: expect.any(Number),
      }),
    );
  });

  it('pass_rate and flag_rate are percentages (0-100)', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [MOCK_PROMPT], error: null, count: 1 }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 20 }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 15 }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: 'f1', flag_type: 'false_positive', feed_articles: {} }],
          error: null,
          count: 1,
        }),
    );

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/prompt-performance`,
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);
    const data = await response.json();

    expect(data[0].pass_rate).toBe(75); // 15/20 * 100
    expect(data[0].flag_rate).toBe(5); // 1/20 * 100
    expect(data[0].pass_rate).toBeGreaterThanOrEqual(0);
    expect(data[0].pass_rate).toBeLessThanOrEqual(100);
    expect(data[0].flag_rate).toBeGreaterThanOrEqual(0);
    expect(data[0].flag_rate).toBeLessThanOrEqual(100);
  });

  it('returns 401 for unauthenticated request', async () => {
    configureUnauthenticated(mockSupabase);

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/prompt-performance`,
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);

    expect(response.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const request = createTestRequest(
      `/api/intelligence/workspaces/${WORKSPACE_UUID}/metrics/prompt-performance`,
    );
    const context = { params: createTestParams({ id: WORKSPACE_UUID }) };
    const response = await GET(request, context);

    expect(response.status).toBe(403);
  });
});
