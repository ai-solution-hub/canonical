import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest } from '../../helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({ mockCookies: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Import AFTER mocks are registered.
import { GET } from '@/app/api/okf/resource/route';

const UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

beforeEach(() => {
  vi.clearAllMocks();
  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  const chainable = ['select', 'eq', 'contains'] as const;
  for (const method of chainable) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }
  mockSupabase._chain.single.mockResolvedValue({
    data: { role: 'viewer' },
    error: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
});

describe('GET /api/okf/resource', () => {
  it('resolves a source_documents per-row pointer via api.source_documents', async () => {
    configureRole(mockSupabase, 'viewer');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: UUID, filename: 'orders.csv' },
      error: null,
    });

    const response = await GET(
      createTestRequest('/api/okf/resource', {
        searchParams: { uri: `canonical://source_documents/${UUID}` },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.table).toBe('source_documents');
    expect(body.record).toEqual({ id: UUID, filename: 'orders.csv' });
    expect(mockSupabase.from).toHaveBeenCalledWith('source_documents');
  });

  it('returns 404 when the pointed-to record no longer exists', async () => {
    configureRole(mockSupabase, 'viewer');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const response = await GET(
      createTestRequest('/api/okf/resource', {
        searchParams: { uri: `canonical://reference_items/${UUID}` },
      }),
    );

    expect(response.status).toBe(404);
  });

  it('resolves a q_a_pairs scope_tag pointer to a filtered list, never a single row', async () => {
    configureRole(mockSupabase, 'viewer');
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: 'qa-1', question_text: 'What tier?' }],
          error: null,
          count: 1,
        }),
    );

    const response = await GET(
      createTestRequest('/api/okf/resource', {
        searchParams: { uri: 'canonical://q_a_pairs?scope_tag=pricing' },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.table).toBe('q_a_pairs');
    expect(body.records).toEqual([{ id: 'qa-1', question_text: 'What tier?' }]);
    expect(mockSupabase._chain.contains).toHaveBeenCalledWith('scope_tag', [
      'pricing',
    ]);
  });

  it('rejects a missing uri query param with 400', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(createTestRequest('/api/okf/resource'));

    expect(response.status).toBe(400);
  });

  it('rejects an unrecognised canonical:// pointer with 400', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(
      createTestRequest('/api/okf/resource', {
        searchParams: { uri: 'canonical://record_embeddings/1234' },
      }),
    );

    expect(response.status).toBe(400);
  });

  it('routes an unauthenticated request through authFailureResponse (401)', async () => {
    configureUnauthenticated(mockSupabase);

    const response = await GET(
      createTestRequest('/api/okf/resource', {
        searchParams: { uri: `canonical://source_documents/${UUID}` },
      }),
    );

    expect(response.status).toBe(401);
  });
});
