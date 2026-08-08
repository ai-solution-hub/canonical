/**
 * POST /api/oauth/revoke — disconnecting a Connected App.
 *
 * Split out of the former `__tests__/app/api/remaining-routes.test.ts`
 * catch-all (test-tree workstream 2b) so each production route has exactly one
 * test file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';
import { createTestRequest } from '@/__tests__/helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

// Import the route AFTER mocks are registered
import { POST as oauthRevokePost } from '@/app/api/oauth/revoke/route';

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

/**
 * The OAuth surface (`supabase.auth.oauth`) is not part of the shared mock
 * client's shape, so it is attached per-test-file.
 */
interface OAuthRevokeMocks {
  revokeGrant: ReturnType<typeof vi.fn>;
}

let oauth: OAuthRevokeMocks;

beforeEach(() => {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  oauth = {
    revokeGrant: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  (mockSupabase.auth as unknown as { oauth: OAuthRevokeMocks }).oauth = oauth;
});

describe('POST /api/oauth/revoke', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/oauth/revoke', {
      method: 'POST',
      body: { clientId: VALID_UUID },
    });
    const res = await oauthRevokePost(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 400 for missing clientId', async () => {
    const req = createTestRequest('/api/oauth/revoke', {
      method: 'POST',
      body: {},
    });
    const res = await oauthRevokePost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid clientId format (not UUID)', async () => {
    const req = createTestRequest('/api/oauth/revoke', {
      method: 'POST',
      body: { clientId: 'not-a-uuid' },
    });
    const res = await oauthRevokePost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 200 on successful revocation', async () => {
    const req = createTestRequest('/api/oauth/revoke', {
      method: 'POST',
      body: { clientId: VALID_UUID },
    });
    const res = await oauthRevokePost(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 500 when revokeGrant fails', async () => {
    oauth.revokeGrant.mockResolvedValueOnce({
      data: null,
      error: { message: 'Grant not found' },
    });

    const req = createTestRequest('/api/oauth/revoke', {
      method: 'POST',
      body: { clientId: VALID_UUID },
    });
    const res = await oauthRevokePost(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
