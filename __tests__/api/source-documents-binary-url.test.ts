/**
 * Tests for GET /api/source-documents/[id]/binary-url (ID-117 {117.6})
 *
 * Verifies that the binary-url route:
 * - unauthorised request → authFailureResponse shape (401)
 * - invalid UUID → 400 structured error
 * - unreadable/cross-workspace row (RLS-blocked → no row returned) → 404
 *   (no signed URL minted — workspace scoping enforced by RLS)
 * - signed URL mint failure → structured error JSON (not blank 500)
 * - success → { signed_url, expires_in: 300 } on the `documents` bucket (300s TTL)
 *
 * Per TECH §2 INV-8 and PLAN item-2 testStrategy.
 * Behaviour-first: verifies what callers observe, not implementation details.
 *
 * Shared Supabase mock per reference/test-philosophy.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { createMockSupabaseClient } from '../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

/** RLS-scoped user client (returned by getAuthorisedClient on success). */
const mockUserClient = createMockSupabaseClient();

/** Service client used only for signed-URL minting. */
const mockServiceClient = createMockSupabaseClient();

/** Stub signed-URL storage bucket returned by serviceClient.storage.from(). */
const mockStorageBucket = {
  createSignedUrl: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => mockServiceClient,
}));

vi.mock('@/lib/auth/client', () => ({
  getAuthorisedClient: vi.fn(),
  authFailureResponse: vi.fn(
    (result: { reason: string }) =>
      new Response(JSON.stringify({ error: `Auth failed: ${result.reason}` }), {
        status: result.reason === 'unauthenticated' ? 401 : 403,
        headers: { 'Content-Type': 'application/json' },
      }),
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_DOC_ID = '11111111-1111-4111-8111-111111111111';

function makeRequest(id: string): NextRequest {
  return new Request(
    `http://localhost/api/source-documents/${id}/binary-url`,
  ) as unknown as NextRequest;
}

async function importRoute() {
  return import('@/app/api/source-documents/[id]/binary-url/route');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/source-documents/[id]/binary-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: service client storage returns the mock bucket
    mockServiceClient.storage.from = vi.fn().mockReturnValue(mockStorageBucket);

    // Default signed URL success (overridden per-test where needed)
    mockStorageBucket.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://storage.example.com/signed?token=abc' },
      error: null,
    });
  });

  // ── Authentication ──────────────────────────────────────────────────────

  it('returns authFailureResponse when unauthenticated', async () => {
    const { getAuthorisedClient } = await import('@/lib/auth/client');
    vi.mocked(getAuthorisedClient).mockResolvedValueOnce({
      success: false,
      reason: 'unauthenticated',
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest(VALID_DOC_ID), {
      params: Promise.resolve({ id: VALID_DOC_ID }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it('returns authFailureResponse when auth service fails', async () => {
    const { getAuthorisedClient } = await import('@/lib/auth/client');
    vi.mocked(getAuthorisedClient).mockResolvedValueOnce({
      success: false,
      reason: 'auth_service_failed',
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest(VALID_DOC_ID), {
      params: Promise.resolve({ id: VALID_DOC_ID }),
    });

    // authFailureResponse stub returns 403 for non-unauthenticated reasons
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  // ── Input validation ────────────────────────────────────────────────────

  it('returns 400 for a non-UUID document id', async () => {
    const { getAuthorisedClient } = await import('@/lib/auth/client');
    vi.mocked(getAuthorisedClient).mockResolvedValueOnce({
      success: true,
      supabase: mockUserClient as never,
      user: { id: 'user-1' } as never,
      role: 'viewer' as never,
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest('not-a-uuid'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  // ── Workspace / RLS scoping ─────────────────────────────────────────────

  it('returns 404 (no signed URL) when the row is unreadable (cross-workspace / RLS-blocked)', async () => {
    const { getAuthorisedClient } = await import('@/lib/auth/client');
    vi.mocked(getAuthorisedClient).mockResolvedValueOnce({
      success: true,
      supabase: mockUserClient as never,
      user: { id: 'user-1' } as never,
      role: 'viewer' as never,
    });

    // RLS blocks access: no rows returned
    mockUserClient._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest(VALID_DOC_ID), {
      params: Promise.resolve({ id: VALID_DOC_ID }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBeDefined();
    // Confirm no signed URL was minted
    expect(mockStorageBucket.createSignedUrl).not.toHaveBeenCalled();
  });

  it('returns structured error (not blank) when signed-URL minting fails', async () => {
    const { getAuthorisedClient } = await import('@/lib/auth/client');
    vi.mocked(getAuthorisedClient).mockResolvedValueOnce({
      success: true,
      supabase: mockUserClient as never,
      user: { id: 'user-1' } as never,
      role: 'viewer' as never,
    });

    // Row is readable
    mockUserClient._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_DOC_ID,
        storage_path: `${VALID_DOC_ID}/report.pdf`,
        mime_type: 'application/pdf',
      },
      error: null,
    });

    // Signed URL minting fails
    mockStorageBucket.createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'Storage service unavailable' },
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest(VALID_DOC_ID), {
      params: Promise.resolve({ id: VALID_DOC_ID }),
    });

    // Must be a structured JSON error — never a blank 500 or empty body
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe('string');
  });

  // ── Success path ────────────────────────────────────────────────────────

  it('returns a 300s signed URL on the documents bucket for an accessible row', async () => {
    const { getAuthorisedClient } = await import('@/lib/auth/client');
    vi.mocked(getAuthorisedClient).mockResolvedValueOnce({
      success: true,
      supabase: mockUserClient as never,
      user: { id: 'user-1' } as never,
      role: 'viewer' as never,
    });

    const storagePath = `${VALID_DOC_ID}/report.pdf`;
    const mimeType = 'application/pdf';

    // Row is accessible
    mockUserClient._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_DOC_ID,
        storage_path: storagePath,
        mime_type: mimeType,
      },
      error: null,
    });

    const expectedSignedUrl = 'https://storage.example.com/signed?token=xyz';
    mockStorageBucket.createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: expectedSignedUrl },
      error: null,
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest(VALID_DOC_ID), {
      params: Promise.resolve({ id: VALID_DOC_ID }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.signed_url).toBe(expectedSignedUrl);
    expect(body.expires_in).toBe(300);

    // Verify the correct bucket + TTL were used
    expect(mockServiceClient.storage.from).toHaveBeenCalledWith('documents');
    expect(mockStorageBucket.createSignedUrl).toHaveBeenCalledWith(
      storagePath,
      300,
    );
  });

  it('returns mime_type alongside the signed URL for client rendering decisions', async () => {
    const { getAuthorisedClient } = await import('@/lib/auth/client');
    vi.mocked(getAuthorisedClient).mockResolvedValueOnce({
      success: true,
      supabase: mockUserClient as never,
      user: { id: 'user-1' } as never,
      role: 'viewer' as never,
    });

    const mimeType =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    mockUserClient._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: VALID_DOC_ID,
        storage_path: `${VALID_DOC_ID}/report.docx`,
        mime_type: mimeType,
      },
      error: null,
    });

    const { GET } = await importRoute();
    const response = await GET(makeRequest(VALID_DOC_ID), {
      params: Promise.resolve({ id: VALID_DOC_ID }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.mime_type).toBe(mimeType);
  });
});
