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

vi.mock('@/lib/ai/embed', () => ({
  MAX_EMBEDDING_CHARS: 24_000,
  getEmbeddingModel: vi.fn(() => 'text-embedding-3-large'),
  getEmbeddingDimensions: vi.fn(() => 1024),

  generateEmbedding: mockGenerateEmbedding,
}));

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
});
