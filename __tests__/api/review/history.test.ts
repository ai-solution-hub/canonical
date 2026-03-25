import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createMockSupabaseClient } from '../../helpers/mock-supabase';

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

const VALID_UUID = '00000000-0000-0000-0000-000000000001';

const mockHistoryRows = [
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

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthorisedClient.mockResolvedValue({
      success: false,
      reason: 'unauthenticated',
    });
    mockAuthFailureResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const request = new NextRequest(
      `http://localhost/api/review/history?item_id=${VALID_UUID}`,
    );
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(mockGetAuthorisedClient).toHaveBeenCalledWith(['admin', 'editor']);
  });

  it('returns 403 for viewer role', async () => {
    mockGetAuthorisedClient.mockResolvedValue({
      success: false,
      reason: 'forbidden',
    });
    mockAuthFailureResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const request = new NextRequest(
      `http://localhost/api/review/history?item_id=${VALID_UUID}`,
    );
    const response = await GET(request);

    expect(response.status).toBe(403);
  });

  it('returns 400 when item_id is missing', async () => {
    const { GET } = await import('@/app/api/review/history/route');
    const request = new NextRequest('http://localhost/api/review/history');
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('item_id query parameter is required');
  });

  it('returns 400 when item_id is not a valid UUID', async () => {
    const { GET } = await import('@/app/api/review/history/route');
    const request = new NextRequest(
      'http://localhost/api/review/history?item_id=not-a-uuid',
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('item_id must be a valid UUID');
  });

  it('returns review history entries for a valid item_id', async () => {
    mockSupabase._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: mockHistoryRows, error: null }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const request = new NextRequest(
      `http://localhost/api/review/history?item_id=${VALID_UUID}`,
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.history).toHaveLength(2);

    // First entry: resolved
    expect(body.history[0]).toMatchObject({
      id: 'log-1',
      flag_type: 'classification_low',
      severity: 'warning',
      resolved: true,
      created_by: 'user-1',
      created_by_name: null, // display_name not yet available
      resolved_by_name: null,
      resolution_notes: 'Reclassified correctly',
    });

    // Second entry: unresolved
    expect(body.history[1]).toMatchObject({
      id: 'log-2',
      flag_type: 'review_needed',
      resolved: false,
      resolution_notes: null,
    });
  });

  it('returns empty array when no history exists', async () => {
    mockSupabase._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const request = new NextRequest(
      `http://localhost/api/review/history?item_id=${VALID_UUID}`,
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.history).toEqual([]);
  });

  it('returns 500 on database error', async () => {
    mockSupabase._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'Database error' } }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const request = new NextRequest(
      `http://localhost/api/review/history?item_id=${VALID_UUID}`,
    );
    const response = await GET(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain('Failed to fetch review history');
  });

  it('queries ingestion_quality_log with correct filters', async () => {
    mockSupabase._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const { GET } = await import('@/app/api/review/history/route');
    const request = new NextRequest(
      `http://localhost/api/review/history?item_id=${VALID_UUID}`,
    );
    await GET(request);

    expect(mockSupabase.from).toHaveBeenCalledWith('ingestion_quality_log');
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('content_item_id', VALID_UUID);
    expect(mockSupabase._chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mockSupabase._chain.limit).toHaveBeenCalledWith(10);
  });
});
