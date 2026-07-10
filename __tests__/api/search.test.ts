import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

// Extra mocks that need hoisting for vi.mock() factory references
const { mockGenerateEmbedding, mockCookies } = vi.hoisted(() => {
  return {
    mockGenerateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
    mockCookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
  };
});

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
    generateEmbedding: mockGenerateEmbedding,
  };
});

// Suppress console.error noise from the route's error handling
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import the handler under test (AFTER mocks are registered)
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/search/route';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-wire next/headers mock (cleared by clearAllMocks)
    mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

    // Re-establish default authenticated user
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });

    // Default embedding response
    mockGenerateEmbedding.mockResolvedValue(new Array(1024).fill(0));

    // Default RPC response
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/search', {
      method: 'POST',
      body: { query: 'test query' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 400 for empty query', async () => {
    const req = createTestRequest('/api/search', {
      method: 'POST',
      body: { query: '' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'query' })]),
    );
  });

  it('returns 400 for missing query field', async () => {
    const req = createTestRequest('/api/search', {
      method: 'POST',
      body: {},
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 200 with results array on valid search', async () => {
    const mockResults = [
      { id: 'item-1', title: 'Result One', similarity: 0.85 },
      { id: 'item-2', title: 'Result Two', similarity: 0.72 },
    ];
    mockSupabase.rpc.mockResolvedValueOnce({ data: mockResults, error: null });

    const req = createTestRequest('/api/search', {
      method: 'POST',
      body: { query: 'knowledge management' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.results).toEqual(mockResults);
    expect(json.count).toBe(2);

    // Verify the RPC was called with correct params
    expect(mockSupabase.rpc).toHaveBeenCalledWith('hybrid_search', {
      query_embedding: expect.any(String),
      query_text: 'knowledge management',
      similarity_threshold: 0.35, // default from schema
      limit_count: 20, // default from schema
    });

    // Verify the embedding was JSON-stringified (Supabase vector serialisation requirement)
    const rpcCall = mockSupabase.rpc.mock.calls[0];
    const embeddingArg = rpcCall[1].query_embedding;
    expect(() => JSON.parse(embeddingArg)).not.toThrow();
    expect(JSON.parse(embeddingArg)).toHaveLength(1024);
  });

  it('returns 200 with empty results for no matches', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const req = createTestRequest('/api/search', {
      method: 'POST',
      body: { query: 'xyzzy nonexistent topic' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.results).toEqual([]);
    expect(json.count).toBe(0);
  });

  it('returns 503 when embedding generation fails', async () => {
    mockGenerateEmbedding.mockRejectedValueOnce(new Error('OpenAI API error'));

    const req = createTestRequest('/api/search', {
      method: 'POST',
      body: { query: 'test query' },
    });

    const res = await POST(req);
    expect(res.status).toBe(503);

    const json = await res.json();
    expect(json.code).toBe('EMBEDDING_FAILED');
  });

  it('returns 500 when RPC fails', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error', code: 'PGRST000' },
    });

    const req = createTestRequest('/api/search', {
      method: 'POST',
      body: { query: 'test query' },
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe('Search query failed');
  });

  it('respects custom threshold and limit parameters', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const req = createTestRequest('/api/search', {
      method: 'POST',
      body: { query: 'test', threshold: 0.5, limit: 10 },
    });

    await POST(req);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('hybrid_search', {
      query_embedding: expect.any(String),
      query_text: 'test',
      similarity_threshold: 0.5,
      limit_count: 10,
    });
  });

  // ID-144.6 (OBS-4 fix): kind/domain/subtopic/dateFrom/dateTo now thread
  // through to the hybrid_search RPC as filter_* params.
  it('forwards all 5 filter params to the hybrid_search RPC when supplied', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const req = createTestRequest('/api/search', {
      method: 'POST',
      body: {
        query: 'test',
        kind: 'document',
        domain: 'finance',
        subtopic: 'invoicing',
        dateFrom: '2026-01-01T00:00:00.000Z',
        dateTo: '2026-06-30T23:59:59.999Z',
      },
    });

    await POST(req);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('hybrid_search', {
      query_embedding: expect.any(String),
      query_text: 'test',
      similarity_threshold: 0.35,
      limit_count: 20,
      filter_kind: 'document',
      filter_domain: 'finance',
      filter_subtopic: 'invoicing',
      filter_date_from: '2026-01-01T00:00:00.000Z',
      filter_date_to: '2026-06-30T23:59:59.999Z',
    });
  });

  it('passes filter_* as undefined (never null) when the 5 fields are omitted', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const req = createTestRequest('/api/search', {
      method: 'POST',
      body: { query: 'test' },
    });

    await POST(req);

    const rpcCall = mockSupabase.rpc.mock.calls[0];
    const rpcArgs = rpcCall[1];
    expect(rpcArgs.filter_kind).toBeUndefined();
    expect(rpcArgs.filter_domain).toBeUndefined();
    expect(rpcArgs.filter_subtopic).toBeUndefined();
    expect(rpcArgs.filter_date_from).toBeUndefined();
    expect(rpcArgs.filter_date_to).toBeUndefined();
  });

  // ID-144.6 boundary-normalisation fix (TECH §2.5 as amended S460): the
  // real caller shape. The native <input type="date"> in
  // corpus-search-controls.tsx emits a bare YYYY-MM-DD (no time component),
  // which must normalise to a UTC day-start/day-end bound before binding to
  // the timestamptz RPC params — otherwise picking a date in the real UI
  // 400s the whole request (a regression vs. the old silent Zod strip).
  it('normalises a bare YYYY-MM-DD dateFrom/dateTo to UTC day-start/day-end before calling the RPC', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const req = createTestRequest('/api/search', {
      method: 'POST',
      body: {
        query: 'test',
        dateFrom: '2026-01-01',
        dateTo: '2026-06-30',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'hybrid_search',
      expect.objectContaining({
        filter_date_from: '2026-01-01T00:00:00.000Z',
        filter_date_to: '2026-06-30T23:59:59.999Z',
      }),
    );
  });

  it('does not alter a full Z-suffixed dateFrom/dateTo when calling the RPC', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const req = createTestRequest('/api/search', {
      method: 'POST',
      body: {
        query: 'test',
        dateFrom: '2026-01-01T12:34:56.000Z',
        dateTo: '2026-06-30T01:02:03.000Z',
      },
    });

    await POST(req);

    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'hybrid_search',
      expect.objectContaining({
        filter_date_from: '2026-01-01T12:34:56.000Z',
        filter_date_to: '2026-06-30T01:02:03.000Z',
      }),
    );
  });
});
