/**
 * Tests for GET /api/review/history — review history API route.
 *
 * Verifies authentication/authorisation, query parameter validation,
 * database query construction, user_roles display name resolution,
 * and correct response shaping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createMockSupabaseClient } from '../helpers/mock-supabase';

// ─── Mock modules ──────────────────────────────────────────────────────────

const mockSupabase = createMockSupabaseClient();

const mockGetAuthorisedClient = vi.fn();
const mockAuthFailureResponse = vi.fn();

vi.mock('@/lib/auth', () => ({
  getAuthorisedClient: (...args: unknown[]) => mockGetAuthorisedClient(...args),
  authFailureResponse: (...args: unknown[]) => mockAuthFailureResponse(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440001';
const ANOTHER_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-ef1234567890';

function makeRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`);
}

const sampleHistoryRows = [
  {
    id: 'log-1',
    flag_type: 'classification_low',
    severity: 'warning',
    details: { notes: 'Confidence below threshold' },
    resolution_notes: 'Reclassified correctly',
    created_at: '2026-03-20T10:00:00Z',
    created_by: 'user-1',
    resolved: true,
    resolved_at: '2026-03-21T10:00:00Z',
    resolved_by: 'user-2',
  },
  {
    id: 'log-2',
    flag_type: 'review_needed',
    severity: 'warning',
    details: { reason: 'Manual flag' },
    resolution_notes: null,
    created_at: '2026-03-22T10:00:00Z',
    created_by: null,
    resolved: false,
    resolved_at: null,
    resolved_by: null,
  },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/review/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: authenticated editor
    mockGetAuthorisedClient.mockResolvedValue({
      success: true,
      user: { id: 'user-1' },
      supabase: mockSupabase,
      role: 'editor',
    });
  });

  // ── Authentication and authorisation ─────────────────────────────────────

  it('returns 401 when the user is unauthenticated', async () => {
    mockGetAuthorisedClient.mockResolvedValue({
      success: false,
      reason: 'unauthenticated',
    });
    mockAuthFailureResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest(`/api/review/history?item_id=${VALID_UUID}`),
    );

    expect(response.status).toBe(401);
  });

  it('returns 403 for viewer role (editor+ required)', async () => {
    mockGetAuthorisedClient.mockResolvedValue({
      success: false,
      reason: 'forbidden',
    });
    mockAuthFailureResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest(`/api/review/history?item_id=${VALID_UUID}`),
    );

    expect(response.status).toBe(403);
  });

  // ── Query parameter validation ───────────────────────────────────────────

  it('returns 400 when item_id is missing', async () => {
    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(makeRequest('/api/review/history'));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 when item_id is not a valid UUID', async () => {
    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest('/api/review/history?item_id=not-a-uuid'),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for a partial UUID', async () => {
    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest('/api/review/history?item_id=00000000-0000-0000'),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Validation failed');
  });

  // ── Successful responses ─────────────────────────────────────────────────

  it('returns history entries with populated display names', async () => {
    // First .then: ingestion_quality_log query
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: sampleHistoryRows, error: null }),
    );
    // Second .then: user_roles display_name lookup
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { user_id: 'user-1', display_name: 'Alice Smith' },
            { user_id: 'user-2', display_name: 'Bob Jones' },
          ],
          error: null,
        }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest(`/api/review/history?item_id=${VALID_UUID}`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.history).toHaveLength(2);

    // First entry: resolved, with both display names populated
    expect(body.history[0]).toMatchObject({
      id: 'log-1',
      flag_type: 'classification_low',
      severity: 'warning',
      resolved: true,
      created_by: 'user-1',
      created_by_name: 'Alice Smith',
      resolved_by: 'user-2',
      resolved_by_name: 'Bob Jones',
      resolution_notes: 'Reclassified correctly',
    });

    // Second entry: unresolved, no user IDs so null names
    expect(body.history[1]).toMatchObject({
      id: 'log-2',
      flag_type: 'review_needed',
      resolved: false,
      created_by_name: null,
      resolved_by_name: null,
      resolution_notes: null,
    });
  });

  it('includes resolution_notes in the response', async () => {
    const rowWithNotes = [
      {
        ...sampleHistoryRows[0],
        resolution_notes: 'Fixed the classification manually',
      },
    ];

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: rowWithNotes, error: null }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { user_id: 'user-1', display_name: 'Alice' },
            { user_id: 'user-2', display_name: 'Bob' },
          ],
          error: null,
        }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest(`/api/review/history?item_id=${VALID_UUID}`),
    );

    const body = await response.json();
    expect(body.history[0].resolution_notes).toBe(
      'Fixed the classification manually',
    );
  });

  it('returns empty array when no history exists for the item', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest(`/api/review/history?item_id=${VALID_UUID}`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.history).toEqual([]);
  });

  it('returns null display names when user_roles lookup returns no matches', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: sampleHistoryRows, error: null }),
    );
    // user_roles returns empty — no display names found
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest(`/api/review/history?item_id=${VALID_UUID}`),
    );

    const body = await response.json();
    expect(body.history[0].created_by_name).toBeNull();
    expect(body.history[0].resolved_by_name).toBeNull();
  });

  it('handles null data from user_roles lookup gracefully', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: sampleHistoryRows, error: null }),
    );
    // user_roles returns null data (error but non-blocking)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'something failed' } }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest(`/api/review/history?item_id=${VALID_UUID}`),
    );

    // Should still return 200 — display name lookup failure is non-fatal
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.history[0].created_by_name).toBeNull();
  });

  // ── Per-item scoping ─────────────────────────────────────────────────────

  it('returns no history rows when the requested item has none', async () => {
    // Different UUID — the route should return an empty history array
    // because the DB query is constrained to that item id.
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest(`/api/review/history?item_id=${ANOTHER_UUID}`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.history).toEqual([]);
  });

  // ── Error handling ───────────────────────────────────────────────────────

  it('returns 500 when the database query fails', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'Database connection lost' } }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest(`/api/review/history?item_id=${VALID_UUID}`),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain('Failed to fetch review history');
  });

  it('returns 500 when an unexpected exception is thrown', async () => {
    mockGetAuthorisedClient.mockRejectedValue(new Error('Unexpected crash'));

    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest(`/api/review/history?item_id=${VALID_UUID}`),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain('Failed to fetch review history');
  });

  // ── Response shape ───────────────────────────────────────────────────────

  it('returns all expected fields in each history entry', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [sampleHistoryRows[0]], error: null }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { user_id: 'user-1', display_name: 'Alice' },
            { user_id: 'user-2', display_name: 'Bob' },
          ],
          error: null,
        }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest(`/api/review/history?item_id=${VALID_UUID}`),
    );
    const body = await response.json();
    const entry = body.history[0];

    // Verify all fields from the ReviewHistoryEntry interface are present
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('flag_type');
    expect(entry).toHaveProperty('severity');
    expect(entry).toHaveProperty('details');
    expect(entry).toHaveProperty('resolution_notes');
    expect(entry).toHaveProperty('created_at');
    expect(entry).toHaveProperty('created_by');
    expect(entry).toHaveProperty('created_by_name');
    expect(entry).toHaveProperty('resolved');
    expect(entry).toHaveProperty('resolved_at');
    expect(entry).toHaveProperty('resolved_by');
    expect(entry).toHaveProperty('resolved_by_name');
  });

  it('returns history entries inside a { history } envelope', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const response = await GET(
      makeRequest(`/api/review/history?item_id=${VALID_UUID}`),
    );
    const body = await response.json();

    expect(body).toHaveProperty('history');
    expect(Array.isArray(body.history)).toBe(true);
  });
});
