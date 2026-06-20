import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest } from '../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues.
// Mirrors __tests__/api/search.test.ts (the content_items-scoped sibling) so
// the two endpoints stay structurally aligned.
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

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

import { POST } from '@/app/api/search/reference/route';

// A representative reference_search row — the RPC returns the 11 list columns
// plus the two SEPARATE raw score columns (embedding_score / fulltext_score).
const REFERENCE_SEARCH_ROW = {
  reference_id: '11111111-1111-4111-8111-111111111111',
  title: 'UK Procurement Act 2023',
  summary_preview: 'A summary preview of the reference.',
  body_preview: 'A body preview of the reference body text.',
  source_url: 'https://example.com/procurement-act',
  published_at: '2024-01-15T00:00:00.000Z',
  primary_domain: 'procurement',
  primary_subtopic: 'legislation',
  layer: 'reference',
  ingestion_source: 'url_import',
  source_document_id: '22222222-2222-4222-8222-222222222222',
  embedding_score: 0.82,
  fulltext_score: 0.41,
};

describe('POST /api/search/reference', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });

    mockGenerateEmbedding.mockResolvedValue(new Array(1024).fill(0));

    mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
  });

  it('returns 401 when unauthenticated (authFailureResponse)', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/search/reference', {
      method: 'POST',
      body: { query: 'procurement act' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe('Unauthorised');

    // Auth gate fires before any embedding / RPC work.
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty query', async () => {
    const req = createTestRequest('/api/search/reference', {
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

    // Validation rejects before embedding / RPC.
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('returns 400 for a blank (whitespace-only) query', async () => {
    const req = createTestRequest('/api/search/reference', {
      method: 'POST',
      body: { query: '   ' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('returns 400 when the query field is missing', async () => {
    const req = createTestRequest('/api/search/reference', {
      method: 'POST',
      body: {},
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('embeds the query and calls reference_search (NOT reference_list), returning rows verbatim', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [REFERENCE_SEARCH_ROW],
      error: null,
    });

    const req = createTestRequest('/api/search/reference', {
      method: 'POST',
      body: { query: 'procurement act' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();

    // Rows are returned verbatim, including BOTH raw score columns (B-14, B-23):
    // the route never blends embedding_score / fulltext_score server-side.
    expect(json.results).toEqual([REFERENCE_SEARCH_ROW]);
    expect(json.results[0].embedding_score).toBe(0.82);
    expect(json.results[0].fulltext_score).toBe(0.41);
    expect(json.count).toBe(1);

    // The query text was embedded via the shared helper.
    expect(mockGenerateEmbedding).toHaveBeenCalledWith('procurement act');

    // Exactly the reference_search RPC is called — references-only (B-23/B-25).
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('reference_search', {
      p_query: 'procurement act',
      p_query_embedding: expect.any(String),
      p_limit: 20, // default
    });

    // It must NOT call the content_items hybrid_search or reference_list.
    const rpcNames = mockSupabase.rpc.mock.calls.map((c) => c[0]);
    expect(rpcNames).not.toContain('reference_list');
    expect(rpcNames).not.toContain('hybrid_search');

    // The embedding is JSON-stringified (pgvector serialisation requirement).
    const embeddingArg = mockSupabase.rpc.mock.calls[0][1].p_query_embedding;
    expect(() => JSON.parse(embeddingArg)).not.toThrow();
    expect(JSON.parse(embeddingArg)).toHaveLength(1024);
  });

  it('trims the query before embedding and passing to the RPC', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const req = createTestRequest('/api/search/reference', {
      method: 'POST',
      body: { query: '  procurement act  ' },
    });

    await POST(req);

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('procurement act');
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'reference_search',
      expect.objectContaining({ p_query: 'procurement act' }),
    );
  });

  it('passes a custom limit through to reference_search', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const req = createTestRequest('/api/search/reference', {
      method: 'POST',
      body: { query: 'procurement', limit: 5 },
    });

    await POST(req);

    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'reference_search',
      expect.objectContaining({ p_limit: 5 }),
    );
  });

  it('returns a 200 empty results set when there are no matches', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const req = createTestRequest('/api/search/reference', {
      method: 'POST',
      body: { query: 'no such reference' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.results).toEqual([]);
    expect(json.count).toBe(0);
  });

  it('returns 503 when embedding generation fails', async () => {
    mockGenerateEmbedding.mockRejectedValueOnce(new Error('OpenAI API error'));

    const req = createTestRequest('/api/search/reference', {
      method: 'POST',
      body: { query: 'procurement act' },
    });

    const res = await POST(req);
    expect(res.status).toBe(503);

    const json = await res.json();
    expect(json.code).toBe('EMBEDDING_FAILED');

    // RPC is never reached when embedding fails.
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('returns 500 (NOT a silent empty array) when reference_search RPC fails', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error', code: 'PGRST000' },
    });

    const req = createTestRequest('/api/search/reference', {
      method: 'POST',
      body: { query: 'procurement act' },
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    // Must surface an error — never a 200 with results: [].
    expect(json.error).toBeDefined();
    expect(json.results).toBeUndefined();
  });
});
